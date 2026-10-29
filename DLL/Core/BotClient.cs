using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using DiscordMute.Linking;
using DiscordMute.Modules;
using InnerNet;

namespace DiscordMute.Core;

internal static class BotClient
{
    /// <summary>Starts the self-hosted bot from "exe" when it does not answer; the hosted bot is never started locally.</summary>
    internal static async Task EnsureBotRunningAsync()
    {
        if (DiscordMutePlugin.Cfg.IsHosted || string.IsNullOrWhiteSpace(DiscordMutePlugin.Cfg.ExePath)) return;
        try
        {
            var response = await DiscordMutePlugin.HttpClient
                .GetAsync($"http://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/health")
                .ConfigureAwait(false);
            if (response.IsSuccessStatusCode) return;
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to ping bot before launch attempt: {ex.Message}");
        }
        if (!HostGate.IsActive) return;
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

    private static readonly TimeSpan ReadyWait = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The bot's protocol version is only known after its welcome, so v3 content is built once the
    /// connection is ready. Gives up after a few seconds and falls back to the v2 message shape.
    /// </summary>
    private static async Task WaitForBotVersionAsync()
    {
        var deadline = DateTime.UtcNow + ReadyWait;
        while (!PluginSocket.IsReady && !PluginSocket.IsTerminal && !PluginSocket.IsBlocked && HostGate.IsActive &&
               DateTime.UtcNow < deadline)
            await Task.Delay(100);
    }

    private static readonly SemaphoreSlim EventGate = new(1, 1);

    /// <summary>Events are waited for, built and queued one at a time so they reach the bot in the order they were raised.</summary>
    internal static async Task SendEventAsync(string eventName)
    {
        await EventGate.WaitAsync();
        try { await SendEventCoreAsync(eventName); }
        finally { EventGate.Release(); }
    }

    private static async Task SendEventCoreAsync(string eventName)
    {
        await WaitForBotVersionAsync();

        if (eventName == "player-died" && !PluginSocket.BotSupportsV3) return;

        for (int i = 0; i < 5; i++)
        {
            if (!HostGate.IsActive || PluginSocket.IsBlocked) return;

            if (PluginSocket.IsTerminal)
            {
                PluginSocket.LogOutdatedOnce();
                return;
            }

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

                var message = new GameEventMessage
                {
                    Event = eventName,
                    HostAccountName = PluginProtocol.Truncate(
                        LinkHandler.GetPlayerName(PlayerControl.LocalPlayer), PluginProtocol.MaxNameLength),
                    Players = PluginProtocol.TruncateNames(aliveNames),
                    DeadPlayers = PluginProtocol.TruncateNames(deadNames)
                };
                if (PluginSocket.BotSupportsV3)
                {
                    message.Roster = CollectRoster();
                    message.LobbyCode = GetLobbyCode();
                }

                var sentNow = PluginSocket.Send(message);
                DiscordMutePlugin.PluginLog.LogInfo(
                    $"[DiscordMute] Event '{eventName}' {(sentNow ? "sent" : "queued until the bot connection is ready")}.");
                return;
            }
            catch (Exception ex) { DiscordMutePlugin.PluginLog.LogError($"[DiscordMute] Error sending event '{eventName}': {ex.Message}"); }

            await Task.Delay(2000);
        }
    }

    /// <summary>
    /// The roster and winners are snapshotted synchronously when this is called; the send then goes through the
    /// same gate as every other event, so it keeps its place in the order of events.
    /// </summary>
    internal static async Task SendGameEndAsync(string reason)
    {
        GameEndMessage message;
        try { message = SnapshotGameEnd(reason); }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogError($"[DiscordMute] Error reading the game result: {ex.Message}");
            return;
        }

        await EventGate.WaitAsync();
        try
        {
            await WaitForBotVersionAsync();
            if (!HostGate.IsActive || !PluginSocket.BotSupportsV3) return;
            PluginSocket.Send(message);
            DiscordMutePlugin.PluginLog.LogInfo($"[DiscordMute] Game end '{reason}' reported.");
        }
        catch (Exception ex) { DiscordMutePlugin.PluginLog.LogError($"[DiscordMute] Error sending game end: {ex.Message}"); }
        finally { EventGate.Release(); }
    }

    private static GameEndMessage SnapshotGameEnd(string reason)
    {
        var winners = new List<string>();
        var cached = EndGameResult.CachedWinners;
        if (cached != null)
        {
            foreach (var winner in cached)
            {
                var name = LinkHandler.CleanName(winner?.PlayerName);
                if (!string.IsNullOrWhiteSpace(name)) winners.Add(name);
            }
        }

        return new GameEndMessage
        {
            Reason = PluginProtocol.Truncate(reason, PluginProtocol.MaxNameLength),
            Winners = PluginProtocol.TruncateNames(winners),
            Roster = CollectRoster()
        };
    }

    internal static List<RosterEntry> CollectRoster()
    {
        var roster = new List<RosterEntry>();
        var players = GameData.Instance?.AllPlayers;
        if (players == null) return roster;

        foreach (var info in players)
        {
            if (info == null) continue;
            var name = LinkHandler.GetPlayerName(info);
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (roster.Count >= PluginProtocol.MaxPlayers) break;

            var friendCode = PluginProtocol.Truncate(info.FriendCode, PluginProtocol.MaxFriendCodeLength);
            roster.Add(new RosterEntry
            {
                Name = PluginProtocol.Truncate(name, PluginProtocol.MaxNameLength),
                FriendCode = friendCode.Length == 0 ? null : friendCode,
                Dead = info.IsDead,
                Disconnected = info.Disconnected
            });
        }

        return roster;
    }

    private static string GetLobbyCode()
    {
        var client = AmongUsClient.Instance;
        if (client == null || client.NetworkMode == NetworkModes.LocalGame) return null;
        var code = GameCode.IntToGameName(client.GameId);
        return string.IsNullOrEmpty(code) ? null : code;
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
