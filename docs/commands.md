# Commands

| Command | Purpose |
|---------|---------|
| `/link self` | Starts the self-link flow. The bot replies with a one-time phrase such as `link-AB12`. Send it exactly in Among Us Free Chat (or the Quick Chat fallback) while a lobby is open. Phrases expire after 5 minutes. |
| `/link force user display-name` | Lets a server admin link a Discord user to an Among Us display name by hand. |
| `/link reset [user]` | Unlinks your own account, or another user's (requires Manage Server). |
| `/testconnection` | Checks whether the bot can reach the Among Us plugin. |

Links are stored in `DiscordBot/data/linking.sqlite` unless you changed `sqlitePath`. If a player changes their Among Us name, they run `/link self` again or an admin uses `/link force`.
