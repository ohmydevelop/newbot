import {
  eventServer,
  serveEvents,
} from "../../packages/event-bridge/server.js";
import { workflowEvents } from "./workflows.js";
import { githubEventLabels } from "./events.js";
import { githubIssueEvents } from "./adapter.js";
const adapter = githubIssueEvents(() => process.env.GITHUB_TOKEN || "");
const server = eventServer(
  "github-events",
  Object.entries({
    ...githubEventLabels,
    "workflow.completed": "工作流已完成",
  }).map(([name, title]) => ({
    name,
    title,
    delivery: ["poll"],
    inputSchema: {
      type: "object",
      properties: {
        repository: {
          type: "string",
          title: "仓库",
          minLength: 3,
          maxLength: 200,
        },
        ...(name === "workflow.completed"
          ? {
              branch: {
                type: "string" as const,
                title: "分支",
                maxLength: 200,
              },
            }
          : {}),
      },
      required: ["repository"],
      additionalProperties: false,
    },
    payloadSchema: { type: "object" },
  })),
  async (input, signal) => {
    if (input.name === "workflow.completed")
      return workflowEvents(input, signal);
    const repository = String(input.arguments.repository);
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
      throw new Error("Invalid repository");
    const page = await adapter.pull({
      connectionId: "account",
      resource: repository,
      cursor: input.cursor,
      signal,
    });
    return {
      cursor: page.cursor,
      nextPollMs: 60000,
      events: page.events
        .filter((e) => e.type === input.name)
        .map((e) => ({
          eventId: e.id,
          name: e.type,
          timestamp: String(e.payload.createdAt),
          data: e.payload,
        })),
    };
  },
);
await serveEvents(server);
