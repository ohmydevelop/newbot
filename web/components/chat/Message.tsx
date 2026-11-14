import UserMessage from "./UserMessage";
import { MediaGallery } from "../MediaImage";
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  LoaderCircle,
  Lightbulb,
  CircleAlert,
  Ban,
  Square,
} from "lucide-react";
import { processIcons, ToolIcon } from "../AppIcons";
import type { Item, Json } from "../../../shared/types";
import { extractSuggestions } from "../../../shared/suggestions";
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
  active,
}: {
  active: boolean;
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
  const { failed, running, label } = toolStatus(item, active);
  const reasoning = item.type === "reasoning";
  const commentary =
    item.type === "agentMessage" && item.phase === "commentary";
  const Icon = reasoning ? Lightbulb : processIcons[item.type] || ToolIcon;
  const title = reasoning
    ? "思考过程"
    : commentary
      ? "进度说明"
      : toolTitle(
          item,
          item.display?.toolTitle ||
            descriptor?.title ||
            descriptor?.annotations?.title,
        );
  return (
    <>
      <details
        className={`tool-item process-content ${reasoning ? "reasoning-step" : ""} ${failed ? "failed" : ""}`}
        open={expanded}
      >
        <summary onClick={toggle} aria-expanded={expanded}>
          <Icon size={18} className="process-kind-icon" aria-hidden="true" />
          <span className="process-step-title">{title}</span>
          <small className="process-step-status">
            {running ? (
              <LoaderCircle size={14} className="spin" aria-hidden="true" />
            ) : failed ? (
              <CircleAlert size={14} aria-hidden="true" />
            ) : label === "未执行" ? (
              <Ban size={14} aria-hidden="true" />
            ) : label === "未完成" ? (
              <Square size={12} aria-hidden="true" />
            ) : null}
            {label}
          </small>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        {expanded &&
          processExpanded &&
          (reasoning ? (
            <div className="reasoning-text">{item.summary?.join("\n")}</div>
          ) : commentary ? (
            <div className="reasoning-text">
              <Renderer
                text={extractSuggestions(item.text || "").text}
                item={item}
                streaming={active}
              />
            </div>
          ) : (
            <div
              className="tool-detail"
              tabIndex={0}
              role="region"
              aria-label="执行详情正文"
            >
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
                            item.result.structuredContent ||
                              item.result.content,
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
          ))}
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
  if (kind === "user") return <UserMessage content={item.content || []} />;
  if (kind === "assistant")
    if (item.text != null && typeof item.text !== "string")
      throw new Error("Unsupported message text");
  if (kind === "assistant" && item.phase === "commentary")
    return (
      <ToolItem
        active={streaming}
        item={item}
        threadId={threadId}
        turnId={turnId}
        processExpanded={processExpanded}
      />
    );
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
      active={streaming}
      item={item}
      threadId={threadId}
      turnId={turnId}
      processExpanded={processExpanded}
    />
  );
});
