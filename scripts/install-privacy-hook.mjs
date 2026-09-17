import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr.trim() || "Unable to configure the Git privacy hook.");
  process.exit(result.status || 1);
}
console.log("Git pre-push privacy check enabled for this clone.");
