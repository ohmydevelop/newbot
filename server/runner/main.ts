import { lstat, readFile, mkdir, readdir, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { protectedPath } from "./locations.js";
import { instanceLease } from "../instance-lease.js";
import { RunnerLedger } from "./ledger.js";
import { NativeRunnerAgent } from "./native-agent.js";
import { runRunnerConnection } from "./connection.js";
import { PublicError } from "../public-error.js";
const configSchema = z
  .object({
    server: z.string().url(),
    nodeId: z.string().uuid(),
    token: z.string().regex(/^[\w-]{43}$/),
    binary: z.string().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.string().min(1),
    codexHome: z.string().min(1),
    workspaces: z.string().min(1),
    allowLocalHttp: z.boolean().optional(),
  })
  .strict();
export async function startRunner(configPath: string, signal: AbortSignal) {
  const file = await lstat(configPath);
  if (
    !file.isFile() ||
    file.nlink !== 1 ||
    file.mode & 0o077 ||
    file.size > 16384
  )
    throw new PublicError("节点注册文件需要独立的0600普通文件");
  const config = configSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );
  const dirs = [config.state, config.codexHome, config.workspaces].map((p) =>
    protectedPath(resolve(p)),
  );
  for (let i = 0; i < dirs.length; i++)
    for (let j = 0; j < dirs.length; j++)
      if (i !== j) {
        const r = relative(dirs[i], dirs[j]);
        if (!r || (!r.startsWith("../") && !isAbsolute(r)))
          throw new PublicError("节点状态、内核与工作区需要互不包含的独立目录");
      }
  // Strip inherited credentials and desktop configuration before creating any native process.
  const keep = new Set([
    "PATH",
    "LANG",
    "LC_ALL",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ]);
  for (const key of Object.keys(process.env))
    if (!keep.has(key)) delete process.env[key];
  const binary = resolve(config.binary),
    digest = createHash("sha256");
  for await (const bytes of createReadStream(binary)) digest.update(bytes);
  if (digest.digest("hex") !== config.fingerprint)
    throw new PublicError("节点内核摘要与登记版本不匹配");
  for (const dir of dirs) await mkdir(dir, { recursive: true, mode: 0o700 });
  // Reject an unowned existing tree before the instance lock writes any marker into it.
  for (const dir of dirs) {
    const names = await readdir(dir);
    if (names.length && !names.includes(".runner-owner.json"))
      throw new PublicError(
        "独立节点不能直接接管已有运行目录，请使用迁移或恢复流程",
      );
    if (names.includes(".runner-owner.json")) {
      const marker = join(dir, ".runner-owner.json"),
        info = await lstat(marker);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        JSON.parse(await readFile(marker, "utf8")).nodeId !== config.nodeId
      )
        throw new PublicError("运行目录属于其他节点");
    }
  }
  const locks: Awaited<ReturnType<typeof instanceLease>>[] = [];
  let ledger: RunnerLedger | undefined, agent: NativeRunnerAgent | undefined;
  try {
    for (const dir of dirs) locks.push(await instanceLease(dir, "runner"));
    // Never adopt an existing local Server/Codex tree merely because a path was supplied.
    for (const dir of dirs) {
      const marker = join(dir, ".runner-owner.json");
      const names = await readdir(dir);
      if (names.includes(".runner-owner.json")) {
        const info = await lstat(marker);
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          JSON.parse(await readFile(marker, "utf8")).nodeId !== config.nodeId
        )
          throw new PublicError("运行目录属于其他节点");
      } else {
        if (names.some((name) => name !== ".instance-state.json"))
          throw new PublicError(
            "独立节点不能直接接管已有运行目录，请使用迁移或恢复流程",
          );
        const file = await open(marker, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ nodeId: config.nodeId }));
          await file.sync();
        } finally {
          await file.close();
        }
        const parent = await open(dir, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    }
    ledger = new RunnerLedger(dirs[0], config.nodeId);
    agent = new NativeRunnerAgent(ledger, dirs[1], dirs[2], binary);
    await runRunnerConnection({
      server: config.server,
      token: config.token,
      fingerprint: config.fingerprint,
      ledger,
      signal,
      allowLocalHttp: config.allowLocalHttp,
      start: () => agent!.start(),
      health: () => agent!.health(),
      stop: () => agent!.stop(),
      perform: (c) => agent!.perform(c),
    });
  } finally {
    await agent?.stop();
    ledger?.close();
    // Even a network failure is a clean local stop if all owned runtime IO is stopped.
    for (const lock of locks.reverse()) await lock.release(true);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"] as const)
    process.once(event, () => controller.abort());
  try {
    if (!process.argv[2])
      throw new PublicError(
        "用法：node --import tsx server/runner/main.ts /path/to/runner.json",
      );
    await startRunner(process.argv[2], controller.signal);
  } catch (error) {
    console.error(
      error instanceof PublicError
        ? error.message
        : "执行节点启动或连接失败；请核对登记配置与服务端状态",
    );
    process.exitCode = 1;
  }
}
