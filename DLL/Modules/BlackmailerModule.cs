using System.Collections.Generic;
using HarmonyLib;

namespace DiscordMute.Modules;

internal static class BlackmailerModule
{
    internal static HashSet<byte> GetBlackmailedPlayerIds()
    {
        var result = new HashSet<byte>();
        if (!DiscordMutePlugin.IsEhrInstalled) return result;

        try
        {
            var blackmailerType = AccessTools.TypeByName("EHR.Roles.Blackmailer");
            if (blackmailerType == null) return result;

            var onField = AccessTools.Field(blackmailerType, "On");
            if (onField == null || !(bool)onField.GetValue(null)) return result;

            var mainType = AccessTools.TypeByName("EHR.Main");
            var playerStatesField = AccessTools.Field(mainType, "PlayerStates");
            var playerStates = playerStatesField?.GetValue(null) as System.Collections.IDictionary;
            if (playerStates == null) return result;

            var blackmailedIdsField = AccessTools.Field(blackmailerType, "BlackmailedPlayerIds");
            var stateType = AccessTools.TypeByName("EHR.PlayerState");
            var roleField = stateType != null ? AccessTools.Field(stateType, "Role") : null;

            foreach (System.Collections.DictionaryEntry entry in playerStates)
            {
                var state = entry.Value;
                var role = roleField != null
                    ? roleField.GetValue(state)
                    : state?.GetType().GetField("Role")?.GetValue(state);
                if (role == null || role.GetType() != blackmailerType) continue;

                var ids = blackmailedIdsField?.GetValue(role) as System.Collections.IEnumerable;
                if (ids == null) continue;

                foreach (var id in ids)
                    result.Add((byte)id);
            }
        }
        catch (System.Exception ex)
        {
            DiscordMutePlugin.PluginLog.LogWarning($"Failed to inspect blackmailer state: {ex.Message}");
        }

        return result;
    }
}
