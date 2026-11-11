import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { Turn } from "../../../shared/types";
import { loadThread, useApp } from "../../store";
import {
  waitingLabel,
  type WaitingSummary,
} from "../../../shared/thread-activity";
import {
  turnFeedback,
  hasItemOutput,
  presentationBlocks,
} from "../../chat-presentation";
import { Message, ItemOutput } from "./Message";
import { ContentBoundary } from "./ContentBoundary";
import { ProcessGroup } from "./ProcessGroup";
const Artifacts = lazy(() =>
  import("../Artifacts").then((m) => ({ default: m.Artifacts })),
);
function WaitingLink({ waiting }: { waiting?: WaitingSummary }) {
  if (!waiting) return null;
  return (
    <button
      className="waiting-link"
      type="button"
      aria-label="查看待处理请求"
      onClick={() => {
        const target = document.querySelector<HTMLElement>(
          `[data-wait-id="${CSS.escape(`${waiting.target.kind}:${waiting.target.id}`)}"]`,
        );
        target?.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
        target
          ?.querySelector<HTMLElement>(
            'input:not(:disabled),button:not(:disabled),[tabindex="0"]',
          )
          ?.focus({ preventScroll: true });
      }}
    >
      查看{waiting.count > 1 ? `（${waiting.count} 项）` : ""}
    </button>
  );
}
function TurnFeedback({ turn, threadId }: { turn: Turn; threadId: string }) {
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState("");
  const [readStatus, setReadStatus] = useState("");
  const feedback = turnFeedback(turn);
  if (!feedback) return null;
  return (
    <div className={`turn-feedback ${feedback.tone}`}>
      <div role="status" aria-atomic="true">
        <p>
          {feedback.tone === "error" && (
            <AlertCircle size={15} aria-hidden="true" />
          )}
          {feedback.text}
        </p>
        {feedback.canRead && (
          <small>可以继续发送消息；读取状态不会重新执行任务。</small>
        )}
        {readStatus && <small>{readStatus}</small>}
      </div>
      {feedback.canRead && (
        <button
          type="button"
          className="secondary"
          disabled={reading}
          onClick={() => {
            setReading(true);
            setReadError("");
            setReadStatus("");
            void loadThread(threadId, false, { localError: true })
              .then(() => setReadStatus("状态已更新。"))
              .catch(() => setReadError("状态未能读取，请恢复连接后重试。"))
              .finally(() => setReading(false));
          }}
        >
          {reading ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={15} aria-hidden="true" />
          )}
          {reading ? "正在读取…" : "重新读取状态"}
        </button>
      )}
      {readError && (
        <p className="inline-error" role="alert">
          {readError}
        </p>
      )}
    </div>
  );
}
export function ChatTurn({
  turn,
  threadId,
  canAdd,
}: {
  turn: Turn;
  threadId: string;
  canAdd: boolean;
}) {
  const [clock, setClock] = useState(Date.now());
  const outputIds = useRef(new Set<string>());
  const settings = useApp((s) => s.settings);
  for (const item of turn.items)
    if (
      item.media?.length ||
      hasItemOutput(
        item,
        settings?.mcp.find((m: { name: string }) => m.name === item.server)
          ?.tools?.[item.tool],
      )
    )
      outputIds.current.add(item.id);
  const blocks = presentationBlocks(turn.items, outputIds.current, turn.status);
  const activity = useApp(
    (s) => s.threads.find((t) => t.id === threadId)?.activity,
  );
  const waiting =
    turn.status === "inProgress" &&
    activity?.turnId === turn.id &&
    activity.state === "waiting"
      ? activity.waiting
      : undefined;
  useEffect(() => {
    if (turn.status !== "inProgress") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.status]);
  const elapsed =
    turn.durationMs ??
    (turn.startedAt != null &&
    (turn.completedAt != null || turn.status === "inProgress")
      ? Math.max(0, (turn.completedAt ?? clock / 1000) - turn.startedAt) * 1000
      : null);
  const label =
    elapsed === null
      ? "时长未知"
      : `${Math.floor(elapsed / 60000) > 0 ? `${Math.floor(elapsed / 60000)} 分 ` : ""}${Math.floor(elapsed / 1000) % 60} 秒`;
  const heading = `${waiting ? `${waitingLabel(waiting)} · 总历时` : turn.status === "inProgress" ? "正在处理" : elapsed === null ? "执行过程" : "用时"}${elapsed !== null ? ` ${label}` : ""}`;
  let firstProcess = true;
  return (
    <div className="turn" data-turn-id={turn.id}>
      {blocks.map((block) => {
        if (block.kind === "process") {
          const first = firstProcess;
          firstProcess = false;
          return (
            <ProcessGroup
              key={block.id}
              items={block.items}
              threadId={threadId}
              turnId={turn.id}
              label={first ? heading : `后续过程 · ${block.items.length} 项`}
              running={turn.status === "inProgress" && !waiting}
            >
              {first && <WaitingLink waiting={waiting} />}
            </ProcessGroup>
          );
        }
        return (
          <ContentBoundary key={block.id}>
            {block.kind === "output" ? (
              <ItemOutput
                item={block.item}
                threadId={threadId}
                turnId={turn.id}
              />
            ) : (
              <Message
                item={block.item}
                threadId={threadId}
                turnId={turn.id}
                streaming={turn.status === "inProgress"}
              />
            )}
          </ContentBoundary>
        );
      })}
      {!!(turn.artifacts?.length || turn.artifactNotices?.length) && (
        <ContentBoundary>
          <Suspense
            fallback={
              <p className="muted" role="status">
                正在加载文件…
              </p>
            }
          >
            <Artifacts threadId={threadId} turn={turn} canAdd={canAdd} />
          </Suspense>
        </ContentBoundary>
      )}
      {turn.status === "inProgress" &&
        !blocks.some((b) => b.kind === "process") && (
          <div className="process-heading">
            <span className="process-toggle">
              {!waiting && (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              )}
              {heading}
            </span>
            <WaitingLink waiting={waiting} />
          </div>
        )}
      <TurnFeedback turn={turn} threadId={threadId} />
    </div>
  );
}
