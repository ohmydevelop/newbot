import {
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const modulePath = resolve(process.argv[2] || "dist/server/index.js");
const repeats = Number(process.env.BENCH_REPEATS || 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw new Error("BENCH_REPEATS must be between 1 and 10");
const runs = [];
function copyRawAssets(source, target) {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    const from = join(source, name),
      to = join(target, name);
    if (statSync(from).isDirectory()) copyRawAssets(from, to);
    else if (!/\.(br|gz|deflate)$/.test(name)) copyFileSync(from, to);
  }
}
for (let i = 0; i < repeats; i++) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-bench-"));
  try {
    // Both implementations see the same raw-only asset tree; compression variants must not inflate baseline route counts.
    const fixture = join(directory, "dist/web");
    const manifest = resolve("dist/web/.vite/manifest.json");
    if (existsSync(manifest)) {
      const rows = Object.values(JSON.parse(readFileSync(manifest, "utf8")));
      const files = new Set([
        "index.html",
        ...rows.flatMap((r) => [r.file, ...(r.css || []), ...(r.assets || [])]),
      ]);
      for (const file of files) {
        if (typeof file !== "string" || file.includes("..")) continue;
        const to = join(fixture, file);
        mkdirSync(resolve(to, ".."), { recursive: true });
        copyFileSync(resolve("dist/web", file), to);
      }
    } else copyRawAssets(resolve("dist/web"), fixture);
    const source = `
      import {registerHooks} from 'node:module';
      const loaded=new Set();
      registerHooks({load(url,context,next){loaded.add(url);return next(url,context);}});
      const start=performance.now();
      const {createServer}=await import(${JSON.stringify(pathToFileURL(modulePath).href)});
      const imported={...process.memoryUsage(),atMs:Math.round(performance.now()-start)};
      const ctx=await createServer({
    providerRuntime: null,directory:${JSON.stringify(directory)},cwd:${JSON.stringify(directory)},password:'benchmark-only-password',origins:['http://localhost:3100']});
      await ctx.app.ready();
      const initialized={...process.memoryUsage(),atMs:Math.round(performance.now()-start)};
      const login=()=>ctx.app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:3100'},payload:{password:'benchmark-only-password'}});
      const first=await login(); if(first.statusCode!==200)throw new Error('Benchmark login failed');
      const afterLogin={...process.memoryUsage(),atMs:Math.round(performance.now()-start)};
      const burst=await Promise.all(Array.from({length:4},()=>login()));
      const afterBurst={...process.memoryUsage(),atMs:Math.round(performance.now()-start)};
      await new Promise(r=>setTimeout(r,1000));
      const settled={...process.memoryUsage(),atMs:Math.round(performance.now()-start)};
      console.log(JSON.stringify({node:process.version,imported,initialized,afterLogin,afterBurst,settled,maxRssMiB:process.resourceUsage().maxRSS/1024,loginStatuses:burst.map(r=>r.statusCode),otelSdkLoaded:[...loaded].some(x=>/opentelemetry\\/(sdk-node|exporter-trace)/.test(x)),modules:loaded.size}));
      await ctx.app.close();
    `;
    const result = await new Promise((resolveRun, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          cwd: directory,
          env: {
            ...process.env,
            NODE_ENV: "test",
            ADMIN_PASSWORD: "",
            OTEL_EXPORTER_OTLP_ENDPOINT: "",
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        error = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (error += d));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolveRun(JSON.parse(output.trim()))
          : reject(new Error("Benchmark failed: " + error)),
      );
    });
    runs.push(result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const median = (key) =>
  [...runs.map((r) => r[key].rss / 1048576)].sort((a, b) => a - b)[
    Math.floor(runs.length / 2)
  ];
const report = {
  at: new Date().toISOString(),
  module: modulePath,
  allocatorArenaMax: process.env.MALLOC_ARENA_MAX || "system default",
  scope:
    "isolated Node Bridge, identical raw-only current-generation static asset fixture, no Codex/MCP child, no forced GC",
  runs,
  medianRssMiB: {
    imported: median("imported"),
    initialized: median("initialized"),
    afterLogin: median("afterLogin"),
    afterBurst: median("afterBurst"),
    settled: median("settled"),
  },
};
mkdirSync(".data", { recursive: true, mode: 0o700 });
writeFileSync(
  process.env.BENCH_REPORT || ".data/benchmark-bridge.json",
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      medianRssMiB: report.medianRssMiB,
      otelSdkLoaded: runs[0].otelSdkLoaded,
      modules: runs[0].modules,
    },
    null,
    2,
  ),
);
