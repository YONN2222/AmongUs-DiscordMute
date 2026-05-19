using System.Threading.Tasks;
using DiscordMute.Core;
using DiscordMute.Linking;
using HarmonyLib;

namespace DiscordMute.Patches;

[HarmonyPatch(typeof(HudManager), nameof(HudManager.Update))]
internal static class HudManagerUpdatePatch
{
    [HarmonyPostfix]
    static void Postfix(HudManager __instance)
    {
        if (LocalChatQueue.Pending.IsEmpty) return;
        var player = PlayerControl.LocalPlayer;
        if (player == null || __instance.Chat == null) return;

        while (LocalChatQueue.Pending.TryDequeue(out var message))
            __instance.Chat.AddChat(player, message);
    }
}

[HarmonyPatch(typeof(LobbyBehaviour), nameof(LobbyBehaviour.Start))]
internal static class DmLobbyStartPatch
{
    [HarmonyPostfix]
    static void Postfix() => _ = Task.Run(async () =>
    {
        await BotClient.EnsureBotRunningAsync();
        await BotClient.SendEventAsync("lobby");
    });
}

[HarmonyPatch(typeof(GameStartManager), nameof(GameStartManager.BeginGame))]
internal static class GameStartPatch
{
    [HarmonyPostfix]
    static void Postfix() => _ = BotClient.SendEventAsync("game-start");
}

[HarmonyPatch(typeof(AmongUsClient), nameof(AmongUsClient.OnGameEnd))]
internal static class GameEndPatch
{
    [HarmonyPostfix]
    static void Postfix() => _ = BotClient.SendEventAsync("lobby");
}

[HarmonyPatch(typeof(MeetingHud), nameof(MeetingHud.Start))]
internal static class MeetingStartPatch
{
    [HarmonyPostfix]
    static void Postfix() => _ = BotClient.SendEventAsync("meeting-start");
}

[HarmonyPatch(typeof(ExileController), nameof(ExileController.Begin))]
internal static class MeetingEndPatch
{
    [HarmonyPostfix]
    static void Postfix() => _ = Task.Run(async () =>
    {
        await Task.Delay(500);
        await BotClient.SendEventAsync("meeting-end");
    });
}
