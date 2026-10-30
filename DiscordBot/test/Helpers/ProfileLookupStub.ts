import type { ProfileLookup } from "../../src/Admin/ProfileLookup";

/** A profile lookup for tests that do not care about profiles: Discord knows nobody. */
export const unknownProfiles: ProfileLookup = {
    lookup: async () => ({ status: "unknown" }),
    lookupMany: async (userIds) => Object.fromEntries(userIds.map((userId) => [userId, null])),
};
