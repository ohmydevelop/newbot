import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  link,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareRuntimeIsolation } from "../server/runtime-isolation.js";
import { homedir } from "node:os";
import { SkillsCodex } from "./skill-fixture.js";
import { skillLibrary } from "../server/skills.js";
import { codexEnvironment } from "../server/codex.js";

test("personal Codex login tokens are not inherited from the launching coding client", () => {
  const env = codexEnvironment({
    CODEX_ACCESS_TOKEN: "personal",
    CODEX_API_KEY: "configured-provider",
    CODEX_AUTH_JSON: "personal",
    SERVICE_PROVIDER_KEY: "configured-for-server",
  });
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(env.CODEX_API_KEY, "configured-provider");
  assert.equal(env.CODEX_AUTH_JSON, undefined);
  assert.equal(env.SERVICE_PROVIDER_KEY, "configured-for-server");
});

test("host personal skill references are read-only even if native discovery advertises them as user skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-skill-isolation-"));
  try {
    const codex = new SkillsCodex(root);
    codex.home = join(root, "codex");
    codex.userHome = join(codex.home, "runtime-home");
    codex.skills = [
      {
        ...codex.skills[0],
        scope: "user",
        name: "host-agents",
        path: join(homedir(), ".agents", "skills", "outside", "SKILL.md"),
      },
      {
        ...codex.skills[0],
        scope: "user",
        name: "owned-agents",
        path: join(codex.userHome, ".agents", "skills", "inside", "SKILL.md"),
      },
    ];
    const skills = (await skillLibrary(codex, root).list()).skills;
    assert.equal(
      skills.find((s) => s.name === "host-agents")?.removable,
      false,
    );
    assert.equal(
      skills.find((s) => s.name === "owned-agents")?.removable,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private runtime keeps state, HOME and XDG inside the instance without touching host defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-isolation-"));
  try {
    const host = join(root, "host"),
      owned = join(root, "instance", "codex");
    await mkdir(join(host, ".codex"), { recursive: true });
    await writeFile(join(host, ".codex", "config.toml"), "model='host-only'\n");
    const actual = await prepareRuntimeIsolation(owned, host);
    for (const path of Object.values(actual.env)) {
      assert.ok(path === owned || path.startsWith(owned + "/"));
      assert.equal((await stat(path)).mode & 0o077, 0);
    }
    assert.notEqual(actual.env.HOME, host);
    assert.equal(
      await readFile(join(host, ".codex", "config.toml"), "utf8"),
      "model='host-only'\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("host homes and symlink aliases are refused before creating state", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-isolation-"));
  try {
    const host = join(root, "host");
    await mkdir(join(host, ".codex"), { recursive: true });
    for (const path of [
      host,
      root,
      join(host, ".codex"),
      join(host, ".codex", "nested"),
      join(host, ".agents", "newbot"),
    ])
      await assert.rejects(prepareRuntimeIsolation(path, host), /独立 Codex/);
    await symlink(join(host, ".codex"), join(root, "alias"));
    await assert.rejects(
      prepareRuntimeIsolation(join(root, "alias"), host),
      /独立 Codex/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a personal home symlink cannot bypass isolation by naming its physical target", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-personal-home-"));
  try {
    const host = join(root, "host"),
      personal = join(root, "personal-codex");
    await mkdir(host);
    await mkdir(personal);
    await symlink(personal, join(host, ".codex"));
    await assert.rejects(prepareRuntimeIsolation(personal, host), /独立 Codex/);
    await assert.rejects(
      prepareRuntimeIsolation(join(personal, "nested"), host),
      /独立 Codex/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("redirected config, SQLite, and XDG state cannot escape the instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-isolation-"));
  try {
    const host = join(root, "host"),
      owned = join(root, "instance");
    await mkdir(host);
    await mkdir(owned);
    const original = join(host, "state");
    await writeFile(original, "host");
    for (const name of ["config.toml", "state_5.sqlite"]) {
      await symlink(original, join(owned, name));
      await assert.rejects(prepareRuntimeIsolation(owned, host), /不能链接/);
      await rm(join(owned, name));
    }
    await link(original, join(owned, "config.toml"));
    await assert.rejects(prepareRuntimeIsolation(owned, host), /不能链接/);
    await rm(join(owned, "config.toml"));
    await mkdir(join(owned, "runtime-home"));
    await symlink(host, join(owned, "runtime-home", ".local"));
    await assert.rejects(prepareRuntimeIsolation(owned, host), /不能链接/);
    assert.equal(await readFile(original, "utf8"), "host");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
