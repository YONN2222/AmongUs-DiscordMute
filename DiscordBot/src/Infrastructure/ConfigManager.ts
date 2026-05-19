import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { logger, logModules } from "../Logging/logger";
import { Config } from "./ConfigSchema";

export class ConfigManager {
    private static instance: ConfigManager | null = null;
    private _config: Config | null = null;

    private constructor() {}

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    public load(configPath = "config.json"): void {
        try {
            const absolutePath = resolve(process.cwd(), configPath);
            const raw = readFileSync(absolutePath, "utf-8");
            const parsed = JSON.parse(raw);
            this._config = Config.parse(parsed);
            logger.success(logModules.Bot, `Configuration loaded from ${configPath}`);
        } catch (error) {
            if (error instanceof z.ZodError) {
                logger.error(logModules.Bot, "Configuration validation failed", error.issues);
            } else {
                logger.error(logModules.Bot, `Failed to load ${configPath}`, error);
            }
            throw error;
        }
    }

    public get config(): Config {
        if (!this._config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        return this._config;
    }
}

export const configManager = ConfigManager.getInstance();
