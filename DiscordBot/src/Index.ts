import { logger, logModules } from "./Logging/Logger";
import { isClusterProcess } from "./Process/ProcessRole";

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
        const { runCluster } = await import("./Cluster/RunCluster");
        await runCluster();
    } else {
        const { config } = await import("./Config/LoadedConfig");
        const { runGateway } = await import("./Gateway/RunGateway");
        await runGateway(config);
    }
}

main().catch((error) => {
    logger.error(logModules.Bot, "Failed to start the bot", error);
    process.exit(1);
});
