using System;
using AmongUs.QuickChat;
using DiscordMute.Linking;
using Hazel;
using HarmonyLib;

namespace DiscordMute.Patches;

[HarmonyPatch(typeof(PlayerControl), nameof(PlayerControl.RpcSendQuickChat))]
internal static class QuickChatLinkSendPatch
{
    [HarmonyPrefix]
    static bool Prefix(PlayerControl __instance, QuickChatPhraseBuilderResult data)
    {
        if (!__instance.AmOwner) return true;
        return !LinkHandler.TryHandleQuickChatPhrase(data, __instance);
    }
}

[HarmonyPatch(typeof(PlayerControl), nameof(PlayerControl.HandleRpc))]
internal static class QuickChatLinkReceivePatch
{
    [HarmonyPostfix]
    static void Postfix(PlayerControl __instance, byte callId, MessageReader reader)
    {
        if (callId != (byte)RpcCalls.SendQuickChat) return;
        if (DiscordMutePlugin.PendingLinks.IsEmpty) return;

        try
        {
            var data = QuickChatNetData.Deserialize(MessageReader.Get(reader));
            LinkHandler.TryHandleQuickChatPhrase(data, __instance);
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to parse Quick Chat for linking: {ex.Message}");
        }
    }
}
