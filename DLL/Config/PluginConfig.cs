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
}
