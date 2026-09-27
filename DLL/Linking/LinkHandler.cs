using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using AmongUs.QuickChat;
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
        _ = SendLinkPhraseAsync(matchedPhrase, playerName);
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
        _ = SendLinkPhraseAsync(matchedCode, playerName);
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
        if (player == null) return null;
        string rawName = player.Data?.PlayerName;

        try
        {
            var modMain = AccessTools.TypeByName("TOHE.Main") ?? AccessTools.TypeByName("EHR.Main");
            if (modMain != null)
            {
                var allNamesField = AccessTools.Field(modMain, "AllPlayerNames");
                if (allNamesField != null)
                {
                    var allNames = allNamesField.GetValue(null) as IDictionary<byte, string>;
                    if (allNames != null && allNames.TryGetValue(player.PlayerId, out var name))
                        rawName = name;
                }
            }
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to resolve external player name: {ex.Message}");
        }

        return Regex.Replace(rawName ?? string.Empty, "<[^>]*>", string.Empty).Trim();
    }

    internal static async Task SendLinkPhraseAsync(string phrase, string accountName)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new { secret = DiscordMutePlugin.Cfg.Secret, phrase, accountName });
            var content = new System.Net.Http.StringContent(payload, Encoding.UTF8, "application/json");
            var url = $"http://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/link-chat";
            var response = await DiscordMutePlugin.HttpClient.PostAsync(url, content).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (body.Contains("\"linked\""))
            {
                if (DiscordMutePlugin.PendingLinks.TryRemove(phrase, out var linkedDiscordId))
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
            else
            {
                LocalChatQueue.Pending.Enqueue("[DiscordMute] Link failed. Run /link in Discord first.");
            }
        }
        catch (Exception ex)
        {
            LocalChatQueue.Pending.Enqueue($"[DiscordMute] Link error: {ex.Message}");
        }
    }
}
