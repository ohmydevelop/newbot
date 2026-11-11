import { randomBytes } from "node:crypto";
import type { Codex } from "./codex.js";
import type { ThreadItem } from "../generated/codex/v2/ThreadItem.js";
import type { Item, Json, Thread } from "../shared/types.js";
import { appFail } from "./app-error.js";
export function appToolResult(result: Json): Json {
  if (result.isError === true)
    return {
      isError: true,
      content: [{ type: "text", text: "工具执行失败，请检查服务端连接或授权" }],
    };
  return Object.fromEntries(
    Object.entries(result).filter(([, v]) => v !== null && v !== undefined),
  );
}
type Descriptor = {
  threadId: string;
  itemId: string;
  server: string;
  tool: string;
  uri: string;
  turnId?: string;
};
export type AppRecord = Descriptor & {
  token: string;
  input: Json;
  result: Json;
  tools: Set<string>;
  expires: number;
  owner?: string;
  requestId?: string;
};
type Catalog = Map<string, Map<string, { uri?: string; app: boolean }>>;
export function appRegistry(
  codex: Codex,
  options: {
    now?: () => number;
    ttlMs?: number;
    maxViews?: number;
    onCatalog?: (threadId: string, servers: Json[]) => void;
    decorateItem?: (threadId: string, item: Item) => Item;
  } = {},
) {
  const now = options.now || Date.now,
    ttl = options.ttlMs || 15 * 60000,
    maxViews = options.maxViews || 32;
  const records = new Map<string, AppRecord>(),
    descriptors = new Map<string, Descriptor>(),
    catalogs = new Map<string, Catalog>(),
    pending = new Map<string, { cancelled: boolean; owner?: string }>(),
    cancelled = new Map<string, number>(),
    listeners = new Set<(token: string) => void>();
  const key = (threadId: string, itemId: string) => `${threadId}:${itemId}`,
    requestKey = (requestId: string, owner?: string) =>
      `${owner || "internal"}:${requestId}`;
  function tombstone(requestId: string, owner?: string) {
    cancelled.set(requestKey(requestId, owner), now() + 300000);
    while (cancelled.size > 256)
      cancelled.delete(cancelled.keys().next().value!);
  }
  function remove(token: string) {
    const record = records.get(token);
    if (!record) return;
    records.delete(token);
    if (record.requestId) tombstone(record.requestId, record.owner);
    for (const fn of listeners) fn(token);
  }
  function prune() {
    for (const [token, r] of records) if (r.expires <= now()) remove(token);
    for (const [k, deadline] of cancelled)
      if (deadline <= now()) cancelled.delete(k);
  }
  function descriptor(
    threadId: string,
    item: ThreadItem,
    turnId?: string,
  ): Descriptor | undefined {
    if (
      item.type !== "mcpToolCall" ||
      !item.result ||
      item.status !== "completed" ||
      item.error
    )
      return;
    const tool = (
      catalogs.has(threadId) ? catalogs.get(threadId) : catalogs.get("")
    )
      ?.get(item.server)
      ?.get(item.tool);
    const uri =
      item.mcpAppUi?.resourceUri || item.mcpAppResourceUri || tool?.uri;
    if (
      typeof uri !== "string" ||
      !uri.startsWith("ui://") ||
      uri.length > 2048
    )
      return;
    return {
      threadId,
      itemId: item.id,
      turnId,
      server: item.server,
      tool: item.tool,
      uri,
    };
  }
  function lease(token: string, owner?: string) {
    prune();
    const r = records.get(token);
    if (!r) appFail("expired", "应用已关闭或过期，请重新打开", 410);
    if (r.owner !== owner)
      appFail("permission", "此应用不属于当前浏览器会话", 403);
    return r;
  }
  function allowed(r: Descriptor) {
    const server = catalogs.get(r.threadId)?.get(r.server);
    if (!server || server.get(r.tool)?.uri !== r.uri)
      appFail(
        "unavailable",
        "原工具当前未提供此应用，请检查 MCP 连接后重新打开",
      );
    return new Set([...server].filter(([, t]) => t.app).map(([name]) => name));
  }
  return {
    records,
    onRevoke(fn: (token: string) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    begin(requestId: string, owner?: string) {
      prune();
      const k = requestKey(requestId, owner);
      if (cancelled.has(k)) appFail("expired", "本次应用加载已取消", 410);
      if (
        pending.has(k) ||
        [...records.values()].some(
          (r) => r.requestId === requestId && r.owner === owner,
        )
      )
        appFail("busy", "此应用正在打开，请稍后重试");
      if (pending.size >= 32)
        appFail("limit", "正在加载的应用过多，请稍后重试", 429);
      const entry = { cancelled: false, owner };
      pending.set(k, entry);
      return {
        check: () => {
          if (entry.cancelled) appFail("expired", "本次应用加载已取消", 410);
        },
        finish: () => pending.delete(k),
      };
    },
    close(token: string, owner?: string) {
      const r = records.get(token);
      if (r) {
        if (r.owner !== owner)
          appFail("permission", "此应用不属于当前浏览器会话", 403);
        remove(token);
      }
    },
    cancel(requestId: string, owner?: string) {
      const k = requestKey(requestId, owner),
        entry = pending.get(k);
      if (entry) entry.cancelled = true;
      tombstone(requestId, owner);
      for (const [token, r] of records)
        if (r.requestId === requestId && r.owner === owner) remove(token);
    },
    revokeSession(owner: string) {
      for (const entry of pending.values())
        if (entry.owner === owner) entry.cancelled = true;
      for (const [token, r] of records) if (r.owner === owner) remove(token);
    },
    live(token: string) {
      prune();
      return records.get(token);
    },
    async refresh(threadId?: string, catalogKey = threadId || "") {
      const found: Json[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 20; page++) {
        const r = await codex.call("mcpServerStatus/list", {
          ...(threadId ? { threadId } : {}),
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        found.push(...(r.data || []));
        cursor = r.nextCursor || undefined;
        if (!cursor) break;
        if (seen.has(cursor))
          appFail("unavailable", "MCP 工具目录未完整读取，请重试");
        seen.add(cursor);
        if (page === 19) appFail("limit", "MCP 工具目录过大，暂时无法打开应用");
      }
      const catalog: Catalog = new Map();
      for (const server of found) {
        if (
          server.toolsError ||
          [
            "disabled",
            "failed",
            "cancelled",
            "authenticationRequired",
          ].includes(server.runtimeStatus)
        )
          continue;
        const tools = new Map<string, { uri?: string; app: boolean }>();
        for (const [name, raw] of Object.entries(server.tools || {}) as [
          string,
          Json,
        ][]) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const ui = raw._meta?.ui,
            visibility = ui?.visibility;
          // resourceUri chooses the result's UI; visibility governs calls from
          // Apps on this server connection, including ordinary data tools.
          tools.set(name, {
            uri:
              typeof ui?.resourceUri === "string" &&
              ui.resourceUri.startsWith("ui://")
                ? ui.resourceUri
                : undefined,
            app:
              visibility === undefined ||
              (Array.isArray(visibility) &&
                visibility.every((v) => v === "model" || v === "app") &&
                visibility.includes("app")),
          });
        }
        catalog.set(server.name, tools);
      }
      catalogs.set(catalogKey, catalog);
      options.onCatalog?.(catalogKey, found);
      while (catalogs.size > 32) catalogs.delete(catalogs.keys().next().value!);
      return found;
    },
    register(threadId: string, item: ThreadItem, turnId?: string) {
      const d = descriptor(threadId, item, turnId);
      if (!d) {
        descriptors.delete(key(threadId, item.id));
        return;
      }
      descriptors.delete(key(threadId, item.id));
      descriptors.set(key(threadId, item.id), d);
      while (descriptors.size > 256)
        descriptors.delete(descriptors.keys().next().value!);
      return d;
    },
    find(threadId: string, itemId: string) {
      return descriptors.get(key(threadId, itemId));
    },
    decorate(thread: Thread) {
      for (const turn of thread.turns)
        for (const item of turn.items) {
          options.decorateItem?.(thread.id, item);
          if (item.type === "mcpToolCall" && item.result) {
            if (descriptors.has(key(thread.id, item.id)))
              item.appAvailable = true;
            else delete item.appAvailable;
          }
        }
      return thread;
    },
    open(
      threadId: string,
      item: ThreadItem,
      turnId?: string,
      requestId?: string,
      owner?: string,
    ) {
      prune();
      const d = descriptor(threadId, item, turnId);
      if (!d) appFail("unavailable", "这条工具结果没有可用的交互应用");
      if (records.size >= maxViews)
        appFail("limit", "已打开的应用达到上限，请先关闭一些应用", 429);
      if (
        Buffer.byteLength(
          JSON.stringify({
            arguments: (item as Json).arguments,
            result: (item as Json).result,
          }),
        ) >
        2 * 1024 * 1024
      )
        appFail("limit", "此工具结果过大，无法加载应用");
      const r: AppRecord = {
        ...d,
        token: randomBytes(24).toString("base64url"),
        input:
          typeof (item as Json).arguments === "object" &&
          (item as Json).arguments !== null
            ? (item as Json).arguments
            : {},
        result: appToolResult((item as Json).result),
        tools: allowed(d),
        expires: now() + ttl,
        requestId,
        owner,
      };
      records.set(r.token, r);
      return r;
    },
    async resource(record: AppRecord) {
      let r;
      try {
        r = await codex.call("mcpServer/resource/read", {
          threadId: record.threadId,
          originCallId: record.itemId,
          server: record.server,
          uri: record.uri,
        });
      } catch {
        appFail("resource", "应用资源读取失败，请检查 MCP 连接后重新打开", 502);
      }
      const content = r.contents?.find(
        (c: Json) =>
          c.uri === record.uri &&
          typeof c.text === "string" &&
          typeof c.mimeType === "string" &&
          /^text\/html(?:\s*;|$)/i.test(c.mimeType),
      );
      if (
        !content ||
        !("text" in content) ||
        Buffer.byteLength(content.text) > 2 * 1024 * 1024
      )
        appFail("resource", "应用未返回可用的 HTML 资源，请检查 MCP 服务", 502);
      return content.text as string;
    },
    validate(token: string, tool: string, owner?: string) {
      const r = lease(token, owner);
      if (!r.tools.has(tool)) appFail("permission", "应用无权调用该工具", 403);
      return r;
    },
    status(token: string, owner?: string) {
      const r = lease(token, owner);
      return { state: "active", expiresAt: r.expires };
    },
    async authorize(token: string, tool: string, owner?: string) {
      const r = lease(token, owner);
      try {
        await this.refresh(r.threadId);
      } catch {
        appFail("unavailable", "MCP 工具权限暂不可确认，请重新打开应用", 502);
      }
      const fresh = lease(token, owner);
      try {
        fresh.tools = allowed(fresh);
      } catch {
        remove(token);
        appFail("expired", "应用权限已变化，请重新打开", 410);
      }
      if (!fresh.tools.has(tool))
        appFail("permission", "应用无权调用该工具", 403);
      return fresh;
    },
    clear() {
      for (const entry of pending.values()) entry.cancelled = true;
      for (const token of [...records.keys()]) remove(token);
      descriptors.clear();
      catalogs.clear();
    },
  };
}
export function sandboxDocument(html: string) {
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
}
