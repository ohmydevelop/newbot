import { MediaGallery } from "../MediaImage";
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  UsersRound,
  Check,
  ChevronRight,
  Circle,
  Copy,
  FilePenLine,
  LoaderCircle,
  Plug,
  Search,
  ListChecks,
  Wrench,
  Terminal,
} from "lucide-react";
import type { Item, Json } from "../../../shared/types";
import { extractSuggestions } from "../../../shared/suggestions";
import AttachmentPreview, { type AttachmentSource } from "../AttachmentPreview";
import { useApp } from "../../store";
import {
  messageKind,
  toolStatus,
  hasItemOutput,
  toolTitle,
} from "../../chat-presentation";
import { anchorDisclosure } from "../../chat-scroll";
const McpApp = lazy(() => import("../McpApp"));
const ChatA2ui = lazy(() => import("../a2ui/Chat"));
const RichRenderer = lazy(() =>
  import("../Renderer").then((m) => ({ default: m.Renderer })),
);
function Renderer({
  text,
  item,
  streaming,
}: {
  text: string;
  item?: Item;
  streaming?: boolean;
}) {
  return (
    <Suspense fallback={<p style={{ whiteSpace: "pre-wrap" }}>{text}</p>}>
      <RichRenderer text={text} media={item?.media} streaming={streaming} />
    </Suspense>
  );
}
function ToolItem({
  item,
  threadId,
  turnId,
  processExpanded,
}: {
  item: Item;
  threadId: string;
  turnId: string;
  processExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    anchorDisclosure(event.currentTarget, () => setExpanded((v) => !v));
  };
  const settings = useApp((s) => s.settings);
  const descriptor = settings?.mcp.find(
    (server: Json) => server.name === item.server,
  )?.tools?.[item.tool];
  const { failed, running, label } = toolStatus(item);
  if (item.type === "reasoning") {
    if (!item.summary?.length) return null;
    return (
      <details className="tool-item process-content" open={expanded}>
        <summary onClick={toggle}>
          <Circle size={13} aria-hidden="true" />
          <span>思考过程</span>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        {expanded && processExpanded && (
          <div className="tool-detail" tabIndex={0} role="region" aria-label="思考过程正文">{item.summary.join("\n")}</div>
        )}
      </details>
    );
  }
  const Icon =
    item.type === "commandExecution"
      ? Terminal
      : item.type === "fileChange"
        ? FilePenLine
        : item.type === "mcpToolCall"
          ? Plug
          : item.type === "webSearch"
            ? Search
            : item.type === "plan"
              ? ListChecks
              : Wrench;
  const title = toolTitle(
    item,
    item.display?.toolTitle ||
      descriptor?.title ||
      descriptor?.annotations?.title,
  );
  return (
    <>
      <details
        className={`tool-item process-content ${failed ? "failed" : ""}`}
        open={expanded}
      >
        <summary onClick={toggle}>
          {running ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : (
            <Icon size={15} aria-hidden="true" />
          )}
          <span>{title}</span>
          <small className={label === "已完成" ? "sr-only" : undefined}>
            {label}
          </small>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        {expanded && processExpanded && (
          <div className="tool-detail" tabIndex={0} role="region" aria-label="执行详情正文">
            {item.server && (
              <p className="muted">
                {item.server} / {item.tool}
              </p>
            )}
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
        )}
      </details>
    </>
  );
}

export function ItemOutput({
  item,
  threadId,
  turnId,
}: {
  item: Item;
  threadId: string;
  turnId: string;
}) {
  const descriptor = useApp(
    (s) =>
      s.settings?.mcp.find((m: Json) => m.name === item.server)?.tools?.[
        item.tool
      ],
  );
  const shown = useRef(false);
  if (hasItemOutput(item, descriptor)) shown.current = true;
  return (
    <>
      {!!item.media?.length && <MediaGallery items={item.media} />}
      {shown.current ? (
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
            display={item.display}
          />
        </Suspense>
      ) : null}
    </>
  );
}

const SkillReferences = lazy(() => import("../SkillReferences"));
export const Message = memo(function Message({
  item,
  threadId,
  turnId,
  processExpanded = true,
  streaming = false,
}: {
  item: Item;
  threadId: string;
  turnId: string;
  processExpanded?: boolean;
  streaming?: boolean;
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
          {item.expert && (
            <div className="skill-message-refs" aria-label="此消息使用的专家">
              <span>
                <UsersRound size={14} aria-hidden="true" />
                {item.expert.name}
              </span>
            </div>
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
    if (item.phase === "commentary" && !processExpanded)
      return (
        <article
          className="assistant-message process-content"
          data-content-kind="assistant"
        />
      );
  if (kind === "assistant")
    if (item.text != null && typeof item.text !== "string")
      throw new Error("Unsupported message text");
  if (kind === "assistant") {
    const body = extractSuggestions(item.text || "").text;
    return (
      <article
        className={`assistant-message ${item.phase === "commentary" ? "process-content" : ""}`}
        data-content-kind="assistant"
        aria-label="助手回复"
      >
        <Renderer text={body} item={item} streaming={streaming} />
        {body && (
          <div className="message-actions">
            <button
              className="icon-button"
              aria-label="复制回答"
              title="复制回答"
              onClick={() => {
                setCopyError("");
                void Promise.resolve()
                  .then(() => navigator.clipboard.writeText(body))
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
                <Check size={18} aria-hidden="true" />
              ) : (
                <Copy size={18} aria-hidden="true" />
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
  }
  return (
    <ToolItem
      item={item}
      threadId={threadId}
      turnId={turnId}
      processExpanded={processExpanded}
    />
  );
});
