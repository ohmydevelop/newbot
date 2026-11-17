import { z } from "zod";
import { githubEventLabels } from "./events.js";
import {SourceFailure} from "../../packages/event-bridge/core.js";
import type {PullAdapter,SourceEvent} from "../../packages/event-bridge/types.js";

const checkpoint = z.strictObject({
  watermark: z.number().int().nonnegative(),
  ceiling: z.number().int().nonnegative(),
  page: z.number().int().min(1).max(1000),
});
const entry = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  event: z.string(),
  created_at: z.string(),
  issue: z
    .object({
      number: z.number().int().positive(),
      pull_request: z.unknown().optional(),
    })
    .optional(),
});
export function githubIssueEvents(
  token: (connection: string) => string,
  request: typeof fetch = fetch,
): PullAdapter {
  return {
    async pull(context) {
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(context.resource))
        throw new SourceFailure("conflict");
      let cursor: z.infer<typeof checkpoint>;
      try {
        cursor =
          context.cursor === null
            ? { watermark: 0, ceiling: 0, page: 1 }
            : checkpoint.parse(JSON.parse(context.cursor));
      } catch {
        throw new SourceFailure("gap");
      }
      const credential = token(context.connectionId);
      const response = await request(
        `https://api.github.com/repos/${context.resource}/issues/events?per_page=30&page=${cursor.page}`,
        {
          signal: context.signal,
          redirect: "error",
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "newbot-events",
            "x-github-api-version": "2026-03-10",
            ...(credential ? { authorization: "Bearer " + credential } : {}),
          },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const limited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get("x-ratelimit-remaining") === "0" ||
              !!response.headers.get("retry-after")));
        if (limited) {
          const after = Number(response.headers.get("retry-after")) * 1000;
          const reset =
            Number(response.headers.get("x-ratelimit-reset")) * 1000 -
            Date.now();
          throw new SourceFailure(
            "retry",
            Math.max(60000, Math.min(3600000, after || reset || 60000)),
          );
        }
        throw new SourceFailure(
          [401, 403, 404].includes(response.status)
            ? "auth_required"
            : response.status === 410
              ? "gap"
              : "retry",
          60000,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SourceFailure("retry");
      let raw: unknown;
      try {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 2 * 1024 * 1024) throw new SourceFailure("capacity");
          chunks.push(value);
        }
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new SourceFailure("conflict");
        }
      } finally {
        await reader.cancel();
      }
      const parsed = z.array(entry).max(30).safeParse(raw);
      if (!parsed.success) throw new SourceFailure("conflict");
      const data = parsed.data;
      if (data.some((e, i) => i > 0 && e.id > data[i - 1].id))
        throw new SourceFailure("conflict");
      const head = data[0]?.id || 0;
      if (context.cursor === null)
        return {
          cursor: JSON.stringify({ watermark: head, ceiling: 0, page: 1 }),
          events: [],
        };
      const ceiling = cursor.ceiling || Math.max(head, cursor.watermark);
      const reached = data.some((e) => e.id <= cursor.watermark);
      const more = !!response.headers.get("link")?.includes('rel="next"');
      if (!more && !reached && cursor.watermark > 0)
        throw new SourceFailure("gap");
      if (more && !reached && cursor.page === 1000)
        throw new SourceFailure("gap");
      const events: SourceEvent[] = data
        .filter((e) => e.id > cursor.watermark && e.id <= ceiling && e.issue)
        .flatMap((e) => {
          const type =
            (e.issue!.pull_request ? "pull_request." : "issue.") + e.event;
          if (!Object.hasOwn(githubEventLabels, type)) return [];
          return [
            {
              id: String(e.id),
              type,
              payload: {
                repository: context.resource,
                number: e.issue!.number,
                action: e.event,
                createdAt: e.created_at,
                url: `https://github.com/${context.resource}/${e.issue!.pull_request ? "pull" : "issues"}/${e.issue!.number}`,
              },
            },
          ];
        });
      return {
        cursor: JSON.stringify(
          reached || !more
            ? { watermark: ceiling, ceiling: 0, page: 1 }
            : { ...cursor, ceiling, page: cursor.page + 1 },
        ),
        events,
      };
    },
    async acknowledge() {},
  };
}
