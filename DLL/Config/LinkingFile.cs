using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace DiscordMute.Config;

internal sealed class LinkingFile
{
    [JsonPropertyName("links")]
    public List<Dictionary<string, string>> Links { get; set; } = new();
}
