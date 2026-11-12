// One-time, explicit migration; source is read-only. Never import a whole personal Codex home.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  writeFile,
  lstat,
  readdir,
  chmod,
  rename,
  rm,
} from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import { prepareRuntimeIsolation } from "../server/runtime-isolation.ts";
const args = process.argv.slice(2),
  at = args.indexOf("--source-home");
if (at < 0 || !args[at + 1])
  throw Error(
    "Use --source-home /absolute/old/home; add --apply only after reviewing the report",
  );
const source = resolve(args[at + 1]),
  directory = resolve(process.env.DATA_DIR || ".data"),
  target = resolve(process.env.NEWBOT_CODEX_HOME || join(directory, "codex"));
const buildRoot = applyMigrationPath();
function applyMigrationPath() {
  return args.includes("--apply")
    ? target + ".migrating-" + randomUUID()
    : target;
}
const workspace = resolve(
    process.env.AGENT_WORKSPACE || join(directory, "workspace"),
  ),
  apply = args.includes("--apply");
const app = new DatabaseSync(join(directory, "newbot.sqlite"), {
  readOnly: true,
});
const native = new DatabaseSync(join(source, "state_5.sqlite"), {
  readOnly: true,
});
const ids = app
  .prepare("SELECT id AS thread_id FROM threads")
  .all()
  .map((r) => r.thread_id);
const threads = ids
  .map((id) => native.prepare("SELECT * FROM threads WHERE id=?").get(id))
  .filter((t) => t && resolve(t.cwd) === workspace);
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const placeholders = threads.map(() => "?").join(","),
  selected = threads.map((t) => t.id);
const fingerprint = async (path) =>
  existsSync(path)
    ? createHash("sha256")
        .update(await readFile(path))
        .digest("hex")
    : null;
const before = await fingerprint(join(source, "config.toml"));
const report = {
  mode: apply ? "apply" : "dry-run",
  threads: threads.length,
  recordedThreads: ids.length,
  filteredOut: ids.length - threads.length,
  historyModes: [...new Set(threads.map((t) => t.history_mode))],
  databaseRows: {},
  providers: 0,
  copiedRollouts: 0,
  sourceConfigUnchanged: false,
};
function cloneDatabase(inputPath, outputPath, isState) {
  if (!existsSync(inputPath)) return;
  const input = new DatabaseSync(inputPath, { readOnly: true });
  let output;
  try {
    const schema = input
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
      )
      .all();
    if (apply) {
      if (existsSync(outputPath))
        throw Error(
          "Target database already exists; migration will not overwrite it",
        );
      output = new DatabaseSync(outputPath);
      output.exec("PRAGMA foreign_keys=OFF; BEGIN");
      for (const row of schema.filter((s) => s.type === "table"))
        output.exec(row.sql);
    }
    input.exec("BEGIN");
    for (const table of schema.filter((s) => s.type === "table")) {
      const cols = input
        .prepare(`PRAGMA table_info(${quote(table.name)})`)
        .all()
        .map((c) => c.name);
      let rows = [];
      if (table.name === "_sqlx_migrations")
        rows = input.prepare(`SELECT * FROM ${quote(table.name)}`).all();
      else if (selected.length) {
        let where;
        if (isState && table.name === "threads")
          where = `id IN (${placeholders})`;
        else if (cols.includes("thread_id"))
          where = `thread_id IN (${placeholders})`;
        else if (
          cols.includes("parent_thread_id") &&
          cols.includes("child_thread_id")
        )
          where = `parent_thread_id IN (${placeholders}) AND child_thread_id IN (${placeholders})`;
        if (where)
          rows = input
            .prepare(`SELECT * FROM ${quote(table.name)} WHERE ${where}`)
            .all(...selected, ...(where.includes(" AND ") ? selected : []));
      }
      report.databaseRows[(isState ? "state/" : "history/") + table.name] =
        rows.length;
      if (output && rows.length) {
        const insert = output.prepare(
          `INSERT INTO ${quote(table.name)} (${cols.map(quote).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        );
        for (const row of rows) {
          if (isState && table.name === "threads") {
            const part = relative(source, row.rollout_path);
            if (part.startsWith("..") || isAbsolute(part))
              throw Error("Rollout is outside source home");
            row.rollout_path = join(target, part);
            if ("project_id" in row) row.project_id = null;
            if ("thread_section_id" in row) row.thread_section_id = null;
            if (
              row.attached_thread_parent_id &&
              !selected.includes(row.attached_thread_parent_id)
            )
              row.attached_thread_parent_id = null;
          }
          insert.run(...cols.map((c) => row[c]));
        }
      }
    }
    input.exec("COMMIT");
    if (output) {
      for (const row of schema.filter((s) => s.type !== "table"))
        output.exec(row.sql);
      output.exec("COMMIT; VACUUM");
    }
  } finally {
    output?.close();
    input.close();
  }
}
try {
  if (apply) {
    if (existsSync(target))
      throw Error("Target already exists; migration will not overwrite it");
    await prepareRuntimeIsolation(buildRoot);
  }
  for (const thread of threads) {
    const part = relative(source, thread.rollout_path);
    if (
      !/^(sessions|archived_sessions)\//.test(part) ||
      part.startsWith("..") ||
      !part.includes(thread.id)
    )
      throw Error("Unexpected rollout path");
    const info = await lstat(thread.rollout_path);
    if (!info.isFile() || info.isSymbolicLink())
      throw Error("Linked rollout is not supported");
    if (apply) {
      const destination = join(buildRoot, part);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(thread.rollout_path, destination, constants.COPYFILE_EXCL);
      await chmod(destination, 0o600);
    }
    report.copiedRollouts++;
  }
  cloneDatabase(
    join(source, "state_5.sqlite"),
    join(buildRoot, "state_5.sqlite"),
    true,
  );
  cloneDatabase(
    join(source, "thread_history_1.sqlite"),
    join(buildRoot, "thread_history_1.sqlite"),
    false,
  );
  const last = app
    .prepare(
      "SELECT s.* FROM session_runtime s JOIN runs r ON r.thread_id=s.thread_id ORDER BY r.updated DESC LIMIT 1",
    )
    .get();
  // Python's standard-library TOML parser is used only by this one-time maintenance tool.
  // Its stdout contains a count, never the config or credentials.
  const parsed = execFileSync(
    "python3",
    [
      "-c",
      `
import sys,json,tomllib,pathlib
source,target,apply,defaults=sys.argv[1:]
config=tomllib.loads((pathlib.Path(source)/'config.toml').read_text())
providers={key:value for key,value in config.get('model_providers',{}).items() if key.startswith('gateway_') and str(value.get('env_key','')).startswith('NEWBOT_') and not any(key in value for key in ('api_key','experimental_bearer_token'))}
defaults=json.loads(defaults)
lines=['# Private newbot runtime. Selected managed providers only.']
if defaults:
 for key,field in [('model','model'),('model_provider','provider'),('model_reasoning_effort','effort')]:
  if defaults.get(field): lines.append(key+' = '+json.dumps(defaults[field],ensure_ascii=False))
for key,value in providers.items():
 lines.append('\\n[model_providers.'+key+']')
 for name,entry in value.items():
  if isinstance(entry,(str,bool,int)): lines.append(name+' = '+json.dumps(entry,ensure_ascii=False))
if apply=='true':
 p=pathlib.Path(target)/'config.toml'
 with p.open('x') as f: f.write('\\n'.join(lines)+'\\n')
 p.chmod(0o600)
print(json.dumps({'providers':len(providers),'ids':list(providers)}))
`,
      source,
      buildRoot,
      String(apply),
      JSON.stringify(last || {}),
    ],
    { encoding: "utf8" },
  );
  const managedProviders = JSON.parse(parsed);
  report.providers = managedProviders.providers;
  if (apply) {
    for (const id of new Set([
      "openai",
      ...managedProviders.ids,
      ...threads.map((t) => t.model_provider),
    ])) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) continue;
      const file = `newbot_gateway_${id}.config.toml`,
        path = join(source, file);
      if (!existsSync(path)) continue;
      const content = await readFile(path, "utf8");
      if (content.startsWith("# Managed by newbot: gateway defaults\n"))
        await writeFile(join(buildRoot, file), content, {
          flag: "wx",
          mode: 0o600,
        });
    }
  }
  report.sourceConfigUnchanged =
    before === (await fingerprint(join(source, "config.toml")));
  if (!report.sourceConfigUnchanged)
    throw Error(
      "Source config changed concurrently; verify before using the result",
    );
  if (apply) {
    await writeFile(
      join(buildRoot, "newbot-migration.json"),
      JSON.stringify({ ...report, threadIds: selected }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    for (const file of ["state_5.sqlite", "thread_history_1.sqlite"])
      if (existsSync(join(buildRoot, file)))
        await chmod(join(buildRoot, file), 0o600);
    await rename(buildRoot, target);
  }
  const output = resolve(".issue/2026-11-09/evidence-04");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "runtime-migration-" + report.mode + ".json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (apply && existsSync(buildRoot))
    await rm(buildRoot, { recursive: true, force: true });
  throw error;
} finally {
  app.close();
  native.close();
}
