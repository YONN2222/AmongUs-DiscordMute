using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DiscordMute.Core;

internal static class PluginProtocol
{
    internal const int ProtocolVersion = 2;

    internal const int CloseHelloTimeout = 4000;
    internal const int CloseUnauthorized = 4001;
    internal const int CloseProtocolTooOld = 4002;
    internal const int CloseInvalidMessage = 4003;
    internal const int CloseReplaced = 4004;

    internal const int MaxNameLength = 64;
    internal const int MaxVersionLength = 32;
    internal const int MaxLogMessageLength = 2000;
    internal const int MaxPlayers = 128;

    internal static readonly JsonSerializerOptions JsonOptions = new();

    internal static string Truncate(string value, int max)
    {
        value ??= string.Empty;
        if (value.Length <= max) return value;
        if (max > 0 && char.IsHighSurrogate(value[max - 1])) max--;
        return value.Substring(0, max);
    }

    internal static List<string> TruncateNames(IEnumerable<string> names)
    {
        return names.Take(MaxPlayers).Select(n => Truncate(n, MaxNameLength)).ToList();
    }
}

internal sealed class HelloMessage
{
    [JsonPropertyName("type")] public string Type => "hello";
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; }
    [JsonPropertyName("secret")] public string Secret { get; set; }
    [JsonPropertyName("pluginVersion")] public string PluginVersion { get; set; }
    [JsonPropertyName("gameVersion")] public string GameVersion { get; set; }
}

internal sealed class GameEventMessage
{
    [JsonPropertyName("type")] public string Type => "game-event";
    [JsonPropertyName("event")] public string Event { get; set; }
    [JsonPropertyName("hostAccountName")] public string HostAccountName { get; set; }
    [JsonPropertyName("players")] public List<string> Players { get; set; }
    [JsonPropertyName("deadPlayers")] public List<string> DeadPlayers { get; set; }
}

internal sealed class LinkChatMessage
{
    [JsonPropertyName("type")] public string Type => "link-chat";
    [JsonPropertyName("code")] public string Code { get; set; }
    [JsonPropertyName("accountName")] public string AccountName { get; set; }
}

internal sealed class PluginLogMessage
{
    [JsonPropertyName("type")] public string Type => "plugin-log";
    [JsonPropertyName("level")] public string Level { get; set; }
    [JsonPropertyName("source")] public string Source { get; set; }
    [JsonPropertyName("message")] public string Message { get; set; }
}
