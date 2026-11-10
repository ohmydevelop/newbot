import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { command } from "./ops-common.mjs";
const [snapshot, target] = process.argv.slice(2);
if (!snapshot || !target || snapshot === "latest")
  throw new Error(
    "Usage: node scripts/restore.mjs SNAPSHOT_ID EMPTY_TARGET (pin an explicit snapshot)",
  );
const destination = resolve(target);
if (destination === "/" || destination === "/srv/newbot/data")
  throw new Error(
    "Restore into a new rehearsal directory, never the live data path",
  );
mkdirSync(destination, { recursive: true, mode: 0o700 });
if (readdirSync(destination).length)
  throw new Error("Restore target must be empty");
await command("restic", ["check"]);
await command("restic", [
  "restore",
  snapshot,
  "--tag",
  "newbot",
  "--target",
  destination,
  "--verify",
]);
console.log(
  "Restore verified by restic. Start a separate rehearsal instance with the nested restored data directory; keep public tunnel disconnected.",
);
