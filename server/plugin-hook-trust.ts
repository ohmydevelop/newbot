import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Codex } from "./codex.js";
import { PublicError } from "./public-error.js";
import type { HooksListResponse } from "../generated/codex/v2/HooksListResponse.js";

/** Called only after explicit package confirmation; discovery never executes hooks.
 * The native declaration and bundle hashes bind approval to these exact bytes.
 */
export async function confirmedPluginHooks(
  directory: string,
  pluginId: string,
  root: string,
) {
  const staging = join(
    directory,
    "extensions",
    "hook-inspection",
    randomUUID(),
  );
  const work = join(staging, "work");
  await mkdir(work, { recursive: true, mode: 0o700 });
  const native = new Codex(work, () => ({
    CODEX_HOME: join(staging, "codex"),
  }));
  native.discoveryPlugins = {
    [pluginId]: { enabled: true, local_root: root },
  } as any;
  try {
    await native.start();
    if (native.state !== "ready") throw new PublicError("插件钩子校验未就绪");
    const result = (await native.call("hooks/list", {
      cwds: [work],
    })) as unknown as HooksListResponse;
    const state: Record<
      string,
      { trusted_hash: string; trusted_content_hash: string }
    > = {};
    for (const entry of result.data) {
      if (entry.errors.length)
        throw new PublicError("插件钩子无法解析，请检查插件包");
      for (const hook of entry.hooks) {
        if (hook.pluginId !== pluginId || hook.isManaged) continue;
        const [declaration, content, ...extra] = hook.currentHash.split("/");
        if (extra.length || !declaration || !content)
          throw new PublicError("原生钩子未提供完整资源指纹");
        state[hook.key] = {
          trusted_hash: declaration,
          trusted_content_hash: content,
        };
      }
    }
    return state;
  } finally {
    await native.stopAndWait();
    await rm(staging, { recursive: true, force: true });
  }
}
