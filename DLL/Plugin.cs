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

            BepInEx.Logging.Logger.Listeners.Add(new BotLogListener());

            _harmony = new Harmony(PluginInfo.Id);
            ApplyPatches();

            PluginLog.LogInfo($"{PluginInfo.Name} v{PluginInfo.Version} loaded.");
        }
        catch (Exception ex)
        {
            PluginLog.LogError($"Error loading plugin: {ex}");
        }
    }

    private static readonly Type[] PatchTypes =
    [
        typeof(HudManagerUpdatePatch),
        typeof(MainMenuPatch),
        typeof(ExitGamePatch),
        typeof(DisconnectedPatch),
        typeof(BecomeHostPatch),
        typeof(PlayerLeftPatch),
        typeof(DmLobbyStartPatch),
        typeof(GameStartPatch),
        typeof(GameEndPatch),
        typeof(MeetingStartPatch),
        typeof(MeetingEndPatch),
        typeof(ChatCommandPatch),
        typeof(RemoteChatInterceptPatch),
        typeof(QuickChatLinkSendPatch),
        typeof(QuickChatLinkReceivePatch),
    ];

    /// <summary>A patch that fails on one platform must not take the others down with it.</summary>
    private void ApplyPatches()
    {
        foreach (var patchType in PatchTypes)
        {
            try
            {
                _harmony.PatchAll(patchType);
            }
            catch (Exception ex)
            {
                PluginLog.LogError($"Could not apply {patchType.Name}: {ex}");
            }
        }
    }
    private static string _configPath;

    /// <summary>Starlight on Android cannot write next to the game, so the config lives in its data folder there.</summary>
    private static string DataDirectory()
    {
        if (!OperatingSystem.IsAndroid())
            return Path.Combine(Paths.BepInExRootPath, "DiscordMute");

        var root = Environment.GetEnvironmentVariable("STAR_DATA_PATH");
        if (string.IsNullOrEmpty(root))
            root = UnityEngine.Application.persistentDataPath;
        return Path.Combine(root, "DiscordMute");
    }

    internal static void SaveConfig()
    {
        File.WriteAllText(_configPath, JsonSerializer.Serialize(Cfg, new JsonSerializerOptions { WriteIndented = true }));
    }

    private void LoadConfig()
    {
        var dir = DataDirectory();
        _configPath = Path.Combine(dir, "config.json");

        if (!Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        if (!File.Exists(_configPath))
        {
            Cfg = new PluginConfig();
            SaveConfig();
            return;
        }

        try
        {
            Cfg = JsonSerializer.Deserialize<PluginConfig>(File.ReadAllText(_configPath)) ?? new PluginConfig();
        }
        catch (Exception ex)
        {
            PluginLog.LogError(
                $"Failed to read plugin config at '{_configPath}', using defaults (secret 'change-me'), so the bot will reject every request. " +
                $"Make sure the file is valid JSON: paths need double backslashes (C:\\\\Users\\\\...) or forward slashes (C:/Users/...). Details: {ex.Message}");
            Cfg = new PluginConfig();
        }
    }
}
