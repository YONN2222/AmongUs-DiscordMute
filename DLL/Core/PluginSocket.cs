using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DiscordMute.Linking;

namespace DiscordMute.Core;

internal static class PluginSocket
{
    private const int MaxQueued = 32;

    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan ReplacedDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan UnauthorizedDelay = TimeSpan.FromSeconds(30);

    private static readonly object QueueLock = new();
    private static readonly LinkedList<QueuedMessage> Queue = new();
    private static readonly SemaphoreSlim QueueSignal = new(0, 1);

    private static volatile bool _ready;

    private sealed record QueuedMessage(string Json, bool Droppable);

    private static volatile bool _terminal;
    private static int _outdatedLogged;
    private static string _gameVersion = string.Empty;

    internal static bool IsReady => _ready;
    internal static bool IsTerminal => _terminal;

    internal static void LogOutdatedOnce()
    {
        if (Interlocked.Exchange(ref _outdatedLogged, 1) == 0)
            DiscordMutePlugin.PluginLog.LogError("DiscordMute is outdated for this bot; game events are not sent. Please update.");
    }

    internal static void Start(string gameVersion)
    {
        _gameVersion = gameVersion ?? string.Empty;
        _ = RunAsync();
    }

    /// <summary>
    /// Queues a message for the bot, in order. Returns true when the connection is ready and the
    /// message is on its way, false when it will only be sent after the next welcome.
    /// When the queue is full the oldest plugin-log is dropped first, otherwise the oldest message.
    /// </summary>
    internal static bool Send(object message)
    {
        var json = JsonSerializer.Serialize(message, message.GetType(), PluginProtocol.JsonOptions);
        lock (QueueLock)
        {
            if (Queue.Count >= MaxQueued)
                DropOldest();
            Queue.AddLast(new QueuedMessage(json, message is PluginLogMessage));
        }

        try { QueueSignal.Release(); }
        catch (SemaphoreFullException) { }

        return _ready;
    }

    private static void DropOldest()
    {
        for (var node = Queue.First; node != null; node = node.Next)
        {
            if (!node.Value.Droppable) continue;
            Queue.Remove(node);
            return;
        }
        Queue.RemoveFirst();
    }

    private static async Task RunAsync()
    {
        while (true)
        {
            var delay = ReconnectDelay;
            try
            {
                var (closeCode, closeReason) = await ConnectAndListenAsync().ConfigureAwait(false);
                switch (closeCode)
                {
                    case 0:
                        break;
                    case PluginProtocol.CloseProtocolTooOld:
                        DiscordMutePlugin.PluginLog.LogError("This DiscordMute version is too old for the bot. Please update.");
                        _terminal = true;
                        return;
                    case PluginProtocol.CloseUnauthorized:
                        DiscordMutePlugin.PluginLog.LogError(
                            "Bot rejected the secret. Check that \"secret\" in DiscordMute config matches the bot config.");
                        delay = UnauthorizedDelay;
                        break;
                    case PluginProtocol.CloseReplaced:
                        DiscordMutePlugin.PluginLog.LogInfo("Bot connection was replaced by a newer connection of this plugin.");
                        delay = ReplacedDelay;
                        break;
                    default:
                        DiscordMutePlugin.PluginLog.LogWarning($"Bot closed the connection with code {closeCode} ({closeReason}).");
                        break;
                }
            }
            catch (Exception ex)
            {
                DiscordMutePlugin.PluginLog.LogWarning($"Bot WebSocket connection lost: {ex.Message}");
            }

            await Task.Delay(delay).ConfigureAwait(false);
        }
    }

    private static async Task<(int Code, string Reason)> ConnectAndListenAsync()
    {
        using var socket = new ClientWebSocket();
        using var cts = new CancellationTokenSource();
        var uri = new Uri($"ws://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/ws");

        await socket.ConnectAsync(uri, CancellationToken.None).ConfigureAwait(false);
        DiscordMutePlugin.PluginLog.LogInfo("Connected to bot via WebSocket.");

        var hello = JsonSerializer.Serialize(new HelloMessage
        {
            ProtocolVersion = PluginProtocol.ProtocolVersion,
            Secret = DiscordMutePlugin.Cfg.Secret,
            PluginVersion = PluginProtocol.Truncate(PluginInfo.Version, PluginProtocol.MaxVersionLength),
            GameVersion = PluginProtocol.Truncate(_gameVersion, PluginProtocol.MaxVersionLength)
        }, PluginProtocol.JsonOptions);
        await SendRawAsync(socket, hello, cts.Token).ConfigureAwait(false);

        Task senderTask = null;
        try
        {
            var buffer = new byte[8192];
            while (socket.State == WebSocketState.Open)
            {
                using var stream = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                        return (result.CloseStatus.HasValue ? (int)result.CloseStatus.Value : 1005,
                            result.CloseStatusDescription ?? string.Empty);
                    stream.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (HandleMessage(Encoding.UTF8.GetString(stream.ToArray())) && senderTask == null)
                {
                    _ready = true;
                    senderTask = SendLoopAsync(socket, cts.Token);
                }
            }

            return (0, string.Empty);
        }
        finally
        {
            _ready = false;
            cts.Cancel();
            if (senderTask != null)
            {
                try { await senderTask.ConfigureAwait(false); }
                catch (Exception) { }
            }
        }
    }

    private static async Task SendLoopAsync(ClientWebSocket socket, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                QueuedMessage next;
                lock (QueueLock)
                {
                    next = Queue.First?.Value;
                }

                if (next == null)
                {
                    await QueueSignal.WaitAsync(token).ConfigureAwait(false);
                    continue;
                }

                await SendRawAsync(socket, next.Json, token).ConfigureAwait(false);
                lock (QueueLock)
                {
                    if (ReferenceEquals(Queue.First?.Value, next))
                        Queue.RemoveFirst();
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to send message to bot: {ex.Message}");
            _ready = false;
            socket.Abort();
        }
    }

    private static Task SendRawAsync(ClientWebSocket socket, string json, CancellationToken token)
    {
        return socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)),
            WebSocketMessageType.Text, true, token);
    }

    /// <returns>true when the message was the bot's welcome.</returns>
    private static bool HandleMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return false;

            switch (typeProp.GetString())
            {
                case "welcome":
                    if (root.TryGetProperty("protocolVersion", out var version) &&
                        version.ValueKind == JsonValueKind.Number &&
                        version.GetInt32() != PluginProtocol.ProtocolVersion)
                    {
                        DiscordMutePlugin.PluginLog.LogWarning(
                            $"Bot speaks protocol {version.GetInt32()}, this plugin speaks {PluginProtocol.ProtocolVersion}.");
                    }
                    return true;
                case "link-result":
                    HandleLinkResult(root);
                    break;
                case "link-pending":
                    HandleLinkPending(root);
                    break;
                case "notice":
                    HandleNotice(root);
                    break;
            }
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to parse WebSocket message: {ex.Message}");
        }

        return false;
    }

    private static void HandleLinkPending(JsonElement root)
    {
        if (!root.TryGetProperty("phrase", out var phrase) ||
            !root.TryGetProperty("discordId", out var discordId))
            return;

        var discordIdStr = discordId.GetString();
        DiscordMutePlugin.PendingLinks[phrase.GetString()] = discordIdStr;

        if (root.TryGetProperty("quickChatCode", out var quickChatCode) &&
            quickChatCode.ValueKind == JsonValueKind.String &&
            !string.IsNullOrEmpty(quickChatCode.GetString()))
        {
            DiscordMutePlugin.PendingLinks[quickChatCode.GetString()] = discordIdStr;
        }
    }

    private static void HandleLinkResult(JsonElement root)
    {
        if (!root.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String) return;
        var accountName = root.TryGetProperty("accountName", out var name) && name.ValueKind == JsonValueKind.String
            ? name.GetString()
            : string.Empty;
        LinkHandler.HandleLinkResult(status.GetString(), accountName);
    }

    private static void HandleNotice(JsonElement root)
    {
        if (!root.TryGetProperty("message", out var message) || message.ValueKind != JsonValueKind.String)
            return;

        var text = message.GetString();
        if (string.IsNullOrWhiteSpace(text)) return;

        LocalChatQueue.Pending.Enqueue($"[DiscordMute] {text}");
        DiscordMutePlugin.PluginLog.LogWarning($"Bot notice: {text}");
    }
}
