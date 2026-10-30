import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContainerBuilder, FOOTER_TEXT } from "../../src/Utils/ContainerBuilder";
import { BOT_VERSION } from "../../src/Version";
import { renderText } from "../Helpers/RenderText";

const SOURCE_ROOT = join(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return path.endsWith(".ts") ? [path] : [];
    });
}

describe("ContainerBuilder", () => {
    it("closes a message with a separator and the brand line", () => {
        const container = new ContainerBuilder().title("Title").text("Body").footer();
        expect(renderText([container.toJSON()])).toBe(["## Title", "Body", "---", FOOTER_TEXT].join("\n"));
    });

    it("links the website and the docs and names the version", () => {
        expect(FOOTER_TEXT).toBe(
            `-# [DiscordMute](https://mute.yonn2222.com) v${BOT_VERSION} | [Docs](https://docs.mute.yonn2222.com)`,
        );
    });

    it("is used with a footer in every file that builds a message", () => {
        const missing = sourceFiles(SOURCE_ROOT)
            .filter((path) => readFileSync(path, "utf-8").includes("new ContainerBuilder()"))
            .filter((path) => !readFileSync(path, "utf-8").includes(".footer()"));
        expect(missing).toEqual([]);
    });
});
