import { openDatabase } from "../../src/Data/database";
import { writeRepeatedly } from "./sqliteWriter";

// Usage: bun sqliteWriterProcess.ts <storage> <prefix> <iterations>
async function run(): Promise<void> {
    const [storage, prefix, iterations] = process.argv.slice(2);
    const db = await openDatabase({ dialect: "sqlite", storage: storage as string }, { migrate: false });
    try {
        await writeRepeatedly(db, prefix as string, Number(iterations));
    } finally {
        await db.close();
    }
}

run().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
