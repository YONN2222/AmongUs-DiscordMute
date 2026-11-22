using System.Linq;
using System.Text.Json;
using AmongUs.QuickChat;
using DiscordMute.Core;

namespace DiscordMute.Linking;

/// <summary>
/// Pairs a device without a secret with a Discord server: the host sends the Quick Chat phrases shown by
/// /setup > Pair a device, and the hosted bot answers with a device token that is stored as the secret.
/// </summary>
internal static class PairingHandler
{
    private const int PairingPhraseCount = 3;

    internal const string Hint =
        "[DiscordMute] Not paired yet. Run /setup > Pair a device in Discord and send the shown Quick Chat phrases here.";

    internal static bool IsNeeded => DiscordMutePlugin.Cfg.IsHosted && !DiscordMutePlugin.Cfg.HasSecret;

    /// <returns>true when the message completed a pairing code and was sent to the bot instead of the lobby.</returns>
    internal static bool TryHandleQuickChat(QuickChatPhraseBuilderResult data, PlayerControl sender)
    {
        var keys = LinkHandler.RememberQuickChat(data, sender.PlayerId)
            .FirstOrDefault(combination => combination.Count == PairingPhraseCount);
        if (keys == null) return false;

        if (PluginSocket.SendPairChat(LinkHandler.BuildQuickChatCode(keys))) return true;

        LocalChatQueue.Pending.Enqueue("[DiscordMute] Not connected to the bot yet, send the phrases again in a moment.");
        return false;
    }

    internal static void HandlePaired(JsonElement root)
    {
        if (!root.TryGetProperty("secret", out var secret) || secret.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(secret.GetString()))
            return;

        var guildName = root.TryGetProperty("guildName", out var name) && name.ValueKind == JsonValueKind.String
            ? LinkHandler.CleanName(name.GetString())
            : string.Empty;
        if (guildName.Length == 0) guildName = "your Discord server";

        DiscordMutePlugin.Cfg.Secret = secret.GetString();
        DiscordMutePlugin.SaveConfig();
        DiscordMutePlugin.PluginLog.LogInfo($"Paired with Discord server '{guildName}'.");
        LocalChatQueue.Pending.Enqueue($"[DiscordMute] Paired with {guildName}.");
    }

    internal static void HandlePairResult(JsonElement root)
    {
        if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True) return;

        var attemptsLeft = root.TryGetProperty("attemptsLeft", out var left) && left.ValueKind == JsonValueKind.Number &&
                           left.TryGetInt32(out var count)
            ? count
            : 0;
        LocalChatQueue.Pending.Enqueue(
            $"[DiscordMute] These phrases do not match the pairing code ({attemptsLeft} attempts left). Check /setup > Pair a device and send them again.");
    }

    /// <summary>On Android the stored secret always comes from pairing, so a rejected one means the device was removed.</summary>
    internal static void ForgetDevice()
    {
        DiscordMutePlugin.Cfg.Secret = string.Empty;
        DiscordMutePlugin.SaveConfig();
        DiscordMutePlugin.PluginLog.LogWarning("The hosted bot rejected this device, pairing it again.");
        LocalChatQueue.Pending.Enqueue(Hint);
    }
}
