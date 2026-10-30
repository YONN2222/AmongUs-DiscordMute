using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DiscordMute.Core;

/// <summary>
/// Looks up the latest GitHub release once per game launch and remembers a single chat notice
/// for the host. Never throws and never blocks the game.
/// </summary>
internal static class UpdateChecker
{
    private const string ReleasesLatestUrl = "https://api.github.com/repos/YONN2222/AmongUs-DiscordMute/releases/latest";
    private const string ReleaseUrlPrefix = "https://github.com/";

    private static int _started;
    private static string _notice;

    internal static void StartOnce()
    {
        if (DiscordMutePlugin.Cfg.DisableUpdateCheck) return;
        if (Interlocked.Exchange(ref _started, 1) != 0) return;
        _ = Task.Run(CheckAsync);
    }

    internal static bool TryTakeLobbyNotice(out string message)
    {
        message = Interlocked.Exchange(ref _notice, null);
        return message != null;
    }

    private static async Task CheckAsync()
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, ReleasesLatestUrl);
            request.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
            request.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2026-03-10");
            request.Headers.TryAddWithoutValidation("User-Agent", $"DiscordMute-Plugin/{PluginInfo.Version}");

            using var response = await DiscordMutePlugin.HttpClient.SendAsync(request).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                DiscordMutePlugin.PluginLog.LogDebug($"Update check returned {(int)response.StatusCode}");
                return;
            }

            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            using var json = JsonDocument.Parse(body);
            var tag = json.RootElement.GetProperty("tag_name").GetString();
            var url = json.RootElement.GetProperty("html_url").GetString();
            if (tag == null || url == null || !url.StartsWith(ReleaseUrlPrefix, StringComparison.Ordinal)) return;
            if (!IsNewer(tag, PluginInfo.Version)) return;

            DiscordMutePlugin.PluginLog.LogInfo($"New DiscordMute version {tag} available: {url}");
            Volatile.Write(ref _notice, $"A new DiscordMute version {tag} is available.");
        }
        catch (Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogDebug($"Update check failed: {ex.Message}");
        }
    }

    internal static bool IsNewer(string candidate, string current)
    {
        if (!TryParse(candidate, out var a) || !TryParse(current, out var b)) return false;
        if (a.Major != b.Major) return a.Major > b.Major;
        if (a.Minor != b.Minor) return a.Minor > b.Minor;
        if (a.Patch != b.Patch) return a.Patch > b.Patch;
        if (a.Pre == b.Pre) return false;
        if (a.Pre == null) return true;
        if (b.Pre == null) return false;
        return ComparePre(a.Pre, b.Pre) > 0;
    }

    private static int ComparePre(string a, string b)
    {
        var left = a.Split('.');
        var right = b.Split('.');
        for (var i = 0; i < Math.Max(left.Length, right.Length); i++)
        {
            if (i >= left.Length) return -1;
            if (i >= right.Length) return 1;
            var xNum = long.TryParse(left[i], out var x) && IsDigits(left[i]);
            var yNum = long.TryParse(right[i], out var y) && IsDigits(right[i]);
            if (xNum && yNum)
            {
                if (x != y) return x < y ? -1 : 1;
            }
            else if (xNum != yNum)
            {
                return xNum ? -1 : 1;
            }
            else
            {
                var cmp = string.CompareOrdinal(left[i], right[i]);
                if (cmp != 0) return cmp < 0 ? -1 : 1;
            }
        }
        return 0;
    }

    private static bool TryParse(string raw, out (long Major, long Minor, long Patch, string Pre) version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var text = raw.Trim();
        if (text[0] is 'v' or 'V') text = text.Substring(1);

        string pre = null;
        var dash = text.IndexOf('-');
        if (dash >= 0)
        {
            pre = text.Substring(dash + 1);
            text = text.Substring(0, dash);
            if (pre.Length == 0 || !IsPreChars(pre)) return false;
        }

        var parts = text.Split('.');
        if (parts.Length != 3) return false;
        if (!IsDigits(parts[0]) || !IsDigits(parts[1]) || !IsDigits(parts[2])) return false;
        if (!long.TryParse(parts[0], out var major) || !long.TryParse(parts[1], out var minor) ||
            !long.TryParse(parts[2], out var patch)) return false;

        version = (major, minor, patch, pre);
        return true;
    }

    private static bool IsDigits(string value)
    {
        if (value.Length == 0) return false;
        foreach (var c in value)
            if (c < '0' || c > '9') return false;
        return true;
    }

    private static bool IsPreChars(string value)
    {
        foreach (var c in value)
            if (!(c is >= '0' and <= '9' or >= 'a' and <= 'z' or >= 'A' and <= 'Z' or '.' or '-')) return false;
        return true;
    }
}
