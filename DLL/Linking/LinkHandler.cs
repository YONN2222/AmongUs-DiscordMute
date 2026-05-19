using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
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
                if (DiscordMutePlugin.PendingLinks.TryRemove(phrase, out var discordId))
                    DiscordMutePlugin.SavePluginLink(accountName, discordId);
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
