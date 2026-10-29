using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AmongUs.QuickChat;
using DiscordMute.Core;
using HarmonyLib;

namespace DiscordMute.Linking;

public static class LinkHandler
{
    public static bool TryHandleFreeChatPhrase(string text, PlayerControl sender = null)
    {
        var normalized = (text ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized) || DiscordMutePlugin.PendingLinks.IsEmpty) return false;

        var matchedPhrase = DiscordMutePlugin.PendingLinks.ContainsKey(normalized)
            ? normalized
            : DiscordMutePlugin.PendingLinks.Keys.FirstOrDefault(p => p.Equals(normalized, StringComparison.OrdinalIgnoreCase));

        if (matchedPhrase == null) return false;

        var playerName = GetPlayerName(sender ?? PlayerControl.LocalPlayer);
        if (string.IsNullOrWhiteSpace(playerName)) return false;

        DiscordMutePlugin.PluginLog.LogInfo($"Linking player '{playerName}' with phrase '{matchedPhrase}'");
        SendLinkPhrase(matchedPhrase, playerName, (sender ?? PlayerControl.LocalPlayer)?.Data?.FriendCode);
        return true;
    }

    private static readonly ConcurrentDictionary<byte, (List<int> Keys, DateTime SentAt)> RecentQuickChatKeys = new();
    private static readonly TimeSpan QuickChatCombineWindow = TimeSpan.FromSeconds(20);

    public static bool TryHandleQuickChatPhrase(QuickChatPhraseBuilderResult data, PlayerControl sender)
    {
        if (DiscordMutePlugin.PendingLinks.IsEmpty) return false;

        var keys = ExtractPhraseKeys(data);
        if (keys.Count == 0) return false;

        var playerId = sender.PlayerId;
        var ownCode = BuildQuickChatCode(keys);
        string matchedCode = ownCode != null && DiscordMutePlugin.PendingLinks.ContainsKey(ownCode) ? ownCode : null;

        if (matchedCode == null &&
            RecentQuickChatKeys.TryGetValue(playerId, out var previous) &&
            DateTime.UtcNow - previous.SentAt <= QuickChatCombineWindow)
        {
            var combinedCode = BuildQuickChatCode(previous.Keys.Concat(keys).ToList());
            if (combinedCode != null && DiscordMutePlugin.PendingLinks.ContainsKey(combinedCode))
                matchedCode = combinedCode;
        }

        if (matchedCode == null)
        {
            RecentQuickChatKeys[playerId] = (keys, DateTime.UtcNow);
            return false;
        }

        RecentQuickChatKeys.TryRemove(playerId, out _);

        var playerName = GetPlayerName(sender);
        if (string.IsNullOrWhiteSpace(playerName)) return false;

        DiscordMutePlugin.PluginLog.LogInfo($"Linking player '{playerName}' with Quick Chat code '{matchedCode}'");
        SendLinkPhrase(matchedCode, playerName, sender?.Data?.FriendCode);
        return true;
    }

    private static List<int> ExtractPhraseKeys(QuickChatPhraseBuilderResult data)
    {
        var keys = new List<int> { (int)data.RootPhrase.PhraseKey };
        if (data.SubPhrases != null)
            keys.AddRange(data.SubPhrases.Select(p => (int)p.PhraseKey));

        return keys.Distinct().ToList();
    }

    private static string BuildQuickChatCode(List<int> keys)
    {
        var distinct = keys.Distinct().OrderBy(k => k).ToList();
        return distinct.Count >= 2 ? string.Join("-", distinct) : null;
    }

    public static string GetPlayerName(PlayerControl player)
    {
        return player == null ? null : ResolvePlayerName(player.PlayerId, player.Data?.PlayerName);
    }

    public static string GetPlayerName(NetworkedPlayerInfo info)
    {
        return info == null ? null : ResolvePlayerName(info.PlayerId, info.PlayerName);
    }

    internal static string CleanName(string rawName)
    {
        return Regex.Replace(rawName ?? string.Empty, "<[^>]*>", string.Empty).Trim();
    }

    private static string ResolvePlayerName(byte playerId, string rawName)
    {
        try
        {
            var modMain = AccessTools.TypeByName("TOHE.Main") ?? AccessTools.TypeByName("EHR.Main");
            if (modMain != null)
            {
                var allNamesField = AccessTools.Field(modMain, "AllPlayerNames");
                if (allNamesField != null)
                {
                    var allNames = allNamesField.GetValue(null) as IDictionary<byte, string>;
                    if (allNames != null && allNames.TryGetValue(playerId, out var name))
                        rawName = name;
                }
            }
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to resolve external player name: {ex.Message}");
        }

        return CleanName(rawName);
    }

    private static readonly ConcurrentDictionary<string, string> SentLinkCodes = new();

    internal static void Reset()
    {
        SentLinkCodes.Clear();
        RecentQuickChatKeys.Clear();
    }

    internal static void HandleLinkResult(string status, string accountName)
    {
        SentLinkCodes.TryRemove(PluginProtocol.Truncate(accountName, PluginProtocol.MaxNameLength), out var code);

        if (status != "linked")
        {
            LocalChatQueue.Pending.Enqueue("[DiscordMute] Link failed. Run /link self in Discord first.");
            return;
        }

        if (code != null && DiscordMutePlugin.PendingLinks.TryRemove(code, out var linkedDiscordId))
        {
            foreach (var staleKey in DiscordMutePlugin.PendingLinks
                         .Where(kv => kv.Value == linkedDiscordId)
                         .Select(kv => kv.Key)
                         .ToList())
            {
                DiscordMutePlugin.PendingLinks.TryRemove(staleKey, out _);
            }
        }
        LocalChatQueue.Pending.Enqueue("[DiscordMute] Account linked successfully!");
    }

    internal static void SendLinkPhrase(string phrase, string accountName, string friendCode = null)
    {
        try
        {
            var code = PluginProtocol.Truncate(phrase, PluginProtocol.MaxNameLength);
            var name = PluginProtocol.Truncate(accountName, PluginProtocol.MaxNameLength);
            SentLinkCodes[name] = code;
            var message = new LinkChatMessage { Code = code, AccountName = name };
            if (PluginSocket.BotSupportsV3 && !string.IsNullOrEmpty(friendCode))
                message.FriendCode = PluginProtocol.Truncate(friendCode, PluginProtocol.MaxFriendCodeLength);
            var sentNow = PluginSocket.Send(message);
            if (!sentNow)
                LocalChatQueue.Pending.Enqueue("[DiscordMute] Bot not connected yet, link request will be sent once it is.");
        }
        catch (Exception ex)
        {
            LocalChatQueue.Pending.Enqueue($"[DiscordMute] Link error: {ex.Message}");
        }
    }
}
