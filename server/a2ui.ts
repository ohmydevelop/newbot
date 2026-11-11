import { PublicError } from "./public-error.js";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { A2uiClientMessageSchema } from "@a2ui/web_core/v0_9";
import type { Item, Thread } from "../shared/types.js";
import { A2uiRuntime } from "../shared/a2ui-runtime.js";
import { createA2uiSchemaCatalog } from "../shared/a2ui-catalog.js";
import {
  A2UI_ACTIONS,
  A2UI_TOOL,
  a2uiAction,
  a2uiDraftInput,
  type A2uiView,
} from "../shared/a2ui-chat.js";
import {
  a2uiCatalogId,
  A2uiInputError,
  assertA2uiBudget,
  encodeA2ui,
} from "../shared/a2ui-policy.js";
import { a2uiToolInput } from "./a2ui-tool.js";
import type { Codex, ToolRequest } from "./codex.js";
import type { Store } from "./db.js";
import { a2uiStore, type UiReceipt } from "./a2ui-store.js";

type UiRecord = {
  view: A2uiView;
  runtime: A2uiRuntime;
  calls: Set<string>;
  pending?: { id: string | number; timer: ReturnType<typeof setTimeout> };
  consuming?: boolean;
  submission?: UiReceipt;
};
export class A2uiFailure extends PublicError {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
function fail(message: string, code = 400): never {
  throw new A2uiFailure(message, code);
}
const result = (success: boolean, value: unknown) => ({
  success,
  contentItems: [{ type: "inputText" as const, text: JSON.stringify(value) }],
});

export function a2uiManager(
  codex: Codex,
  db: Store,
  changed: (threadId: string) => void,
  running: (threadId: string, turnId: string) => boolean,
  resolveImage?: (
    threadId: string,
    turnId: string,
    itemId: string,
    source: string,
    label: string,
  ) => Promise<string>,
) {
  const records = new Map<string, UiRecord>();
  const applying = new Set<string>();
  const saved = a2uiStore(db);
  const timeoutMs = 10 * 60_000;
  const current = (request: ToolRequest) =>
    db.owns(request.params.threadId) &&
    codex.active.has(request.params.threadId) &&
    running(request.params.threadId, request.params.turnId) &&
    codex.toolRequests.has(request.id);
  const update = (
    record: UiRecord,
    draft: "retain" | "clear" = "retain",
    receipt?: UiReceipt,
  ) => {
    record.view.messages = record.runtime.snapshot();
    ++record.view.revision;
    saved.save(record.view, record.calls, draft, receipt);
    changed(record.view.threadId);
  };
  function respond(
    record: UiRecord,
    success: boolean,
    value: unknown,
    state: A2uiView["state"],
  ) {
    const pending = record.pending;
    if (!pending) fail("表单请求已失效，请重新读取会话", 409);
    const checkpoint: A2uiView = {
      ...record.view,
      revision: record.view.revision + 1,
      messages: record.runtime.snapshot(),
      state: "unavailable",
      reason: record.submission ? "submission_unconfirmed" : record.view.reason,
    };
    // Durable consume fence. Restarted clients can acknowledge an accepted
    // receipt, but an unknown pipe outcome can never resubmit the native RPC.
    saved.save(
      checkpoint,
      record.calls,
      state === "submitted" ? "clear" : "retain",
      record.submission,
    );
    // Mark consumed before writing to the pipe. A failed write must never grant
    // a second attempt to execute the same native request.
    clearTimeout(pending.timer);
    record.pending = undefined;
    delete record.view.token;
    record.view.state = state;
    if (state !== "unavailable") delete record.view.reason;
    try {
      codex.respondTool(pending.id, result(success, value));
    } catch {
      record.view.state = "unavailable";
      record.view.reason = "submission_unconfirmed";
      update(record);
      fail("表单提交状态未确认，请检查任务状态", 409);
    }
    try {
      update(
        record,
        state === "submitted" ? "clear" : "retain",
        record.submission
          ? { ...record.submission, state: "accepted" }
          : undefined,
      );
    } catch (error) {
      record.view.state = "unavailable";
      record.view.reason = "submission_unconfirmed";
      changed(record.view.threadId);
      throw error;
    }
  }
  function expire(record: UiRecord, reason: A2uiView["reason"] = "expired") {
    record.view.reason = reason;
    if (record.pending) {
      if (codex.toolRequests.has(record.pending.id)) {
        try {
          respond(
            record,
            false,
            { cancelled: true, reason: "input_unavailable" },
            "unavailable",
          );
          return;
        } catch {
          // Persistence or pipe failure must still revoke the pending native wait.
          if (record.pending && codex.toolRequests.has(record.pending.id)) {
            try {
              codex.respondTool(
                record.pending.id,
                result(false, { cancelled: true, reason: "input_unavailable" }),
              );
            } catch {
              /* Offline. */
            }
          }
        }
      }
      clearTimeout(record.pending?.timer);
      record.pending = undefined;
    }
    delete record.view.token;
    record.view.state = "unavailable";
    try {
      update(record);
    } catch {
      changed(record.view.threadId);
    }
  }
  function publicView(record: UiRecord): A2uiView {
    if (record.pending && (record.view.expiresAt || 0) <= Date.now())
      expire(record);
    const view = structuredClone(record.view);
    const draft = saved.draft(view.id, view.revision);
    view.draftVersion = draft.version;
    if (draft.values && draft.updatedAt)
      view.draft = {
        values: draft.values,
        version: draft.version,
        updatedAt: draft.updatedAt,
      };
    return view;
  }
  function makeRecord(
    view: A2uiView,
    calls = new Set<string>(),
    catalogId = a2uiCatalogId(view.messages),
  ): UiRecord {
    const r: UiRecord = { view, calls, runtime: null! };
    r.runtime = new A2uiRuntime(createA2uiSchemaCatalog(catalogId), {
      surfaceId: view.surfaceId,
      allowedActions: A2UI_ACTIONS,
      onAction: (action) => {
        const message = A2uiClientMessageSchema.parse({
          version: "v0.9",
          action,
        });
        respond(
          r,
          true,
          message,
          action.name === "cancel" ? "cancelled" : "submitted",
        );
      },
    });
    return r;
  }
  function restore(id: string): UiRecord | undefined {
    const existing = records.get(id);
    if (existing) return existing;
    const stored = saved.load(id);
    if (!stored) return;
    evict();
    let r = makeRecord(stored.view, stored.calls);
    try {
      if (r.view.messages.length) r.runtime.apply(encodeA2ui(r.view.messages));
    } catch {
      r.runtime.dispose();
      r = makeRecord(
        {
          ...stored.view,
          messages: [],
          state: "unavailable",
          reason: "invalid",
        },
        stored.calls,
      );
    }
    if (!r.runtime.components().has("root") && r.view.reason !== "invalid") {
      r.view.state = "unavailable";
      r.view.reason = "incomplete";
    }
    records.set(id, r);
    return r;
  }
  function findView(id: string) {
    const record = restore(id);
    if (!record || !db.owns(record.view.threadId))
      return fail("表单已不可用，请重新读取会话", 404);
    return record;
  }
  function evict() {
    if (records.size < 32) return;
    for (const [id, record] of records) {
      if (record.pending || record.consuming) continue;
      record.runtime.dispose();
      records.delete(id);
      if (records.size < 32) return;
    }
    fail("待处理表单已满，请先完成现有表单", 429);
  }
  async function handle(request: ToolRequest) {
    const {
      threadId,
      turnId,
      callId,
      tool,
      namespace,
      arguments: args,
    } = request.params;
    if (tool !== A2UI_TOOL || namespace) {
      codex.respondTool(
        request.id,
        result(false, { error: "unsupported_client_tool" }),
      );
      return;
    }
    let record: UiRecord | undefined;
    let lock = "";
    let fresh = false,
      applied = false;
    try {
      if (!current(request)) fail("表单任务已失效");
      assertA2uiBudget(args);
      encodeA2ui(args);
      const input = a2uiToolInput.parse(args);
      const operation = input.messages[0];
      const surfaceId =
        "createSurface" in operation
          ? operation.createSurface.surfaceId
          : "updateComponents" in operation
            ? operation.updateComponents.surfaceId
            : "updateDataModel" in operation
              ? operation.updateDataModel.surfaceId
              : operation.deleteSurface.surfaceId;
      const key = `${threadId}:${turnId}:${surfaceId}`;
      if (applying.has(key)) fail("界面正在更新，请等待当前调用完成");
      applying.add(key);
      lock = key;
      const storedId = saved.idBySurface(threadId, turnId, surfaceId);
      record = storedId ? restore(storedId) : undefined;
      if (record?.pending || record?.consuming)
        fail("表单正在等待用户操作，请勿重复创建等待");
      if (record && record.calls.size >= 128)
        fail("表单更新次数已满，请创建新表单");
      if (
        input.waitForAction &&
        [...records.values()].some(
          (r) => r.view.threadId === threadId && r.pending,
        )
      )
        fail("该会话已有表单等待填写");
      if (!record) {
        evict();
        const view: A2uiView = {
          id: randomUUID(),
          threadId,
          turnId,
          itemId: callId,
          surfaceId,
          revision: 1,
          state: "display",
          messages: [],
        };
        record = makeRecord(view, new Set(), a2uiCatalogId(input.messages));
        fresh = true;
      }
      // The shared runtime applies budget, schema and graph checks before SDK
      // processing. No unvalidated UI is forwarded to a browser.
      const validation = new A2uiRuntime(
        createA2uiSchemaCatalog(record.runtime.catalog.id),
        {
          surfaceId,
          allowedActions: A2UI_ACTIONS,
          onAction: () => {},
        },
      );
      try {
        const prior = record.runtime.snapshot();
        if (prior.length) validation.apply(encodeA2ui(prior));
        validation.apply(encodeA2ui(input.messages));
        if (input.waitForAction) {
          if (!validation.surface || !validation.components().has("root"))
            fail("等待操作前必须提供完整表单");
          validation.values();
        }
      } finally {
        validation.dispose();
      }
      for (const message of input.messages)
        if ("updateComponents" in message)
          for (const component of message.updateComponents.components)
            if (component.component === "Image") {
              if (!resolveImage) fail("图片资源接口不可用");
              component.source = await resolveImage(
                threadId,
                turnId,
                callId,
                String(component.source),
                String(component.alt),
              );
              if (!current(request)) fail("界面任务已失效");
            }
      record.runtime.apply(encodeA2ui(input.messages));
      applied = true;
      record.calls.add(callId);
      records.set(record.view.id, record);
      if (input.waitForAction) {
        record.view.state = "waiting";
        record.view.token = randomUUID();
        record.view.expiresAt = Date.now() + timeoutMs;
        const r = record;
        const timer = setTimeout(() => expire(r), timeoutMs);
        timer.unref();
        record.pending = { id: request.id, timer };
      } else {
        record.view.state = "display";
        delete record.view.expiresAt;
      }
      delete record.view.reason;
      update(record, "clear");
      if (!input.waitForAction)
        codex.respondTool(
          request.id,
          result(true, { displayed: true, surfaceId }),
        );
    } catch (error) {
      if (record && (fresh || record.pending?.id === request.id)) {
        if (record.pending) {
          clearTimeout(record.pending.timer);
          record.pending = undefined;
          record.view.state = "unavailable";
          record.view.reason = "request_resolved";
          delete record.view.token;
          try {
            update(record);
          } catch {
            /* Preserve last durable snapshot. */
          }
        }
        records.delete(record.view.id);
        record.runtime.dispose();
        if (!fresh) restore(record.view.id);
      } else if (record && applied) {
        records.delete(record.view.id);
        record.runtime.dispose();
        restore(record.view.id);
      }
      if (codex.toolRequests.has(request.id))
        codex.respondTool(
          request.id,
          result(false, {
            error:
              error instanceof A2uiInputError
                ? error.code
                : error instanceof z.ZodError
                  ? "invalid_ui_arguments"
                  : error instanceof Error &&
                      "statusCode" in error &&
                      error.statusCode === 507
                    ? "ui_storage_unavailable"
                    : "ui_request_rejected",
            hint:
              error instanceof Error &&
              "statusCode" in error &&
              error.statusCode === 507
                ? "Saved UI storage is full or unavailable. Ask the user to check storage before retrying."
                : "Use the registered catalog version, one complete tree, submit/cancel actions, and the documented limits.",
          }),
        );
    } finally {
      if (lock) applying.delete(lock);
    }
  }
  function decorateItem(threadId: string, turnId: string, item: Item): Item {
    if (item.type !== "dynamicToolCall" || item.tool !== A2UI_TOOL) return item;
    const base = {
      ...item,
      arguments: undefined,
      a2ui: undefined,
      a2uiUpdate: false,
      a2uiUnavailable: false,
      a2uiLoading: false,
    };
    const recordId = saved.idByCall(threadId, turnId, item.id);
    const record = recordId ? restore(recordId) : undefined;
    if (!record)
      return {
        ...base,
        ...(item.status === "inProgress" &&
        codex.active.has(threadId) &&
        running(threadId, turnId)
          ? { a2uiLoading: true }
          : { a2uiUnavailable: true }),
      };
    return item.id === record.view.itemId
      ? { ...base, a2ui: publicView(record) }
      : { ...base, a2uiUpdate: true };
  }
  function decorate(thread: Thread) {
    for (const turn of thread.turns) {
      turn.items = turn.items.map((item) =>
        decorateItem(thread.id, turn.id, item),
      );
      for (const id of saved.turnIds(thread.id, turn.id)) {
        const record = restore(id);
        if (
          record &&
          !turn.items.some((item) => item.id === record.view.itemId)
        )
          turn.items.push(anchor(record));
      }
    }
    return thread;
  }
  function anchor(record: UiRecord): Item {
    return {
      id: record.view.itemId,
      type: "dynamicToolCall",
      tool: A2UI_TOOL,
      status: record.pending ? "inProgress" : "completed",
      a2ui: publicView(record),
    };
  }
  function anchors(thread: Thread) {
    let changed = false;
    for (const record of records.values()) {
      if (!record.pending || record.view.threadId !== thread.id) continue;
      const turn = thread.turns.find((turn) => turn.id === record.view.turnId);
      if (turn && !turn.items.some((item) => item.id === record.view.itemId)) {
        turn.items.push(anchor(record));
        changed = true;
      }
    }
    return changed;
  }
  function scope(
    record: UiRecord,
    p: { threadId: string; turnId: string; itemId: string; surfaceId: string },
  ) {
    if (
      record.view.threadId !== p.threadId ||
      record.view.turnId !== p.turnId ||
      record.view.itemId !== p.itemId ||
      record.view.surfaceId !== p.surfaceId
    )
      fail("表单与当前会话不匹配", 403);
  }
  function waiting(record: UiRecord, p: { revision: number; token: string }) {
    if (record.pending && (record.view.expiresAt || 0) <= Date.now())
      expire(record);
    const v = record.view;
    if (
      v.revision !== p.revision ||
      v.state !== "waiting" ||
      v.token !== p.token ||
      !record.pending ||
      record.consuming ||
      !codex.toolRequests.has(record.pending.id) ||
      !codex.active.has(v.threadId) ||
      !running(v.threadId, v.turnId)
    )
      fail("表单已变化或已处理，请重新读取会话", 409);
  }
  function draft(body: unknown, clear = false) {
    assertA2uiBudget(body);
    encodeA2ui(body);
    const p = a2uiDraftInput.parse(body);
    const record = findView(p.id);
    scope(record, p);
    waiting(record, p);
    let values: Record<string, string | string[]> | null = null;
    if (!clear) {
      const validation = new A2uiRuntime(createA2uiSchemaCatalog(), {
        surfaceId: record.view.surfaceId,
        allowedActions: A2UI_ACTIONS,
        onAction: () => {},
      });
      try {
        validation.apply(encodeA2ui(record.runtime.snapshot()));
        validation.updateValues(p.values);
        values = validation.values();
      } catch {
        fail("草稿字段无效，请检查后重试");
      } finally {
        validation.dispose();
      }
    } else if (Object.keys(p.values).length) fail("清除草稿不接收字段值");
    const receipt = saved.saveDraft(
      record.view.id,
      record.view.revision,
      p.expectedVersion,
      values,
    );
    changed(record.view.threadId);
    return receipt;
  }
  async function submit(body: unknown) {
    assertA2uiBudget(body);
    encodeA2ui(body);
    const p = a2uiAction.parse(body);
    const record = findView(p.id),
      v = record.view;
    scope(record, p);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(p))
      .digest("hex");
    const prior = saved.getReceipt(p.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        fail("请勿将同一提交标识用于不同内容", 409);
      if (prior.state !== "accepted")
        fail("提交状态未确认，请检查任务状态；不会重复发送", 409);
      return { accepted: true as const };
    }
    waiting(record, p);
    const source = record.runtime.components().get(p.sourceComponentId);
    if (p.sourceComponentId !== "$cancel" && source?.component !== "Button")
      fail("表单操作无效");
    record.consuming = true;
    record.submission = {
      requestId: p.requestId,
      viewId: v.id,
      fingerprint,
      state: "unknown",
    };
    try {
      if (p.sourceComponentId === "$cancel") {
        if (Object.keys(p.values).length) fail("取消操作不接收字段值");
        respond(
          record,
          true,
          {
            version: "v0.9",
            action: {
              name: "cancel",
              surfaceId: v.surfaceId,
              sourceComponentId: "$host",
              timestamp: new Date().toISOString(),
              context: {},
            },
          },
          "cancelled",
        );
      } else {
        record.runtime.updateValues(p.values);
        await record.runtime.dispatch(p.sourceComponentId);
        if (record.pending) fail("表单操作未能提交");
      }
      const response = { accepted: true as const };

      db.audit("a2ui/action", v.id, v.state);
      return response;
    } catch (error) {
      if (saved.getReceipt(p.requestId)?.state === "unknown")
        fail("提交状态未确认，请检查任务状态；不会重复发送", 409);
      if (error instanceof A2uiInputError)
        fail("表单字段或操作无效，请检查后重试");
      throw error;
    } finally {
      record.consuming = false;
      record.submission = undefined;
    }
  }
  function stopped(threadId?: string) {
    for (const record of records.values())
      if (
        (!threadId || record.view.threadId === threadId) &&
        (record.pending || (!threadId && record.view.state === "display"))
      )
        expire(record, threadId ? "interrupted" : "runtime_stopped");
    for (const record of records.values())
      if (
        record.view.threadId === threadId &&
        record.view.state === "display" &&
        !record.runtime.components().has("root")
      )
        expire(record, "incomplete");
  }
  function resolved(id: string | number) {
    for (const record of records.values())
      if (record.pending?.id === id) expire(record, "request_resolved");
  }
  function close() {
    for (const record of records.values()) {
      if (record.pending) clearTimeout(record.pending.timer);
      record.runtime.dispose();
    }
    records.clear();
  }
  return {
    handle,
    draft,
    anchors,
    submit,
    decorate,
    decorateItem,
    stopped,
    resolved,
    close,
    read: (id: string) => publicView(findView(id)),
    waiting: (threadId: string) =>
      [...records.values()]
        .filter(
          (r) =>
            r.pending &&
            r.view.threadId === threadId &&
            r.view.state === "waiting",
        )
        .map((r) => ({ id: r.view.id, turnId: r.view.turnId })),
    get pending() {
      return [...records.values()].filter((r) => r.pending).length;
    },
  };
}
