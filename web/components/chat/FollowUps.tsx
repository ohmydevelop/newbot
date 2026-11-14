import { useEffect, useState } from "react";
import { CornerDownRight } from "lucide-react";
import type { Turn } from "../../../shared/types";
import {
  turnSuggestions,
  validateSuggestions,
} from "../../../shared/suggestions";

export function FollowUps({
  threadId,
  turn,
  onSuggest,
}: {
  threadId: string;
  turn: Turn;
  onSuggest: (text: string) => void;
}) {
  const inline = turnSuggestions(turn);
  const identity = `${threadId}:${turn.id}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    questions: string[];
    error?: string;
  }>();
  const eligible =
    turn.status === "completed" &&
    turn.items.some(
      (i) => i.type === "agentMessage" && i.text && i.phase !== "commentary",
    );
  useEffect(() => {
    if (!eligible || inline.length) return;
    const abort = new AbortController();
    setResult(undefined);
    void fetch(
      `/api/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turn.id)}/followups`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: abort.signal,
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "追问生成失败");
        if (data.threadId !== threadId || data.turnId !== turn.id)
          throw new Error("追问与当前回复不匹配");
        const questions = validateSuggestions(data.suggestions);
        if (questions.length < 2) throw new Error("模型未返回有效追问");
        if (!abort.signal.aborted) setResult({ identity, questions });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setResult({
            identity,
            questions: [],
            error: error.message || "追问生成失败",
          });
      });
    return () => abort.abort();
  }, [identity, eligible, inline.length, attempt, threadId, turn.id]);
  if (!eligible) return null;
  const current = result?.identity === identity ? result : undefined;
  const questions = inline.length ? inline : current?.questions || [];
  if (!questions.length)
    return (
      <div className="follow-ups" aria-label="推荐追问">
        {current?.error ? (
          <>
            <span className="muted" role="status">
              {current.error}
            </span>
            <button
              className="follow-up"
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              重试生成追问
            </button>
          </>
        ) : (
          <span className="muted" role="status">
            正在生成相关追问…
          </span>
        )}
      </div>
    );
  return (
    <div className="follow-ups" aria-label="推荐追问">
      {questions.map((text) => (
        <button
          type="button"
          className="follow-up"
          key={text}
          onClick={() => onSuggest(text)}
        >
          <CornerDownRight size={16} aria-hidden="true" />
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}
