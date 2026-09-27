using System;
using System.Collections.Concurrent;
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

            PluginSocket.Start();

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
            _harmony.PatchAll(typeof(QuickChatLinkSendPatch));
            _harmony.PatchAll(typeof(QuickChatLinkReceivePatch));

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
}
