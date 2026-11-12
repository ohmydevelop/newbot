// Run with node --import tsx. Inspect is read-only; apply/rollback require a clean stopped instance.
import {
  inspectWorkspaceMigration,
  migrateWorkspaces,
  rollbackWorkspaceMigration,
} from "../server/runner/workspace-migration.ts";
const [action, source, target] = process.argv.slice(2);
if (!["inspect", "apply", "rollback"].includes(action) || !source || !target)
  throw new Error(
    "Usage: node --import tsx scripts/migrate-workspaces.mjs inspect|apply <server-directory> <new-workspace-root> | rollback <server-directory> <migration-id>",
  );
if (action === "inspect") {
  const plan = await inspectWorkspaceMigration(source, target);
  console.log(
    JSON.stringify(
      {
        source: plan.directory,
        target: plan.target,
        bytes: plan.bytes,
        workspaces: plan.groups.map((g) => ({
          source: g.source,
          target: g.target,
          threads: g.bindings.length,
          files: g.files.length,
        })),
      },
      null,
      2,
    ),
  );
} else
  console.log(
    JSON.stringify(
      await (action === "apply"
        ? migrateWorkspaces(source, target)
        : rollbackWorkspaceMigration(source, target)),
      null,
      2,
    ),
  );
