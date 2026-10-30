/** Telemetry must never block startup, so a failing read disables it instead of throwing. */
export async function readInstanceId(
    read: () => Promise<string>,
    onError: (error: unknown) => void,
): Promise<string | undefined> {
    try {
        return await read();
    } catch (error) {
        onError(error);
        return undefined;
    }
}
