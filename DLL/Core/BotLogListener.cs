using BepInEx.Logging;

namespace DiscordMute.Core;

internal sealed class BotLogListener : ILogListener
{
    public LogLevel LogLevelFilter => LogLevel.All;

    public void LogEvent(object sender, LogEventArgs e)
    {
        if (!PluginSocket.IsReady || !ShouldForward(e))
            return;

        try
        {
            PluginSocket.Send(new PluginLogMessage
            {
                Level = MapLevel(e.Level),
                Source = PluginProtocol.Truncate(e.Source?.SourceName, PluginProtocol.MaxNameLength),
                Message = PluginProtocol.Truncate(e.Data?.ToString(), PluginProtocol.MaxLogMessageLength)
            });
        }
        catch (System.Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to forward plugin log to bot: {ex.Message}");
        }
    }

    private static string MapLevel(LogLevel level)
    {
        if ((level & LogLevel.Fatal) != 0) return "fatal";
        if ((level & LogLevel.Error) != 0) return "error";
        if ((level & LogLevel.Warning) != 0) return "warning";
        if ((level & LogLevel.Debug) != 0) return "debug";
        return "info";
    }

    private static bool ShouldForward(LogEventArgs e)
    {
        if (DiscordMutePlugin.Cfg.IsHosted)
            return false;

        var isOwnLog = ReferenceEquals(e.Source, DiscordMutePlugin.PluginLog);
        var isOwnWarningOrError = isOwnLog && (e.Level == LogLevel.Warning || e.Level == LogLevel.Error);
        var isBridgeFailure = isOwnLog && e.Data?.ToString()?.StartsWith("Failed to forward plugin log to bot:") == true;

        if (isBridgeFailure)
            return false;

        return isOwnWarningOrError || DiscordMutePlugin.Cfg.BridgeLogsToBotConsole;
    }

    public void Dispose() { }
}
