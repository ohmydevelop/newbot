import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { gatewayProfiles } from "../server/gateway-profiles.js";
async function fixture(
  fn: (
    home: string,
    profiles: ReturnType<typeof gatewayProfiles>,
  ) => Promise<void>,
) {
  const home = await mkdtemp(tmpdir() + "/newbot-profile-test-");
  try {
    await fn(
      home,
      gatewayProfiles(() => home),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
test("Codex named gateway profiles persist with private permissions and reject stale default edits", () =>
  fixture(async (home, p) => {
    assert.equal((await p.read("gateway")).revision, "absent");
    const first = await p.write("gateway", "gpt-6.1-sol", "absent");
    assert.equal(first.model, "gpt-6.1-sol");
    assert.equal(
      (await stat(home + "/newbot_gateway_gateway.config.toml")).mode & 0o777,
      0o600,
    );
    await p.write("gateway", "other-model", first.revision);
    await assert.rejects(
      p.write("gateway", "stale-model", first.revision),
      /已变化/,
    );
    assert.equal((await p.read("gateway")).model, "other-model");
    assert.match(
      await readFile(home + "/newbot_gateway_gateway.config.toml", "utf8"),
      /model_provider = "gateway"/,
    );
  }));
test("profile reads refuse symlinks, unmanaged files and arbitrary gateway paths", () =>
  fixture(async (home, p) => {
    const outside = home + "/unmanaged";
    await writeFile(outside, 'model="do-not-change"');
    await symlink(outside, home + "/newbot_gateway_link.config.toml");
    await assert.rejects(p.read("link"), /安全读取/);
    await assert.rejects(p.write("link", "gpt-6.1-sol", "absent"));
    await writeFile(
      home + "/newbot_gateway_manual.config.toml",
      'model="manual"',
    );
    await assert.rejects(
      p.write("manual", "gpt-6.1-sol", "absent"),
      /其他来源/,
    );
    await assert.rejects(p.read("../escape"));
    assert.equal(await readFile(outside, "utf8"), 'model="do-not-change"');
  }));
test("parallel writes serialize per gateway and leave no temporary configuration files", () =>
  fixture(async (home, p) => {
    const results = await Promise.allSettled([
      p.write("gateway", "first-model", "absent"),
      p.write("gateway", "second-model", "absent"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await p.read("gateway")).model, "first-model");
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(home), [
      "newbot_gateway_gateway.config.toml",
    ]);
  }));
