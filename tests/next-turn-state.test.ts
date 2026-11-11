import { test } from "node:test";
import assert from "node:assert/strict";
import { EventType } from "@ag-ui/core";
import { ComposerDrafts } from "../web/composer-drafts.js";
import { reduceAgentEvent } from "../shared/events.js";
import { mergeRecentHistory } from "../shared/history.js";
import type { Thread, SessionInputs } from "../shared/types.js";

test("an older save acknowledgement cannot replace a confirmed application or newer references", () => {
  const applied = {
    revision: 3,
    provider: "b",
    model: "m",
    effort: "high",
    approval: "ask" as const,
  };
  const current: Thread = {
    id: "t",
    turns: [],
    runtime: { ...applied, version: 9, applied },
    nextInput: {
      revision: 4,
      skills: [],
      plugins: [{ id: "new", name: "new", displayName: "new" }],
    },
  };
  const stale = {
    ...applied,
    version: 7,
    pending: { state: "pending" as const },
  };
  assert.equal(
    reduceAgentEvent(current, {
      type: EventType.CUSTOM,
      name: "newbot.session.runtime",
      value: { threadId: "t", runtime: stale },
    }).runtime,
    current.runtime,
  );
  assert.equal(
    mergeRecentHistory(current, {
      id: "t",
      turns: [],
      runtime: stale,
      nextInput: { revision: 2, skills: [], plugins: [] },
    }).nextInput,
    current.nextInput,
  );
  assert.equal(
    reduceAgentEvent(current, {
      type: EventType.CUSTOM,
      name: "newbot.session.inputs",
      value: {
        threadId: "t",
        nextInput: { revision: 3, skills: [], plugins: [] },
      },
    }).nextInput,
    current.nextInput,
  );
});

test("dispatch consumption and late acknowledgements cannot erase later draft input or references", () => {
  const drafts = new ComposerDrafts();
  const refs = (revision: number, id: string): SessionInputs => ({
    revision,
    skills: [],
    plugins: [{ id, name: id, displayName: id }],
  });
  drafts.hydrateInputs("a", refs(1, "sent"));
  drafts.setText("a", "sent body");
  const sent = drafts.get("a");
  drafts.hydrateInputs("a", { revision: 2, skills: [], plugins: [] });
  drafts.hydrateInputs("a", refs(3, "next"));
  drafts.setText("a", "next body");
  drafts.acknowledge(sent);
  drafts.hydrateInputs("a", refs(1, "stale"));
  assert.equal(drafts.get("a").plugins[0].id, "next");
  assert.equal(drafts.get("a").inputRevision, 3);
  assert.equal(drafts.get("a").text, "next body");
  assert.deepEqual(drafts.get("b").plugins, []);
});
