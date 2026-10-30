import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { logger, logModules } from "../Logging/Logger";
import { type Config, parseConfig } from "./ConfigSchema";

/** Reads and validates the config file, relative to the working directory. Logs and rethrows on failure. */
export function loadConfig(configPath = "config.json"): Config {
    try {
        const absolutePath = resolve(process.cwd(), configPath);
        const raw = readFileSync(absolutePath, "utf-8");
        const parsed = JSON.parse(raw);
        return parseConfig(parsed);
    } catch (error) {
        if (error instanceof z.ZodError) {
            logger.error(logModules.Bot, "Configuration validation failed", error.issues);
        } else {
            logger.error(logModules.Bot, `Failed to load ${configPath}`, error);
        }
        throw error;
    }
}
