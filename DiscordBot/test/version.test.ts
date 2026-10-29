import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { BOT_VERSION } from "../src/version";

it("BOT_VERSION matches package.json and the plugin", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));
    const pluginInfo = readFileSync(resolve(__dirname, "../../DLL/PluginInfo.cs"), "utf-8");
    const pluginVersion = /Version\s*=\s*"([^"]+)"/.exec(pluginInfo)?.[1];
    expect(BOT_VERSION).toBe(pkg.version);
    expect(BOT_VERSION).toBe(pluginVersion);
});
