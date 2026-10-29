using System;
using System.Threading.Tasks;
using DiscordMute.Core;
using DiscordMute.Linking;
using HarmonyLib;

namespace DiscordMute.Patches;

[HarmonyPatch(typeof(HudManager), nameof(HudManager.Update))]
internal static class HudManagerUpdatePatch
{
    private const long RefreshIntervalMs = 1000;
    private static long _lastRefresh;

    [HarmonyPostfix]
    static void Postfix(HudManager __instance)
    {
        var now = Environment.TickCount64;
        if (now - _lastRefresh >= RefreshIntervalMs)
        {
            _lastRefresh = now;
            HostGate.Refresh();
        }

        if (!HostGate.IsActive || LocalChatQueue.Pending.IsEmpty) return;
        var player = PlayerControl.LocalPlayer;
        if (player == null || __instance.Chat == null) return;

        while (LocalChatQueue.Pending.TryDequeue(out var message))
            __instance.Chat.AddChat(player, message);
    }
}

[HarmonyPatch(typeof(MainMenuManager), nameof(MainMenuManager.Start))]
internal static class MainMenuPatch
{
    [HarmonyPostfix]
    static void Postfix() => HostGate.Refresh(forceInactive: true);
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.ExitGame))]
internal static class ExitGamePatch
{
    [HarmonyPrefix]
    static void Prefix() => HostGate.Refresh(forceInactive: true);
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.OnDisconnected))]
internal static class DisconnectedPatch
{
    [HarmonyPrefix]
    static void Prefix() => HostGate.Refresh(forceInactive: true);
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.OnBecomeHost))]
internal static class BecomeHostPatch
{
    [HarmonyPostfix]
    static void Postfix() => HostGate.Refresh();
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.OnPlayerLeft))]
internal static class PlayerLeftPatch
{
    [HarmonyPostfix]
    static void Postfix() => HostGate.Refresh();
}

[HarmonyPatch(typeof(LobbyBehaviour), nameof(LobbyBehaviour.Start))]
internal static class DmLobbyStartPatch
{
    [HarmonyPostfix]
    static void Postfix()
    {
        var wasActive = HostGate.IsActive;
        HostGate.Refresh(lobbyStarted: true);
        if (!HostGate.IsActive) return;

        _ = Task.Run(async () =>
        {
            if (wasActive)
                await BotClient.EnsureBotRunningAsync();
            await BotClient.SendEventAsync("lobby");
        });
    }
}

[HarmonyPatch(typeof(GameStartManager), nameof(GameStartManager.BeginGame))]
internal static class GameStartPatch
{
    [HarmonyPostfix]
    static void Postfix()
    {
        if (!HostGate.IsActive) return;
        _ = BotClient.SendEventAsync("game-start");
    }
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.OnGameEnd))]
internal static class GameEndPatch
{
    [HarmonyPostfix]
    static void Postfix(EndGameResult endGameResult)
    {
        HostGate.Refresh();
        if (!HostGate.IsActive) return;
        _ = BotClient.SendGameEndAsync(endGameResult.GameOverReason.ToString());
        _ = BotClient.SendEventAsync("lobby");
    }
}

[HarmonyPatch(typeof(PlayerControl), nameof(PlayerControl.MurderPlayer))]
internal static class MurderPlayerPatch
{
    [HarmonyPostfix]
    static void Postfix()
    {
        if (!HostGate.IsActive || ShipStatus.Instance == null || MeetingHud.Instance != null) return;
        _ = BotClient.SendEventAsync("player-died");
    }
}

[HarmonyPatch(typeof(MeetingHud), nameof(MeetingHud.Start))]
internal static class MeetingStartPatch
{
    [HarmonyPostfix]
    static void Postfix()
    {
        if (!HostGate.IsActive) return;
        _ = BotClient.SendEventAsync("meeting-start");
    }
}

[HarmonyPatch(typeof(ExileController), nameof(ExileController.Begin))]
internal static class MeetingEndPatch
{
    [HarmonyPostfix]
    static void Postfix()
    {
        if (!HostGate.IsActive) return;
        _ = Task.Run(async () =>
        {
            await Task.Delay(500);
            await BotClient.SendEventAsync("meeting-end");
        });
    }
}
