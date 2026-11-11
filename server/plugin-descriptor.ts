import { z } from "zod";
import { dirname, resolve } from "node:path";
import {
  fileDigest,
  importPath,
  importTree,
  type ImportFile,
} from "./import-files.js";
import { PublicError } from "./public-error.js";
import type { Json } from "../shared/types.js";
import type { PluginConfigField } from "../shared/plugin-configuration.js";
import type { PrivateField } from "../shared/credentials.js";

const name = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
const field = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    title: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    default: z
      .union([z.string().max(4096), z.number().finite(), z.boolean()])
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(
    (f) => !f.sensitive || (f.type === "string" && f.default === undefined),
    "敏感字段必须是无默认值的文本",
  );
const definition = z
  .object({
    command: z.string().max(4096).optional(),
    args: z.array(z.string().max(4096)).max(64).optional(),
    cwd: z.string().max(4096).optional(),
    env: z.record(z.string(), z.string().max(4096)).optional(),
    url: z.string().max(4096).optional(),
    headers: z.record(z.string(), z.string().max(4096)).optional(),
    type: z.string().optional(),
  })
  .strict()
  .refine((d) => !!d.command !== !!d.url, "连接器必须声明一种传输方式");
const mcpbOverride = z
  .object({
    command: z.string().min(1).max(4096).optional(),
    args: z.array(z.string().max(4096)).max(64).optional(),
    env: z.record(z.string(), z.string().max(4096)).optional(),
  })
  .strict();
const mcpbDefinition = mcpbOverride.extend({
  command: z.string().min(1).max(4096),
  platform_overrides: z
    .object({
      linux: mcpbOverride.optional(),
      darwin: mcpbOverride.optional(),
      win32: mcpbOverride.optional(),
    })
    .strict()
    .optional(),
});
export type PluginDescriptor = {
  pluginId: string;
  name: string;
  id: string;
  root: string;
  configRoot?: string;
  digest: string;
  schemaDigest: string;
  definition: z.infer<typeof definition>;
  fields: (PluginConfigField & { default?: string | number | boolean })[];
  source: "package";
  reason?: string;
};
export const pluginConnectionId = (pluginId: string, server: string) =>
  `plugin_${fileDigest(JSON.stringify([pluginId, server])).slice(0, 32)}`;
const protectedEnv =
  /^(HOME|PATH|CODEX_HOME|NODE_OPTIONS|LD_.*|DYLD_.*|PYTHONPATH|PYTHONHOME|BASH_ENV|ENV|ADMIN_PASSWORD|NEWBOT_.*)$/;
const blockedHeader =
  /^(host|connection|content-length|transfer-encoding|cookie|set-cookie|proxy-authorization|upgrade|trailer)$/i;
export function pluginPackageDeclarations(files: ImportFile[]) {
  const read = (path: string): Json | undefined => {
    const f = files.find(
      (f) => f.path === importPath(path.replace(/^\.\//, "")),
    );
    if (!f) return undefined;
    if (f.data.length > 256 * 1024) throw new PublicError("插件配置描述过大");
    try {
      return JSON.parse(f.data.toString("utf8"));
    } catch {
      throw new PublicError("插件配置描述不是有效 JSON");
    }
  };
  const manifest =
    read("plugin.json") ||
    read(".codex-plugin/plugin.json") ||
    read(".claude-plugin/plugin.json") ||
    {};
  if (manifest.extensions?.["io.newbot"])
    throw new PublicError(
      "插件使用已移除的配置扩展，请改用包内 MCPB manifest.json 后重新导入",
    );
  const declaredPaths =
    manifest.mcpServers ?? manifest.extensions?.["com.openai"]?.mcpServers;
  let declarations: Json[];
  if (declaredPaths === undefined)
    declarations = [read("mcp.json") || read(".mcp.json") || {}];
  else {
    const paths = z
      .array(z.string().max(1024))
      .max(32)
      .parse(Array.isArray(declaredPaths) ? declaredPaths : [declaredPaths]);
    declarations = paths.map((path) => {
      if (!path.startsWith("./"))
        throw new PublicError("插件连接器清单必须使用包内相对路径");
      const value = read(path);
      if (!value) throw new PublicError("找不到插件声明的连接器清单");
      return value;
    });
  }
  const defs: Json = Object.create(null);
  for (const declaration of declarations) {
    for (const [name, value] of Object.entries(
      declaration.mcpServers || declaration,
    )) {
      if (name === "$schema") continue;
      if (
        !/^[a-zA-Z0-9_-]{1,100}$/.test(name) ||
        ["__proto__", "constructor", "prototype"].includes(name)
      )
        throw new PublicError("插件连接器名称无效");
      if (Object.hasOwn(defs, name))
        throw new PublicError("插件重复声明了同名连接器");
      defs[name] = value;
    }
  }
  const bundles = new Map<string, { path: string; value: Json }>();
  for (const file of files) {
    if (file.path.split("/").at(-1) !== "manifest.json") continue;
    const value = read(file.path);
    if (
      !value ||
      value.manifest_version === undefined ||
      (typeof value.manifest_version !== "string" && !value.server?.mcp_config)
    )
      continue;
    if (value.manifest_version !== "0.3")
      throw new PublicError("MCPB manifest_version 暂仅支持 0.3");
    const parsed = z
      .object({
        name: z.string().min(1).max(100),
        version: z.string().min(1).max(100),
        description: z.string().min(1).max(4096),
        author: z.object({ name: z.string().min(1).max(200) }),
        server: z.object({
          type: z.enum(["node", "python", "binary"]),
          entry_point: z.string().min(1).max(1024),
          mcp_config: mcpbDefinition,
        }),
      })
      .safeParse(value);
    if (!parsed.success)
      throw new PublicError(
        `MCPB 清单缺少必需字段或格式不受支持：${file.path}`,
      );
    if (!Object.hasOwn(defs, parsed.data.name))
      throw new PublicError("MCPB 名称必须对应插件声明的连接器");
    if (bundles.has(parsed.data.name))
      throw new PublicError("同一连接器不能包含多个 MCPB 清单");
    const entry = importPath(
      parsed.data.server.entry_point.replace(/^\.\//, ""),
    );
    const folder = dirname(file.path);
    if (
      !files.some(
        (f) => f.path === (folder === "." ? entry : `${folder}/${entry}`),
      )
    )
      throw new PublicError("MCPB entry_point 必须指向其目录内的实际文件");
    bundles.set(parsed.data.name, { path: file.path, value });
  }
  return { manifest, defs, read, bundles };
}
export async function pluginDescriptors(
  pluginId: string,
  root: string,
  expectedDigest: string,
) {
  const tree = await importTree(root);
  if (tree.digest !== expectedDigest)
    throw new PublicError("插件资源已变化，请重新导入并确认配置");
  const { defs, bundles } = pluginPackageDeclarations(tree.files);
  const result: PluginDescriptor[] = [];
  for (const [server, raw] of Object.entries(defs)) {
    if (server === "$schema") continue;
    if (result.length >= 32) throw new PublicError("插件连接器超过 32 项限制");
    const base = {
      pluginId,
      name: server,
      id: pluginConnectionId(pluginId, server),
      root,
      digest: tree.digest,
    };
    const source: PluginDescriptor["source"] = "package";
    let config: Json = raw as Json,
      configFields: Json = {};
    let reason: string | undefined;
    try {
      const bundle = bundles.get(server);
      if (bundle) {
        const { platform_overrides, ...baseConfig } = mcpbDefinition.parse(
          bundle.value.server.mcp_config,
        );
        const overrides =
          platform_overrides?.[
            process.platform as "linux" | "darwin" | "win32"
          ];
        config = {
          ...baseConfig,
          ...overrides,
          env: { ...baseConfig.env, ...overrides?.env },
        };
        configFields = bundle.value.user_config || {};
      }
      const fields = Object.entries(
        z.record(name, field).parse(configFields),
      ).map(([id, f]) => ({ ...f, id }));
      if (fields.length > 32)
        throw new PublicError("插件配置字段超过 32 项限制");
      const def = definition.parse(config);
      const descriptor = {
        ...base,
        configRoot: bundle ? resolve(root, dirname(bundle.path)) : root,
        definition: def,
        fields,
        source,
        schemaDigest: fileDigest(JSON.stringify([def, fields, tree.digest])),
      };
      // Validate all templates and destinations even before a user saves values.
      resolvePluginConfiguration(
        descriptor,
        Object.fromEntries(
          fields
            .filter((f) => !f.sensitive)
            .map((f) => [
              f.id,
              f.default ??
                (f.type === "number"
                  ? 1
                  : f.type === "boolean"
                    ? false
                    : "https://configuration.invalid"),
            ]),
        ),
      );
      result.push(descriptor);
      continue;
    } catch (error) {
      reason =
        error instanceof PublicError
          ? error.message
          : "插件配置描述包含不支持的字段或格式，请联系作者更新";
    }
    result.push({
      ...base,
      definition: { command: "" },
      fields: [],
      source,
      schemaDigest: fileDigest(JSON.stringify([raw, tree.digest])),
      reason,
    });
  }
  return result;
}

/** Expand declared data only. Never evaluate templates or interpolate secrets into commands/URLs. */
export function resolvePluginConfiguration(
  d: PluginDescriptor,
  values: Record<string, unknown>,
) {
  const fields = new Map(d.fields.map((f) => [f.id, f]));
  if (
    Object.keys(values).some((k) => !fields.has(k) || fields.get(k)!.sensitive)
  )
    throw new PublicError("普通配置包含未声明或敏感字段");
  const secrets: { id: string; field: PrivateField; required: boolean }[] = [];
  const used = new Set<string>();
  const expand = (input: string, destination?: PrivateField) => {
    if (/[\0\r\n]/.test(input))
      throw new PublicError("插件配置不能包含控制字符");
    const match = /^\$\{user_config\.([a-zA-Z_][a-zA-Z0-9_-]*)\}$/.exec(input);
    if (match && fields.get(match[1])?.sensitive) {
      if (!destination)
        throw new PublicError("敏感字段只能传递到请求头或环境变量");
      const f = fields.get(match[1])!;
      used.add(f.id);
      secrets.push({ id: f.id, field: destination, required: f.required });
      return undefined;
    }
    const output = input.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      if (key === "__dirname") return d.configRoot || d.root;
      if (
        ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "CODEX_PLUGIN_ROOT"].includes(key)
      )
        return d.root;
      const f = key.startsWith("user_config.")
        ? fields.get(key.slice(12))
        : undefined;
      if (!f || f.sensitive)
        throw new PublicError("插件包含未支持的模板变量或敏感值拼接");
      used.add(f.id);
      return String(values[f.id] ?? f.default ?? "");
    });
    if (output.includes("${")) throw new PublicError("插件模板格式无效");
    return output;
  };
  const def: Json = {};
  if (d.definition.command) {
    def.command = expand(d.definition.command);
    def.args = (d.definition.args || []).map((v) => expand(v));
    if (d.definition.cwd) def.cwd = expand(d.definition.cwd);
    def.env = {};
    for (const [key, value] of Object.entries(d.definition.env || {})) {
      if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || protectedEnv.test(key))
        throw new PublicError("插件声明了受保护或无效的环境变量");
      const next = expand(value, { kind: "env", name: key });
      if (next !== undefined) def.env[key] = next;
    }
  } else {
    def.url = expand(d.definition.url!);
    const url = new URL(def.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new PublicError("连接地址需要不含凭证和查询参数的 HTTP/HTTPS URL");
    def.http_headers = {};
    for (const [key, value] of Object.entries(d.definition.headers || {})) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || blockedHeader.test(key))
        throw new PublicError("插件声明了受保护或无效的请求头");
      const bearer =
        key.toLowerCase() === "authorization" && value.startsWith("Bearer ");
      const next = expand(bearer ? value.slice(7) : value, {
        kind: bearer ? "bearer" : "header",
        name: bearer ? "Authorization" : key,
      });
      if (next !== undefined)
        def.http_headers[key] = bearer ? `Bearer ${next}` : next;
    }
    if (
      secrets.length &&
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new PublicError("私密请求头需要 HTTPS 或本机回环地址");
  }
  if (d.fields.some((f) => !used.has(f.id)))
    throw new PublicError("配置字段未绑定到连接器，请联系插件作者");
  return { definition: def, secrets };
}
