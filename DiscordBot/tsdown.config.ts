import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: "cjs",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    minify: false,
    external: [],
});
