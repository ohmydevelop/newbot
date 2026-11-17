import { readFileSync, readdirSync, existsSync } from "node:fs";
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
  "shared/automations.ts",
  "server/automations.ts",
  "server/credential-vault.ts",
  ...files("web/components").filter((f) => /\/Automation[^/]*\.tsx$/.test(f)),
  "web/components/AutomationSubscriptionFields.tsx",
  "web/components/EventConfigurationFields.tsx",
]) {
  const text = readFileSync(file, "utf8");
  if (
    /legacyEvent|legacyManifest|legacyAdapter|legacy-v1|provider\??\.legacy|t\.repository|t\.actions/.test(
      text,
    )
  )
    failures.push(file + ": obsolete event compatibility is forbidden");
  if (/\b(?:OpenClaw|Hermes)\b|["']github["']/i.test(text))
    failures.push(
      file + ": business event source must be declared by a plugin",
    );
  if (
    file.endsWith("AutomationScheduleFields.tsx") &&
    /eventSourceLabels|onEvent/.test(text)
  )
    failures.push(
      file + ": trigger creation must use the installed plugin catalog",
    );
  if (
    /(?:from\s*["'][^"']*examples\/|api\.github\.com|gmail\.googleapis|githubIssueEvents|githubEventLabels)/.test(
      text,
    )
  )
    failures.push(file + ": provider implementation leaked into platform");
}
for (const obsolete of [
  "server/automation-events.ts",
  "server/event-subscriptions/legacy.ts",
  "shared/legacy-automation-events.ts",
  "web/components/AutomationEventFields.tsx",
  "server/legacy/automation-events.ts",
  "web/components/legacy/AutomationEventFields.tsx",
]) {
  if (existsSync(obsolete))
    failures.push(obsolete + ": obsolete event implementation must be removed");
}
if (
  /automation-hooks|automations\/event-settings/.test(
    readFileSync("server/index.ts", "utf8"),
  )
)
  failures.push(
    "server/index.ts: obsolete event endpoints must not be registered",
  );
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
  "Event boundaries: generic platform and independent plugin implementations verified; only current plugin events are supported.",
);
