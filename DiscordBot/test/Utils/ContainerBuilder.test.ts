import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContainerBuilder, FOOTER_BANNER_URL } from "../../src/Utils/ContainerBuilder";
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
    it("closes a message with a separator and the brand banner", () => {
        const container = new ContainerBuilder().title("Title").text("Body").footer();
        expect(renderText([container.toJSON()])).toBe(
            ["## Title", "Body", "---", `[image ${FOOTER_BANNER_URL}]`].join("\n"),
        );
    });

    it("loads the banner from the website and describes it for screen readers", () => {
        const json = new ContainerBuilder().footer().toJSON() as {
            components: { items?: { media: { url: string }; description?: string }[] }[];
        };
        const [item] = json.components[1]?.items ?? [];
        expect(item?.media.url).toBe("https://mute.yonn2222.com/brand/discord-footer.png");
        expect(item?.description).toBe("DiscordMute");
    });

    it("has the banner file in the website's public folder", () => {
        expect(existsSync(join(__dirname, "../../../Website/public/brand/discord-footer.png"))).toBe(true);
    });

    it("is used with a footer in every file that builds a message", () => {
        const missing = sourceFiles(SOURCE_ROOT)
            .filter((path) => readFileSync(path, "utf-8").includes("new ContainerBuilder()"))
            .filter((path) => !readFileSync(path, "utf-8").includes(".footer()"));
        expect(missing).toEqual([]);
    });
});
