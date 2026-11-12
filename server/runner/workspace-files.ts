import { constants, realpathSync } from "node:fs";
import { lstat, open, realpath, opendir } from "node:fs/promises";
import { isAbsolute, relative, sep, resolve, join, extname } from "node:path";
import { PublicError } from "../public-error.js";
const blockedName =
  /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite(?:-wal|-shm)?|db)|(?:id_(?:rsa|ed25519)|credentials|secrets?|initial-password)(?:\..*)?)$/i;
function within(root: string, path: string) {
  const p = relative(root, path);
  return (
    p === "" || (!p.startsWith(`..${sep}`) && p !== ".." && !isAbsolute(p))
  );
}
export class WorkspaceFileError extends PublicError {
  constructor(readonly reason: string) {
    super("工作区文件无法读取");
  }
}
const fail = (reason: string): never => {
  throw new WorkspaceFileError(reason);
};
/** Physical workspace access belongs to the local Runner; no DB or user configuration writes. */
export function localWorkspaceFiles(
  workspace: string,
  privateRoot: string,
  MAX_FILE: number,
  textExtensions: Set<string>,
) {
  function pathOf(
    input: string,
    native = false,
    root = realpathSync(workspace),
  ) {
    if (!input || input.length > 1024 || /[\\\x00-\x1f\x7f]/.test(input))
      fail("invalid_path");
    let path = input;
    if (isAbsolute(path)) {
      if (!native || !within(root, path)) fail("outside_workspace");
      path = relative(root, path);
    }
    const parts = path.split("/");
    if (
      parts.some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          p.startsWith(".") ||
          blockedName.test(p),
      )
    )
      fail("restricted_path");
    const full = resolve(root, ...parts);
    if (
      !within(root, full) ||
      (privateRoot !== root &&
        within(root, privateRoot) &&
        within(privateRoot, full))
    )
      fail("restricted_path");
    if (
      privateRoot === root &&
      ["artifacts", "uploads", "codex", "codex-home"].includes(parts[0])
    )
      fail("restricted_path");
    return { path: parts.join("/"), full };
  }
  async function validate(
    full: string,
    directoryOnly = false,
    root = realpathSync(workspace),
  ) {
    let current = root;
    const parts = relative(root, full).split(sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        (i < parts.length - 1 && !info.isDirectory())
      )
        fail("unsafe_link");
    }
    const canonical = await realpath(full);
    if (canonical !== full || !within(root, canonical)) fail("unsafe_link");
    if (directoryOnly && !(await lstat(full)).isDirectory())
      fail("not_directory");
  }
  async function readBounded(
    full: string,
    workspaceFile: boolean,
    root = realpathSync(workspace),
  ) {
    if (workspaceFile) await validate(full, false, root);
    const handle = await open(
      full,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1) fail("unsafe_file");
      if (before.size > MAX_FILE) fail("file_too_large");
      if (
        workspaceFile &&
        process.platform === "linux" &&
        (await realpath(`/proc/self/fd/${handle.fd}`)) !== full
      )
        fail("unsafe_link");
      const data = Buffer.alloc(before.size);
      let count = 0;
      while (count < data.length) {
        const result = await handle.read(
          data,
          count,
          data.length - count,
          count,
        );
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      const after = await handle.stat();
      if (workspaceFile) await validate(full, false, root);
      const current = await lstat(full);
      if (
        count !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.nlink !== 1
      )
        fail("file_changed");
      return data;
    } finally {
      await handle.close();
    }
  }
  return {
    pathOf,
    validate,
    readBounded,
    async list(input = "", offset = 0, root = realpathSync(workspace)) {
      const full = input ? pathOf(input, false, root).full : root;
      await validate(full, true, root);
      const dir = await opendir(full);
      const entries = [];
      let scanned = 0;
      let truncated = false;
      for await (const entry of dir) {
        if (++scanned > 5000) {
          truncated = true;
          break;
        }
        const path = input ? `${input}/${entry.name}` : entry.name;
        try {
          pathOf(path, false, root);
        } catch {
          continue;
        }
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
          continue;
        if (
          entry.isFile() &&
          !textExtensions.has(extname(path).toLowerCase()) &&
          ![".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(
            extname(path).toLowerCase(),
          )
        )
          continue;
        if (entry.isFile() && (await lstat(join(full, entry.name))).nlink !== 1)
          continue;
        entries.push({
          path,
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        });
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return {
        entries: entries.slice(offset, offset + 100),
        nextOffset: offset + 100 < entries.length ? offset + 100 : null,
        truncated,
      };
    },
  };
}
export type RunnerWorkspaceFiles = ReturnType<typeof localWorkspaceFiles>;
