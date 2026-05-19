import { configManager } from "./Infrastructure/ConfigManager";

configManager.load("config.json");

export const config = configManager.config;
export const DISCORD_TOKEN = config.token;
export const DISCORD_CLIENT_ID = config.clientId;
export const DISCORD_GUILD_ID = config.guildId;
