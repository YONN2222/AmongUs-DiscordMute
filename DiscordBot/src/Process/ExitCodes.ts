/**
 * sysexits EX_CONFIG: the configuration cannot work (an invalid config file, or Discord refusing the bot
 * because of its token, intents or shards), so a restart would fail the same way. Clusters exit with it so the
 * gateway stops instead of respawning them, and the gateway exits with it so Docker or a process manager does
 * not restart-loop either.
 */
export const EXIT_CONFIG = 78;
