using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DiscordMute.Core;

internal static class PluginSocket
{
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(3);

    internal static void Start()
    {
        _ = RunAsync();
    }

    private static async Task RunAsync()
    {
        while (true)
        {
            try
            {
                await ConnectAndListenAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                DiscordMutePlugin.PluginLog.LogWarning($"Bot WebSocket connection lost: {ex.Message}");
            }

            await Task.Delay(ReconnectDelay).ConfigureAwait(false);
        }
    }

    private static async Task ConnectAndListenAsync()
    {
        using var socket = new ClientWebSocket();
        var uri = new Uri(
            $"ws://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/ws?secret={Uri.EscapeDataString(DiscordMutePlugin.Cfg.Secret)}");

        await socket.ConnectAsync(uri, CancellationToken.None).ConfigureAwait(false);
        DiscordMutePlugin.PluginLog.LogInfo("Connected to bot via WebSocket.");

        var buffer = new byte[8192];
        while (socket.State == WebSocketState.Open)
        {
            using var stream = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) return;
                stream.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            HandleMessage(Encoding.UTF8.GetString(stream.ToArray()));
        }
    }

    private static void HandleMessage(string json)
    {
        try
        {
            var root = JsonDocument.Parse(json).RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;

            if (typeProp.GetString() == "link-pending" &&
                root.TryGetProperty("phrase", out var phrase) &&
                root.TryGetProperty("discordId", out var discordId))
            {
                var discordIdStr = discordId.GetString();
                DiscordMutePlugin.PendingLinks[phrase.GetString()] = discordIdStr;

                if (root.TryGetProperty("quickChatCode", out var quickChatCode) &&
                    quickChatCode.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrEmpty(quickChatCode.GetString()))
                {
                    DiscordMutePlugin.PendingLinks[quickChatCode.GetString()] = discordIdStr;
                }
            }
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to parse WebSocket message: {ex.Message}");
        }
    }
}
