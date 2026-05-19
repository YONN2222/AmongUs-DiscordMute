using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using DiscordMute.Config;
using DiscordMute.Core;
using DiscordMute.Patches;
using HarmonyLib;

namespace DiscordMute;

[BepInPlugin(PluginInfo.Id, PluginInfo.Name, PluginInfo.Version)]
[BepInProcess("Among Us.exe")]
public class DiscordMutePlugin : BasePlugin
{
    internal static ManualLogSource PluginLog { get; private set; }
    internal static PluginConfig Cfg { get; private set; }
    internal static HttpClient HttpClient { get; private set; }
    internal static readonly ConcurrentDictionary<string, string> PendingLinks = new();
    internal static bool IsEhrInstalled { get; private set; }

    private Harmony _harmony;

    public override void Load()
    {
        PluginLog = Log;
        try
        {
            LoadConfig();
            HttpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            IsEhrInstalled = AccessTools.TypeByName("EHR.Main") != null;
            PluginLog.LogInfo($"EHR presence: {IsEhrInstalled}");

            if (!IsEhrInstalled)
                PluginLog.LogWarning("EHR not detected. Blackmailer support is disabled.");

            System.Threading.Tasks.Task.Run(() =>
            {
                try { HttpServer.Start(); }
                catch (Exception ex) { PluginLog.LogError($"Listener task error: {ex.Message}"); }
            });

            BepInEx.Logging.Logger.Listeners.Add(new BotLogListener());

            _harmony = new Harmony(PluginInfo.Id);
            _harmony.PatchAll(typeof(HudManagerUpdatePatch));
            _harmony.PatchAll(typeof(DmLobbyStartPatch));
            _harmony.PatchAll(typeof(GameStartPatch));
            _harmony.PatchAll(typeof(GameEndPatch));
            _harmony.PatchAll(typeof(MeetingStartPatch));
            _harmony.PatchAll(typeof(MeetingEndPatch));
            _harmony.PatchAll(typeof(ChatCommandPatch));
            _harmony.PatchAll(typeof(RemoteChatInterceptPatch));

            PluginLog.LogInfo($"{PluginInfo.Name} v{PluginInfo.Version} loaded.");
        }
        catch (Exception ex)
        {
            PluginLog.LogError($"Error loading plugin: {ex.Message}");
        }
    }

    private void LoadConfig()
    {
        var dir = Path.Combine(Paths.BepInExRootPath, "DiscordMute");
        var path = Path.Combine(dir, "config.json");

        if (!Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        if (!File.Exists(path))
        {
            Cfg = new PluginConfig();
            File.WriteAllText(path, JsonSerializer.Serialize(Cfg, new JsonSerializerOptions { WriteIndented = true }));
            return;
        }

        try
        {
            Cfg = JsonSerializer.Deserialize<PluginConfig>(File.ReadAllText(path)) ?? new PluginConfig();
        }
        catch (Exception ex)
        {
            PluginLog.LogWarning($"Failed to read plugin config, using defaults: {ex.Message}");
            Cfg = new PluginConfig();
        }
    }

    internal static void SavePluginLink(string accountName, string discordId)
    {
        var path = Path.Combine(Paths.BepInExRootPath, "DiscordMute", "linking.json");
        var links = new List<Dictionary<string, string>>();
        if (File.Exists(path))
            try
            {
                links.AddRange(JsonSerializer.Deserialize<LinkingFile>(File.ReadAllText(path)).Links);
            }
            catch (Exception ex)
            {
                PluginLog.LogWarning($"Failed to read linking file, rebuilding it: {ex.Message}");
            }

        links.RemoveAll(l => l["accountName"] == accountName);
        links.Add(new Dictionary<string, string> { ["accountName"] = accountName, ["discordId"] = discordId });
        File.WriteAllText(path, JsonSerializer.Serialize(new { links }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
