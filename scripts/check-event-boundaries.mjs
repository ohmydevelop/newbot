import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const failures = [];
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? files(join(root, d.name))
      : /\.[cm]?[jt]sx?$/.test(d.name)
        ? [join(root, d.name)]
        : [],
  );
}
for (const file of [
  ...files("server/event-subscriptions"),
  "shared/event-subscriptions.ts",
  "web/components/AutomationSubscriptionFields.tsx",
  "web/components/EventConfigurationFields.tsx",
]) {
  if (file === "server/event-subscriptions/legacy.ts") continue;
  const text = readFileSync(file, "utf8");
  if (
    /(?:from\s*["'][^"']*examples\/|api\.github\.com|gmail\.googleapis|githubIssueEvents|githubEventLabels)/.test(
      text,
    )
  )
    failures.push(file + ": provider implementation leaked into platform");
}
for (const file of files("examples").filter((f) =>
  /\/(github-events|mailbox-events|relay-events)\//.test(f),
)) {
  const text = readFileSync(file, "utf8");
  if (/from\s*["'][^"']*\/server\//.test(text))
    failures.push(file + ": plugin imports the host");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  "Event boundaries: generic platform and independent plugin implementations verified; legacy-v1 compatibility quarantined.",
);
