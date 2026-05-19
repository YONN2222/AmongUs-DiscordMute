using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using DiscordMute.Linking;
using DiscordMute.Modules;

namespace DiscordMute.Core;

internal static class BotClient
{
    internal static async Task EnsureBotRunningAsync()
    {
        if (string.IsNullOrWhiteSpace(DiscordMutePlugin.Cfg.ExePath)) return;
        try
        {
            var response = await DiscordMutePlugin.HttpClient
                .GetAsync($"http://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/ping?secret={Uri.EscapeDataString(DiscordMutePlugin.Cfg.Secret)}")
                .ConfigureAwait(false);
            if (response.IsSuccessStatusCode) return;
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to ping bot before launch attempt: {ex.Message}");
        }
        StartBotProcess();
    }

    private static void StartBotProcess()
    {
        var botPath = DiscordMutePlugin.Cfg.ExePath;
        var workingDirectory = Path.GetDirectoryName(botPath);

        if (string.IsNullOrWhiteSpace(workingDirectory) || !File.Exists(botPath))
        {
            DiscordMutePlugin.PluginLog.LogError($"Bot start file not found: {botPath}");
            return;
        }

        var isBatchFile = botPath.EndsWith(".bat", StringComparison.OrdinalIgnoreCase) ||
                          botPath.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase);

        var startInfo = isBatchFile
            ? new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/k \"\"{botPath}\"\"",
                WorkingDirectory = workingDirectory,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            }
            : new ProcessStartInfo(botPath)
            {
                WorkingDirectory = workingDirectory,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            };

        Process.Start(startInfo);
        DiscordMutePlugin.PluginLog.LogInfo($"Started Discord bot from '{botPath}'.");
    }

    internal static async Task SendEventAsync(string eventName)
    {
        for (int i = 0; i < 5; i++)
        {
            try
            {
                var (aliveNames, deadNames) = CollectPlayerNames();

                if (aliveNames.Count + deadNames.Count == 0 && i < 2)
                {
                    await Task.Delay(1000);
                    continue;
                }

                if (eventName == "meeting-start")
                    ApplyBlackmailMutes(aliveNames, deadNames);

                var payload = JsonSerializer.Serialize(new
                {
                    @event = eventName,
                    secret = DiscordMutePlugin.Cfg.Secret,
                    players = aliveNames,
                    deadPlayers = deadNames
                });
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                var response = await DiscordMutePlugin.HttpClient
                    .PostAsync($"http://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/{eventName}", content)
                    .ConfigureAwait(false);

                if (response.IsSuccessStatusCode)
                {
                    DiscordMutePlugin.PluginLog.LogInfo($"[DiscordMute] Event '{eventName}' sent successfully.");
                    return;
                }
            }
            catch (HttpRequestException ex)
            {
                DiscordMutePlugin.PluginLog.LogWarning($"HTTP error while sending event '{eventName}': {ex.Message}");
            }
            catch (Exception ex) { DiscordMutePlugin.PluginLog.LogError($"[DiscordMute] Error sending event '{eventName}': {ex.Message}"); }

            await Task.Delay(2000);
        }
    }

    private static (List<string> alive, List<string> dead) CollectPlayerNames()
    {
        var aliveNames = new List<string>();
        var deadNames = new List<string>();

        if (AmongUsClient.Instance?.allClients != null)
        {
            foreach (var client in AmongUsClient.Instance.allClients)
            {
                var name = LinkHandler.GetPlayerName(client.Character);
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (client.Character?.Data?.IsDead == true)
                    deadNames.Add(name);
                else
                    aliveNames.Add(name);
            }
        }

        var localName = LinkHandler.GetPlayerName(PlayerControl.LocalPlayer);
        if (!string.IsNullOrWhiteSpace(localName))
        {
            bool localDead = PlayerControl.LocalPlayer?.Data?.IsDead == true;
            var targetList = localDead ? deadNames : aliveNames;
            if (!targetList.Contains(localName)) targetList.Add(localName);
        }

        return (aliveNames, deadNames);
    }

    private static void ApplyBlackmailMutes(List<string> aliveNames, List<string> deadNames)
    {
        var blackmailedIds = BlackmailerModule.GetBlackmailedPlayerIds();
        if (blackmailedIds.Count == 0) return;

        if (AmongUsClient.Instance?.allClients != null)
        {
            foreach (var client in AmongUsClient.Instance.allClients)
            {
                var chr = client.Character;
                if (chr == null || chr.Data?.IsDead == true) continue;
                if (!blackmailedIds.Contains(chr.PlayerId)) continue;

                var name = LinkHandler.GetPlayerName(chr);
                if (string.IsNullOrWhiteSpace(name)) continue;

                aliveNames.Remove(name);
                if (!deadNames.Contains(name)) deadNames.Add(name);
            }
        }

        var lp = PlayerControl.LocalPlayer;
        if (lp != null && lp.Data?.IsDead == false && blackmailedIds.Contains(lp.PlayerId))
        {
            var lpName = LinkHandler.GetPlayerName(lp);
            if (!string.IsNullOrWhiteSpace(lpName))
            {
                aliveNames.Remove(lpName);
                if (!deadNames.Contains(lpName)) deadNames.Add(lpName);
            }
        }
    }
}
