using System;
using System.Text.Json.Serialization;

namespace DiscordMute.Config;

internal sealed class PluginConfig
{
    [JsonPropertyName("ip")]
    public string Ip { get; set; } = "localhost";
    [JsonPropertyName("botPort")]
    public int BotPort { get; set; } = 7264;

    [JsonPropertyName("secret")]
    public string Secret { get; set; } = "change-me";

    [JsonPropertyName("exe")]
    public string ExePath { get; set; } = "";

    [JsonPropertyName("bridgeLogsToBotConsole")]
    public bool BridgeLogsToBotConsole { get; set; } = false;

    [JsonPropertyName("disableUpdateCheck")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool DisableUpdateCheck { get; set; }

    /// <summary>"hosted" connects to the hosted bot; anything else, or no value, means a self-hosted bot.</summary>
    [JsonPropertyName("mode")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string Mode { get; set; }

    internal bool IsHosted => string.Equals(Mode, "hosted", StringComparison.OrdinalIgnoreCase);
}
