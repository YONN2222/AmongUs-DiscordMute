using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using BepInEx.Logging;

namespace DiscordMute.Core;

internal sealed class BotLogListener : ILogListener
{
    public LogLevel LogLevelFilter => LogLevel.All;

    public void LogEvent(object sender, LogEventArgs e)
    {
        if (!ShouldForward(e))
            return;

        _ = Task.Run(async () =>
        {
            try
            {
                var content = new System.Net.Http.StringContent(
                    JsonSerializer.Serialize(new { secret = DiscordMutePlugin.Cfg.Secret, message = e.Data.ToString() }),
                    Encoding.UTF8, "application/json");
                await DiscordMutePlugin.HttpClient.PostAsync(
                    $"http://{DiscordMutePlugin.Cfg.Ip}:{DiscordMutePlugin.Cfg.BotPort}/plugin-log", content);
            }
            catch (System.Exception ex)
            {
                DiscordMutePlugin.PluginLog.LogWarning($"Failed to forward plugin log to bot: {ex.Message}");
            }
        });
    }

    private static bool ShouldForward(LogEventArgs e)
    {
        var isOwnLog = ReferenceEquals(e.Source, DiscordMutePlugin.PluginLog);
        var isOwnWarningOrError = isOwnLog && (e.Level == LogLevel.Warning || e.Level == LogLevel.Error);
        var isBridgeFailure = isOwnLog && e.Data?.ToString()?.StartsWith("Failed to forward plugin log to bot:") == true;

        if (isBridgeFailure)
            return false;

        return isOwnWarningOrError || DiscordMutePlugin.Cfg.BridgeLogsToBotConsole;
    }

    public void Dispose() { }
}
