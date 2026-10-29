export const en = {
    "error.title": "Error",
    "error.generic": "An error occurred while running this command. Please try again later.",
    "error.commandUnavailable": "Command is not available.",

    "notice.hostNotLinked": "Link your own Discord account first with /link self.",
    "notice.hostNotInVoice": "Join a voice channel in Discord so DiscordMute knows where your game is.",

    "link.description": "Link, force-link, or unlink a Discord account and an Among Us account.",
    "link.self.description": "Links your Discord account to your Among Us account name.",
    "link.force.description": "Manually links a Discord user to an Among Us display name.",
    "link.force.user.description": "The Discord user to link",
    "link.force.displayName.description": "The Among Us display name",
    "link.reset.description": "Unlinks a Discord account. Leave 'user' empty to unlink yourself.",
    "link.reset.user.description": "The Discord user to unlink (requires Manage Server)",

    "link.failed.title": "Link Failed",
    "link.guildOnly": "This command can only be used inside a server.",
    "link.alreadyLinked.title": "Already Linked",
    "link.alreadyLinked.body": "You're linked to the Among Us account **{name}**.",
    "link.unlinkButton": "Unlink",
    "link.pluginNotReady":
        "The Among Us plugin did not accept the pending link request.\n\nStart the game with the plugin loaded and run `/link self` again.",
    "link.self.title": "Link Account",
    "link.self.instructions":
        "Open **Free Chat** in Among Us while in a lobby and type this phrase exactly:\n\n**`{phrase}`**\n\nNo Free Chat access? Send these two Quick Chat phrases as two separate messages, in any order, within 20 seconds:\n\n**{quickChat1}** and **{quickChat2}**\n\nThis code expires in **5 minutes**.",
    "link.complete.title": "Link Complete",
    "link.complete.body":
        "Your Discord account is now linked.\n\n**Discord ID:** `{discordId}`\n**Among Us Account:** `{accountName}`",
    "link.force.title": "Force Link Complete",
    "link.force.body": "**Discord User:** {user}\n**Among Us Name:** `{name}`",
    "link.force.error": "An error occurred while manually linking the account.",
    "link.error.title": "Link Error",
    "link.reset.title": "Link Reset",
    "link.reset.noneTitle": "Link Reset",
    "link.reset.selfDone": "You are no longer linked.",
    "link.reset.selfNone": "You were not linked to begin with.",
    "link.reset.userDone": "{user} is no longer linked to an Among Us account.",
    "link.reset.userNone": "{user} was not linked to begin with.",
    "link.reset.error": "An error occurred while unlinking the account.",
    "link.permission.title": "Missing Permission",
    "link.permission.body": "You need the **Manage Server** permission to do this for another user.",

    "testConnection.description": "Test the connection to the Among Us DiscordMute plugin",
    "testConnection.ok.title": "Connection Successful",
    "testConnection.ok.body": "The Among Us plugin is connected via WebSocket.",
    "testConnection.fail.title": "Connection Failed",
    "testConnection.fail.body":
        "The Among Us plugin is not connected.\n\nStart the game with the plugin loaded and try again.",
};

export type MessageKey = keyof typeof en;
