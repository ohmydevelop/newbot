import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PublicError } from "./public-error.js";
const header = "# Managed by newbot: gateway defaults\n";
export function gatewayProfiles(home: () => string | undefined) {
  const saving = new Set<string>();
  const path = (id: string) => {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id) || !home())
      throw new PublicError("原生配置目录暂不可用");
    return join(home()!, `newbot_gateway_${id}.config.toml`);
  };
  async function read(id: string) {
    if (!home()) return { model: "", revision: "absent" };
    let file;
    try {
      file = await open(path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 8192)
        throw new PublicError("网关默认配置文件不可安全读取");
      const data = await file.readFile();
      const text = data.toString("utf8");
      if (!text.startsWith(header))
        throw new PublicError("同名配置文件由其他来源管理，请先在服务端处理");
      const values: Record<string, string> = {};
      for (const line of text.split("\n")) {
        if (!line.trim() || line.startsWith("#")) continue;
        const match = line.match(/^(model|model_provider) = (".*")$/);
        if (!match)
          throw new PublicError("网关默认配置含手工扩展，请先在服务端处理");
        values[match[1]] = JSON.parse(match[2]);
      }
      if (
        values.model_provider !== id ||
        typeof values.model !== "string" ||
        values.model.length > 200
      )
        throw new PublicError("网关默认配置内容不匹配");
      return {
        model: values.model,
        revision: createHash("sha256").update(data).digest("hex"),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { model: "", revision: "absent" };
      if (e instanceof PublicError) throw e;
      throw new PublicError("网关默认配置文件不可安全读取");
    } finally {
      await file?.close();
    }
  }
  async function write(id: string, model: string, expected: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/.test(model))
      throw new PublicError("模型标识无效");
    const target = path(id);
    if (saving.has(id))
      throw new PublicError("网关默认配置正在保存，请稍后重试");
    saving.add(id);
    const temp = target + ".tmp-" + randomUUID();
    try {
      if ((await read(id)).revision !== expected)
        throw new PublicError("网关默认配置已变化，请刷新后重试");
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(
          header +
            `model = ${JSON.stringify(model)}\nmodel_provider = ${JSON.stringify(id)}\n`,
        );
        await file.sync();
      } finally {
        await file.close();
      }
      if ((await read(id)).revision !== expected)
        throw new PublicError("网关默认配置已变化，请刷新后重试");
      await rename(temp, target);
      return await read(id);
    } finally {
      await unlink(temp).catch(() => {});
      saving.delete(id);
    }
  }
  return { read, write };
}
