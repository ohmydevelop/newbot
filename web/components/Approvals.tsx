import { connectorLabel } from "../../shared/tool-display";
import { isMcpToolConsent } from "../../shared/approvals";
import { lazy, Suspense, useState } from "react";
import {
  ShieldCheck,
  Terminal,
  FilePenLine,
  ArrowRight,
  CircleHelp,
} from "lucide-react";
import type { Approval, Json } from "../../shared/types";
import { request, useApp } from "../store";
const ElicitationForm = lazy(() => import("./ElicitationForm"));
export function ApprovalCard({ approval }: { approval: Approval }) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const p = approval.params;
  const question = approval.method === "item/tool/requestUserInput";
  const toolConsent = isMcpToolConsent(approval);
  const elicitation = approval.method === "mcpServer/elicitation/request";
  if (elicitation && p.elicitation)
    return (
      <Suspense fallback={<p role="status">正在加载输入请求…</p>}>
        <ElicitationForm approval={approval} />
      </Suspense>
    );
  async function respond(allow: boolean) {
    setBusy(true);
    try {
      await request("approval/respond", {
        id: approval.id,
        allow,
        ...(question
          ? {
              answers: Object.fromEntries(
                (p.questions || []).map((q: Json) => [
                  q.id,
                  [answers[q.id] || ""],
                ]),
              ),
            }
          : {}),
      });
      useApp.setState((s) => ({
        approvals: s.approvals.filter((a) => a.id !== approval.id),
      }));
    } catch (e) {
      useApp.getState().notify(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="approval-card"
      data-wait-id={`approval:${approval.id}`}
      aria-label="待处理授权"
    >
      <header>
        <ShieldCheck size={19} />
        <strong>
          {question
            ? "需要你的补充"
            : toolConsent
              ? "允许这次操作？"
              : elicitation
                ? "需要补充信息"
                : "需要你的授权"}
        </strong>
      </header>
      {question ? (
        (p.questions || []).map((q: Json) => (
          <label className="question" key={q.id}>
            <strong>{q.header}</strong>
            <span>{q.question}</span>
            {q.options?.map((o: Json) => (
              <label className="radio-option" key={o.label}>
                <input
                  type="radio"
                  name={q.id}
                  value={o.label}
                  checked={answers[q.id] === o.label}
                  onChange={() => setAnswers({ ...answers, [q.id]: o.label })}
                />
                <span>
                  {o.label}
                  <small>{o.description}</small>
                </span>
              </label>
            ))}
            <input
              aria-label={q.header || q.question}
              placeholder="输入回答"
              value={answers[q.id] || ""}
              onChange={(e) =>
                setAnswers({ ...answers, [q.id]: e.target.value })
              }
            />
          </label>
        ))
      ) : (
        <>
          {!toolConsent && (
            <p>
              {p.reason ||
                p.message ||
                (approval.method.includes("fileChange")
                  ? "助手请求修改以下文件。"
                  : "助手请求执行以下操作。")}
            </p>
          )}
          {(p.command || p.permissions) && (
            <pre className="approval-detail">
              {p.command || JSON.stringify(p.permissions, null, 2)}
            </pre>
          )}
          {toolConsent && (
            <>
              <p>
                {approval.display?.toolTitle ||
                  p._meta?.tool_title ||
                  "调用工具"}
              </p>
              <p className="muted">
                接收方：
                {approval.display?.serverTitle || connectorLabel(p.serverName)}
              </p>
              <details className="approval-operation-details">
                <summary>查看操作参数</summary>
                <p className="muted">{p.serverName}</p>
                <pre className="approval-detail">
                  {JSON.stringify(p._meta?.tool_params || {}, null, 2)}
                </pre>
              </details>
            </>
          )}
          {elicitation && !toolConsent && (
            <p className="muted">
              此表单暂不支持，无法提交。若需要填写密钥，请前往对应插件或连接器的设置。
            </p>
          )}
        </>
      )}
      <div className="approval-actions">
        <button disabled={busy} onClick={() => void respond(false)}>
          拒绝
        </button>
        {(!elicitation || toolConsent) && (
          <button
            className="primary"
            disabled={
              busy ||
              (question &&
                (p.questions || []).some((q: Json) => !answers[q.id]?.trim()))
            }
            onClick={() => void respond(true)}
          >
            {question
              ? "提交回答"
              : approval.method === "item/permissions/requestApproval"
                ? "允许本轮权限"
                : "仅允许这一次"}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
