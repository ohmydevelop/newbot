import { basename, dirname, posix } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { importPath, type ImportFile } from "./import-files.js";
import { PublicError } from "./public-error.js";
export type EcosystemPackage = {
  root: string;
  name: string;
  ecosystem: "openclaw" | "hermes";
  skillRoots: string[];
  notice: string;
};
export function ecosystemPackages(files: ImportFile[]): EcosystemPackage[] {
  const result: EcosystemPackage[] = [];
  for (const f of files) {
    const filename = basename(f.path);
    if (
      !["openclaw.plugin.json", "plugin.yaml", "plugin.yml"].includes(filename)
    )
      continue;
    if (f.data.length > 64000)
      throw new PublicError("生态插件清单超过大小限制");
    const root = dirname(f.path),
      prefix = root === "." ? "" : root + "/";
    if (
      files.some((v) =>
        [prefix + "plugin.json", prefix + ".codex-plugin/plugin.json"].includes(
          v.path,
        ),
      )
    )
      continue;
    let value: Record<string, unknown>;
    try {
      const parsed =
        filename === "openclaw.plugin.json"
          ? JSON.parse(f.data.toString())
          : parseDocument(f.data.toString(), {
              schema: "core",
              uniqueKeys: true,
            });
      if (filename !== "openclaw.plugin.json" && parsed.errors.length)
        throw Error("yaml");
      value = z
        .record(z.string(), z.unknown())
        .parse(
          filename === "openclaw.plugin.json"
            ? parsed
            : parsed.toJS({ maxAliasCount: 0 }),
        );
    } catch {
      throw new PublicError("生态插件清单无效，不能安全读取");
    }
    const ecosystem =
      filename === "openclaw.plugin.json" ? "openclaw" : "hermes";
    const name = z
      .string()
      .trim()
      .min(1)
      .max(100)
      .parse(value.name || value.id || basename(root));
    if (result.some((r) => r.root === root))
      throw new PublicError("同一目录存在多个生态插件清单");
    const skillRoots =
      ecosystem === "openclaw"
        ? z
            .array(z.string())
            .max(128)
            .parse(value.skills || [])
            .map((path) => {
              const clean = importPath(
                path.replace(/^\.\//, "").replace(/\/$/, ""),
              );
              if (
                !files.some((f) =>
                  f.path.startsWith(prefix + clean.replace(/\/$/, "") + "/"),
                )
              )
                throw new PublicError("OpenClaw 声明的技能目录不存在");
              return posix.join(root, clean);
            })
        : [root];
    result.push({
      root,
      name,
      ecosystem,
      skillRoots,
      notice: `${ecosystem === "openclaw" ? "OpenClaw" : "Hermes"} 技能可导入；原生工具、钩子、渠道及依赖安装不执行，技能所需工具需在 newbot 单独配置。`,
    });
  }
  return result;
}
