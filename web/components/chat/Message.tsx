import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Copy,
  FilePenLine,
  LoaderCircle,
  Plug,
  Terminal,
} from "lucide-react";
import type { Item, Json } from "../../../shared/types";
import AttachmentPreview, { type AttachmentSource } from "../AttachmentPreview";
import { useApp } from "../../store";
import { messageKind, toolStatus } from "../../chat-presentation";
const McpApp = lazy(() => import("../McpApp"));
const ChatA2ui = lazy(() => import("../a2ui/Chat"));
const RichRenderer = lazy(() =>
  import("../Renderer").then((m) => ({ default: m.Renderer })),
);
function Renderer({ text }: { text: string }) {
  return (
    <Suspense fallback={<p style={{ whiteSpace: "pre-wrap" }}>{text}</p>}>
      <RichRenderer text={text} />
    </Suspense>
  );
}
function ToolItem({
  item,
  threadId,
  turnId,
}: {
  item: Item;
  threadId: string;
  turnId: string;
}) {
  const settings = useApp((s) => s.settings);
  const descriptor = settings?.mcp.find(
    (server: Json) => server.name === item.server,
  )?.tools?.[item.tool];
  const hasApp =
    item.type === "mcpToolCall" &&
    !!(
      item.appAvailable ||
      item.mcpAppUi?.resourceUri ||
      item.mcpAppResourceUri ||
      descriptor?._meta?.ui?.resourceUri
    ) &&
    !!item.result &&
    item.status === "completed" &&
    !item.error;
  const { failed, running, label } = toolStatus(item);
  if (item.type === "reasoning") {
    if (!item.summary?.length) return null;
    return (
      <details className="tool-item process-content">
        <summary>
          <Circle size={13} aria-hidden="true" />
          <span>思考过程</span>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        <div className="tool-detail">{item.summary.join("\n")}</div>
      </details>
    );
  }
  if (
    ![
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "webSearch",
      "plan",
      "dynamicToolCall",
    ].includes(item.type)
  )
    return null;
  const Icon =
    item.type === "commandExecution"
      ? Terminal
      : item.type === "fileChange"
        ? FilePenLine
        : item.type === "mcpToolCall"
          ? Plug
          : BookOpen;
  const title =
    item.type === "commandExecution"
      ? "执行命令"
      : item.type === "fileChange"
        ? "修改文件"
        : item.type === "mcpToolCall"
          ? `${item.server} / ${item.tool}`
          : item.type === "webSearch"
            ? "搜索网页"
            : item.type === "plan"
              ? "执行计划"
              : item.tool || "工具调用";
  return (
    <>
      <details
        className={`tool-item process-content ${failed ? "failed" : ""}`}
      >
        <summary>
          {running ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : (
            <Icon size={15} aria-hidden="true" />
          )}
          <span>{title}</span>
          <small>{label}</small>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        <div className="tool-detail">
          {item.command && <code>{item.command}</code>}
          {item.text && <Renderer text={item.text} />}
          {item.error ? (
            <p className="tool-failure">
              {item.error.message || "工具执行失败"}
            </p>
          ) : (
            <pre aria-label="工具详情">
              {item.aggregatedOutput ||
                (item.error
                  ? JSON.stringify(item.error, null, 2)
                  : item.result
                    ? JSON.stringify(
                        item.result.structuredContent || item.result.content,
                        null,
                        2,
                      )
                    : item.changes
                      ? JSON.stringify(item.changes, null, 2)
                      : item.arguments
                        ? JSON.stringify(item.arguments, null, 2)
                        : "暂无附加信息")}
            </pre>
          )}
        </div>
      </details>
      {hasApp && (
        <Suspense
          fallback={
            <p className="muted" role="status">
              加载应用…
            </p>
          }
        >
          <McpApp
            threadId={threadId}
            turnId={turnId}
            itemId={item.id}
            server={item.server}
            tool={item.tool}
          />
        </Suspense>
      )}
    </>
  );
}
const SkillReferences = lazy(() => import("../SkillReferences"));
export const Message = memo(function Message({
  item,
  threadId,
  turnId,
}: {
  item: Item;
  threadId: string;
  turnId: string;
}) {
  const [preview, setPreview] = useState<AttachmentSource | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const kind = messageKind(item);
  if (kind === "hidden") return null;
  if (kind === "form")
    return (
      <article
        className="assistant-message"
        data-content-kind="form"
        aria-label="交互表单"
      >
        <Suspense fallback={<p className="muted">正在加载表单…</p>}>
          <ChatA2ui view={item.a2ui!} />
        </Suspense>
      </article>
    );
  if (kind === "form-unavailable")
    return <p className="muted">表单内容当前不可用，请重新生成。</p>;
  if (kind === "form-loading")
    return (
      <p className="muted" role="status">
        正在生成表单…
      </p>
    );
  if (kind === "user")
    return (
      <div className="user-message" data-content-kind="user">
        <div>
          {item.content?.map((c: Json, i: number) =>
            c.type === "text" ? (
              <span key={i}>{c.text}</span>
            ) : c.type === "image" ? (
              <button
                type="button"
                className="message-image"
                key={i}
                aria-label={`预览 ${c.name || "图片"}`}
                onClick={() =>
                  setPreview({
                    name: c.name || "图片",
                    url: c.url,
                    mime: "image/png",
                  })
                }
              >
                <img src={c.url} alt={c.name || "用户附件"} />
              </button>
            ) : c.type === "attachment" ? (
              <button
                type="button"
                className="secondary"
                key={i}
                onClick={() => setPreview({ name: c.name, url: c.url })}
              >
                {c.name}
              </button>
            ) : null,
          )}
          {preview && (
            <AttachmentPreview
              value={preview}
              onClose={() => setPreview(null)}
            />
          )}
          {!!item.pluginRefs?.length && (
            <div className="skill-message-refs" aria-label="此消息使用的插件">
              {item.pluginRefs.map((p) => (
                <span key={p.id}>
                  <Plug size={14} aria-hidden="true" />
                  {p.displayName}
                </span>
              ))}
            </div>
          )}
          {!!item.skillRefs?.length && (
            <Suspense fallback={<p className="muted">正在加载技能引用…</p>}>
              <SkillReferences references={item.skillRefs} />
            </Suspense>
          )}
        </div>
      </div>
    );
  if (kind === "assistant")
    if (item.text != null && typeof item.text !== "string")
      throw new Error("Unsupported message text");
  if (kind === "assistant")
    return (
      <article
        className={`assistant-message ${item.phase === "commentary" ? "process-content" : ""}`}
        data-content-kind="assistant"
        aria-label="助手回复"
      >
        <Renderer text={item.text || ""} />
        {item.text && (
          <div className="message-actions">
            <button
              className="icon-button"
              aria-label="复制回答"
              title="复制回答"
              onClick={() => {
                setCopyError("");
                void Promise.resolve()
                  .then(() => navigator.clipboard.writeText(item.text!))
                  .then(() => {
                    setCopied(true);
                    if (copyTimer.current) clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(
                      () => setCopied(false),
                      1500,
                    );
                  })
                  .catch(() => setCopyError("复制失败，请手动选择文本。"));
              }}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
            </button>
            {copied && (
              <span className="muted" role="status">
                已复制
              </span>
            )}
            {copyError && (
              <span className="inline-error" role="alert">
                {copyError}
              </span>
            )}
          </div>
        )}
      </article>
    );
  return <ToolItem item={item} threadId={threadId} turnId={turnId} />;
});
