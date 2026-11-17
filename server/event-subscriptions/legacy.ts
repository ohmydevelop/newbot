import { z } from "zod";
import { githubEventLabels } from "../../examples/github-events/events.js";
import { githubIssueEvents } from "../../examples/github-events/adapter.js";
export const legacyManifest = z.strictObject({
  version: z.literal(1),
  sources: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      adapter: z.literal("github-issue-events-v1"),
    }),
  ),
});
export const legacyEvents = Object.entries(githubEventLabels).map(
  ([id, label]) => ({
    id,
    label,
    inputSchema: {
      type: "object" as const,
      properties: {
        repository: {
          type: "string" as const,
          title: "仓库",
          minLength: 3,
          maxLength: 200,
        },
      },
      required: ["repository"],
    },
  }),
);
export const legacyAdapter = githubIssueEvents;
