using System.Threading.Tasks;
using DiscordMute.Linking;
using InnerNet;
using UnityEngine;

namespace DiscordMute.Core;

/// <summary>
/// Single source of truth for whether the plugin is active. It is only active while the
/// local client is the host of an online lobby or game. Refresh must run on the Unity main thread.
/// </summary>
internal static class HostGate
{
    private static volatile bool _active;
    private static bool _leaving;

    internal static bool IsActive => _active;

    internal static void Refresh(bool forceInactive = false, bool lobbyStarted = false)
    {
        if (forceInactive)
            _leaving = true;
        else if (lobbyStarted || LeftGameObserved())
            _leaving = false;

        var shouldBeActive = !_leaving && IsLocalHost();
        if (shouldBeActive == _active) return;

        _active = shouldBeActive;
        if (shouldBeActive)
            Activate();
        else
            Deactivate();
    }

    private static bool LeftGameObserved()
    {
        var client = AmongUsClient.Instance;
        return client == null || client.GameState == InnerNetClient.GameStates.NotJoined;
    }

    private static bool IsLocalHost()
    {
        var client = AmongUsClient.Instance;
        return client != null &&
               client.AmHost &&
               client.NetworkMode != NetworkModes.FreePlay &&
               client.GameState != InnerNetClient.GameStates.NotJoined;
    }

    private static void Activate()
    {
        DiscordMutePlugin.PluginLog.LogInfo("Host detected, connecting to bot");
        PluginSocket.Activate(Application.version);
        UpdateChecker.StartOnce();
        _ = Task.Run(BotClient.EnsureBotRunningAsync);
    }

    private static void Deactivate()
    {
        DiscordMutePlugin.PluginLog.LogInfo("No longer host, DiscordMute inactive");
        PluginSocket.Deactivate();
        DiscordMutePlugin.PendingLinks.Clear();
        LinkHandler.Reset();
        LocalChatQueue.Pending.Clear();
    }
}
