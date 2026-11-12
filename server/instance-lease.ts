import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, realpath, open } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { PublicError } from "./public-error.js";

async function durableJson(directory: string, value: unknown) {
  const path = join(directory, ".instance-state.json"),
    temp = path + "." + randomUUID();
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  const parent = await open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
/** Linux abstract socket provides a process-scoped local lock: crash releases it
 * without deleting a potentially newer owner's lockfile. It accepts no commands.
 * Shared network filesystems/multiple machines require the remote node lease, not this lock.
 */
export async function instanceLease(
  directory: string,
  purpose: "server" | "migration" | "runner" = "server",
) {
  if (process.platform !== "linux")
    throw new PublicError("此执行节点版本需要 Linux 实例锁支持");
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== directory)
    throw new PublicError("实例目录不能经过链接");
  const socket = createServer((connection) => connection.destroy());
  await new Promise<void>((ok, fail) => {
    socket.once("error", (error) =>
      fail(
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? new PublicError("此实例仍在运行，不能重复启动或迁移")
          : error,
      ),
    );
    socket.listen(
      "\0newbot-" + createHash("sha256").update(directory).digest("hex"),
      ok,
    );
  });
  socket.unref();
  let released = false;
  const generation = randomUUID();
  const close = () =>
    new Promise<void>((ok, fail) =>
      socket.close((error) => (error ? fail(error) : ok())),
    );
  try {
    let previous: { clean?: boolean } | null = null;
    try {
      previous = JSON.parse(
        await readFile(join(directory, ".instance-state.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (purpose === "migration" && previous?.clean !== true)
      throw new PublicError(
        "缺少已正常停止的实例记录；请先用当前版本启动并正常关闭源实例",
      );
    if (purpose === "runner" && previous && previous.clean !== true)
      throw new PublicError(
        "执行节点上次未正常停止，需先核验并终止遗留进程，再通过恢复流程接管",
      );
    if (purpose !== "migration")
      await durableJson(directory, {
        clean: false,
        at: Date.now(),
        generation,
      });
    return {
      async release(clean = false) {
        if (released) return;
        if (purpose !== "migration")
          await durableJson(directory, { clean, at: Date.now(), generation });
        await close();
        released = true;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
