import { describe, expect, it, vi } from "vitest";
import {
    GUILD,
    gameEvent,
    hello,
    SECRET,
    sleep,
    usePluginGatewayFixture,
    waitForClose,
} from "../Helpers/PluginGatewayFixture";

describe("PluginGateway", () => {
    const fx = usePluginGatewayFixture();

    describe("message ordering", () => {
        const delayedResolver = {
            resolve: async (secret: string) => {
                await sleep(20);
                return secret === SECRET ? { guildId: GUILD } : null;
            },
        };

        it("routes a game-event sent right after hello while the secret is still resolving", async () => {
            await fx.restart({ resolver: delayedResolver });
            const ws = await fx.connect();
            ws.send(hello());
            ws.send(gameEvent("early"));

            await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
            expect(fx.sentOfKind("game-event")[0]?.hostAccountName).toBe("early");
        });

        it("discards messages queued behind a rejected hello", async () => {
            await fx.restart({ resolver: delayedResolver });
            const ws = await fx.connect();
            const closed = waitForClose(ws);
            ws.send(hello({ secret: "wrong" }));
            ws.send(gameEvent("intruder"));

            expect((await closed).code).toBe(4001);
            await sleep(30);
            expect(fx.router.sent).toHaveLength(0);
        });

        it("handles messages in send order even when one is slow", async () => {
            const codes = await fx.linking.createPendingLink(GUILD, "user-1");
            const realConfirm = fx.linking.confirmLink.bind(fx.linking);
            vi.spyOn(fx.linking, "confirmLink").mockImplementation(async (guildId, code, accountName) => {
                await sleep(40);
                return realConfirm(guildId, code, accountName);
            });
            const ws = await fx.authenticate();

            ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
            ws.send(gameEvent("first"));
            ws.send(gameEvent("second"));

            const fromPlugin = () => fx.router.sent.filter(({ req }) => req.kind !== "session-started");
            await vi.waitFor(() => expect(fromPlugin()).toHaveLength(3));
            expect(fromPlugin().map(({ req }) => (req.kind === "game-event" ? req.hostAccountName : req.kind))).toEqual(
                ["link-confirmed", "first", "second"],
            );
        });
    });
});
