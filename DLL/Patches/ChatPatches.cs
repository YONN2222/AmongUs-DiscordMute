using DiscordMute.Linking;
using HarmonyLib;

namespace DiscordMute.Patches;

[HarmonyPatch(typeof(ChatController), nameof(ChatController.SendChat))]
internal static class ChatCommandPatch
{
    [HarmonyPrefix]
    [HarmonyPriority(Priority.First)]
    [HarmonyBefore("com.gurge44.endlesshostroles", "com.townofhostenhanced")]
    static bool Prefix(ChatController __instance)
    {
        if (__instance?.freeChatField?.textArea == null) return true;
        string text = __instance.freeChatField.textArea.text.Trim();
        if (string.IsNullOrWhiteSpace(text)) return true;

        if (LinkHandler.TryHandleFreeChatPhrase(text))
        {
            __instance.freeChatField.textArea.Clear();
            return false;
        }
        return true;
    }
}

[HarmonyPatch(typeof(ChatController), nameof(ChatController.AddChat))]
internal static class RemoteChatInterceptPatch
{
    [HarmonyPostfix]
    static void Postfix(PlayerControl sourcePlayer, string chatText)
    {
        if (sourcePlayer == null || sourcePlayer.AmOwner || DiscordMutePlugin.PendingLinks.IsEmpty) return;
        LinkHandler.TryHandleFreeChatPhrase(chatText, sourcePlayer);
    }
}
