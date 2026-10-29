import { loadConfig } from "./LoadConfig";

// Loads config.json once, when first imported. Cluster processes and DeployCommands rely on this:
// nothing passes them the config, so they import it from here.
export const config = loadConfig("config.json");
