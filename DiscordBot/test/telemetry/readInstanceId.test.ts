import { describe, expect, it, vi } from "vitest";
import { readInstanceId } from "../../src/Telemetry/readInstanceId";

describe("readInstanceId", () => {
    it("returns the stored id", async () => {
        const onError = vi.fn();
        expect(await readInstanceId(async () => "abc", onError)).toBe("abc");
        expect(onError).not.toHaveBeenCalled();
    });

    it("reports a failing read once and returns undefined instead of throwing", async () => {
        const onError = vi.fn();
        const failure = new Error("db down");
        expect(
            await readInstanceId(async () => {
                throw failure;
            }, onError),
        ).toBeUndefined();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(failure);
    });
});
