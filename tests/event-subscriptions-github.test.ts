import { test } from "node:test";
import assert from "node:assert/strict";
import { githubIssueEvents } from "../examples/github-events/adapter.js";
import { SourceFailure } from "../server/event-subscriptions/contracts.js";
const e = (id: number, event = "closed") => ({
  id,
  event,
  created_at: "2026-11-17T00:00:00Z",
  issue: { number: 10 },
});
const context = (cursor: string | null) => ({
  connectionId: "account",
  resource: "owner/repo",
  cursor,
  signal: AbortSignal.timeout(1000),
});
test("GitHub baseline, bounded pagination, immutable normalized payload, gap and rate limit", async () => {
  let data: unknown[] = [e(100)],
    link = "",
    status = 200;
  const urls: string[] = [];
  const adapter = githubIssueEvents(
    () => "",
    async (url) => {
      urls.push(String(url));
      return Response.json(data, {
        status,
        headers: { link, "retry-after": "120" },
      });
    },
  );
  const baseline = await adapter.pull(context(null));
  assert.equal(baseline.events.length, 0);
  data = [
    e(300),
    {
      ...e(250, "labeled"),
      issue: { number: 11, pull_request: { url: "ignored" } },
    },
  ];
  link = '<https://attacker.invalid/>; rel="next"';
  const page = await adapter.pull(context(baseline.cursor));
  assert.equal(page.events.length, 2);
  assert.equal(page.events[1].type, "pull_request.labeled");
  data = [e(250, "labeled"), e(200), e(100)];
  link = "";
  const last = await adapter.pull(context(page.cursor));
  assert(urls[2].startsWith("https://api.github.com/repos/owner/repo/"));
  assert(urls[2].endsWith("page=2"));
  assert.equal(JSON.parse(last.cursor).watermark, 300);
  data = [e(400)];
  await assert.rejects(
    adapter.pull(context(last.cursor)),
    (e) => e instanceof SourceFailure && e.code === "gap",
  );
  status = 429;
  await assert.rejects(
    adapter.pull(context(last.cursor)),
    (e) =>
      e instanceof SourceFailure &&
      e.code === "retry" &&
      e.retryAfterMs === 120000,
  );
});
test("GitHub unknown event omitted, access denied stops; fixed origin cannot be overridden", async () => {
  const adapter = githubIssueEvents(
    () => "token",
    async () => Response.json([e(200, "unknown-future-event"), e(100)]),
  );
  const page = await adapter.pull(
    context(JSON.stringify({ watermark: 100, ceiling: 0, page: 1 })),
  );
  assert.equal(page.events.length, 0);
  await assert.rejects(
    adapter.pull({ ...context(null), resource: "owner/repo?redirect=evil" }),
    SourceFailure,
  );
  const denied = githubIssueEvents(
    () => "",
    async () => new Response(null, { status: 401 }),
  );
  await assert.rejects(
    denied.pull(context(null)),
    (e) => e instanceof SourceFailure && e.code === "auth_required",
  );
});
