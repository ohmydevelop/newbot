// Isolated GCF-7 browser acceptance. Synthetic upstream, real newbot configuration paths.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { createServer } from "../server/index.js";
import { McpConfigCodex } from "./mcp-config-fixture.js";
import { SkillsCodex } from "./skill-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-plugin-center-"));
const codex = new McpConfigCodex();
const skills = new SkillsCodex(directory);
const base = codex.call.bind(codex);
const packages = [
  {
    id: "research@local",
    name: "research",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    interface: {
      displayName: "资料检索",
      shortDescription: "搜索资料、整理来源与摘要",
    },
  },
  {
    id: "workspace@local",
    name: "workspace",
    installed: true,
    enabled: false,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    interface: {
      displayName: "工作区文件",
      shortDescription: "查看和整理项目中的文件",
    },
  },
];
const bundlePath = join(directory, "bundled", "SKILL.md");
mkdirSync(join(directory, "bundled"));
writeFileSync(
  bundlePath,
  "---\nname: research-summary\ndescription: 插件内摘要技能\n---\n# 资料摘要\n\n只读整理已提供的资料。\n",
);
const bundleSkill = {
  ...skills.skills[0],
  name: "research:research-summary",
  path: bundlePath,
  pluginId: packages[0].id,
  description: "插件内摘要技能",
  interface: {
    ...skills.skills[0].interface!,
    displayName: "资料摘要",
    shortDescription: "插件内摘要技能",
  },
};
skills.skills.push(bundleSkill);
const allSkills = [...skills.skills];
codex.call = (async (method: any, params: any) => {
  if (method.startsWith("skills/")) return (skills.call as any)(method, params);
  if (method === "plugin/list")
    return {
      marketplaces: [
        { name: "local", path: "/fixture/marketplace.json", plugins: packages },
      ],
      marketplaceLoadErrors: [],
    };
  if (method === "plugin/read") {
    await new Promise((r) => setTimeout(r, 300));
    return {
      plugin: {
        summary:
          packages.find(
            (p) => p.id === params.pluginName || p.name === params.pluginName,
          ) || packages[0],
        skills: params.pluginName === "research" ? [bundleSkill] : [],
        mcpServers: [],
      },
    };
  }
  return base(method, params);
}) as typeof codex.call;
mkdirSync(join(directory, "work"));
const ctx = await createServer({
  providerRuntime: new ProviderRuntime(),
  directory: join(directory, "app"),
  cwd: join(directory, "work"),
  codex,
  password: "plugin-fixture-login",
  origins: ["http://127.0.0.1:3150"],
  webDirectory: resolve(".data/grok-plugin-web"),
});
await ctx.service.handle("expert/save", {
  name: "资料整理专家",
  description: "汇总资料并核对来源",
  skillIds: [],
  pluginIds: [packages[0].id],
  connectorIds: [],
});
ctx.app.post("/api/test/config", async (req) => {
  const action = (req.body as any).action;
  if (action === "fail") codex.failWrite = true;
  else if (action === "recover") codex.failWrite = false;
  else if (action === "external") codex.version++;
  return { ok: true };
});
ctx.app.post("/api/test/skills", async (req) => {
  const action = (req.body as any).action;
  skills.skills = action === "only-bundled" ? [bundleSkill] : [...allSkills];
  return { ok: true };
});
ctx.app.get("/api/test/state", async () => ({
  writes: codex.calls.filter((c) => c.method === "config/batchWrite").length,
  localEnabled: codex.config.mcp_servers.local.enabled,
}));
await ctx.app.listen({ host: "127.0.0.1", port: 3150 });
console.log("Plugin center fixture: http://127.0.0.1:3150");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
