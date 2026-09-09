import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
// Never replace an existing encryption key: stored API credentials depend on it.
if (!existsSync(".dev.vars")) {
 writeFileSync(".dev.vars",`TAVERN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`,{mode:0o600});
 console.log("Local encryption key created in ignored .dev.vars. Keep this file with your local database.");
} else console.log("Existing local encryption key preserved.");
