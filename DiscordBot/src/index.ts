import { logger, logModules } from "./Logging/logger";
import { isClusterProcess } from "./Process/processRole";

process.on("unhandledRejection", (error) => {
    logger.error(logModules.Bot, "Unhandled Promise Rejection", error);
});

process.on("uncaughtException", (error) => {
    logger.error(logModules.Bot, "Uncaught Exception", error);
    process.exit(1);
});

// One entry for both roles: the gateway spawns clusters as copies of this process.
async function main(): Promise<void> {
    if (isClusterProcess(process.env)) {
        const { runCluster } = await import("./Cluster/runCluster");
        await runCluster();
    } else {
        const { runGateway } = await import("./Gateway/runGateway");
        await runGateway();
    }
}

main().catch((error) => {
    logger.error(logModules.Bot, "Failed to start the bot", error);
    process.exit(1);
});
