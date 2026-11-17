import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { auth } from "@modelcontextprotocol/client";
import { localOAuthProvider } from "./local-oauth-provider.js";
import { database } from "../server/db.js";
import { credentialVault } from "../server/credential-vault.js";
import { eventOAuth } from "../server/event-subscriptions/oauth.js";

test("Event OAuth: real local authorization code/PKCE, denial, state replay, encrypted restart and refresh", async () => {
  const fixture = await localOAuthProvider(),
    dir = mkdtempSync(join(tmpdir(), "event-oauth-")),
    id = randomUUID();
  const work = join(dir, "work");
  mkdirSync(work);
  let db = database(dir),
    vault = credentialVault(db, dir, work),
    generation = 1;
  const identity = () => ({
    id,
    binding: "package-digest",
    generation,
    url: fixture.origin + "/mcp",
  });
  let oauth = eventOAuth(
    db,
    vault,
    identity,
    "http://127.0.0.1:3100/oauth/events/callback",
  );
  async function decision(url: string, value: string) {
    const html = await fetch(url).then((r) => r.text()),
      ticket = /name="ticket" value="([^"]+)"/.exec(html)![1];
    const res = await fetch(fixture.origin + "/decision", {
      method: "POST",
      body: new URLSearchParams({ ticket, decision: value }),
      redirect: "manual",
    });
    return Object.fromEntries(
      new URL(res.headers.get("location")!).searchParams,
    );
  }
  try {
    const denied = await oauth.start(id),
      q = await decision(denied.url, "deny");
    await assert.rejects(oauth.complete(q), /未完成授权/);
    const start = await oauth.start(id),
      query = await decision(start.url, "allow");
    await oauth.complete(query);
    const tokens = await oauth.provider(id).tokens();
    assert(tokens?.access_token);
    assert(
      !JSON.stringify(
        db.raw.prepare("SELECT * FROM automation_event_oauth").all(),
      ).includes(tokens.access_token),
    );
    await assert.rejects(oauth.complete(query), /过期/);
    assert.equal(await fixture.replayLastCode(), 400);
    vault.close();
    db.raw.close();
    db = database(dir);
    vault = credentialVault(db, dir, work);
    oauth = eventOAuth(
      db,
      vault,
      identity,
      "http://127.0.0.1:3100/oauth/events/callback",
    );
    assert.equal(
      (await oauth.provider(id).tokens())?.access_token,
      tokens.access_token,
    );
    await auth(oauth.provider(id), { serverUrl: fixture.origin + "/mcp" });
    assert.equal(fixture.counts.refreshed, 1);
    const stale = await oauth.start(id),
      staleQuery = await decision(stale.url, "allow");
    generation++;
    await assert.rejects(oauth.complete(staleQuery), /连接已变化/);
    assert.equal(await oauth.provider(id).tokens(), undefined);
  } finally {
    vault.close();
    db.raw.close();
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
