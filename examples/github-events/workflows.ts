import { z } from "zod";
import { SourceFailure } from "../../packages/event-bridge/core.js";
const run = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  name: z.string().nullable(),
  status: z.literal("completed"),
  conclusion: z.string().nullable(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  html_url: z.string().url(),
  updated_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
const checkpoint = z.object({ seen: z.array(z.string().max(30)).max(100) });
export async function workflowEvents(
  input: { arguments: Record<string, unknown>; cursor: string | null },
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const repository = String(input.arguments.repository),
    branch = String(input.arguments.branch || "");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new SourceFailure("conflict");
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/runs`,
  );
  url.searchParams.set("per_page", "100");
  url.searchParams.set("status", "completed");
  if (branch) url.searchParams.set("branch", branch);
  const token = process.env.GITHUB_TOKEN;
  const response = await request(url, {
    signal,
    redirect: "error",
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "newbot-events",
      "X-GitHub-Api-Version": "2026-03-10",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  )
    throw new SourceFailure(
      "retry",
      Math.max(
        60000,
        (Number(response.headers.get("x-ratelimit-reset")) || 0) * 1000 -
          Date.now(),
      ),
    );
  if ([401, 403, 404].includes(response.status))
    throw new SourceFailure("auth_required");
  if (!response.ok) throw new SourceFailure("retry", 60000);
  const rows = z
    .object({ workflow_runs: z.array(run).max(100) })
    .parse(await response.json()).workflow_runs;
  const key = (r: z.infer<typeof run>) => `${r.id}.${r.run_attempt}`;
  const keys = rows.map(key);
  if (input.cursor === null)
    return {
      cursor: JSON.stringify({ seen: keys }),
      events: [],
      nextPollMs: 60000,
    };
  let prior: z.infer<typeof checkpoint>;
  try {
    prior = checkpoint.parse(JSON.parse(input.cursor));
  } catch {
    throw new SourceFailure("gap");
  }
  if (
    prior.seen.length &&
    rows.length === 100 &&
    !keys.some((k) => prior.seen.includes(k))
  )
    throw new SourceFailure("gap");
  const fresh = rows
    .filter((r) => !prior.seen.includes(key(r)))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, 32);
  const accepted = new Set([...prior.seen, ...fresh.map(key)]);
  return {
    cursor: JSON.stringify({ seen: keys.filter((k) => accepted.has(k)) }),
    nextPollMs: keys.some((k) => !accepted.has(k)) ? 1000 : 60000,
    events: fresh.map((r) => ({
      eventId: key(r),
      name: "workflow.completed",
      timestamp: r.updated_at,
      data: {
        repository,
        workflow: r.name || "",
        runId: r.id,
        attempt: r.run_attempt,
        branch: r.head_branch || "",
        commit: r.head_sha,
        conclusion: r.conclusion || "unknown",
        url: r.html_url,
        completedAt: r.updated_at,
      },
    })),
  };
}
