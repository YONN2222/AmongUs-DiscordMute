import { Database } from "bun:sqlite";
import { expect, it } from "vitest";

it("runs under the Bun runtime with bun:sqlite available", () => {
    const db = new Database(":memory:");
    const row = db.query("SELECT 1 AS value").get() as { value: number };
    expect(row.value).toBe(1);
    db.close();
});
