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
    <section className="approval-card" aria-label="待处理授权">
      <header>
        <ShieldCheck size={19} />
        <strong>
          {question
            ? "需要你的补充"
            : toolConsent
              ? "MCP 工具需要你的授权"
              : elicitation
                ? "MCP 请求信息"
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
          <p>
            {p.reason ||
              p.message ||
              (approval.method.includes("fileChange")
                ? "Codex 请求修改工作目录中的文件。"
                : "Codex 请求执行以下操作。")}
          </p>
          {(p.command || p.permissions) && (
            <pre className="approval-detail">
              {p.command || JSON.stringify(p.permissions, null, 2)}
            </pre>
          )}
          {toolConsent && (
            <pre className="approval-detail">
              {p.serverName} / {p._meta?.tool_title || "MCP 工具"}
              {"\n"}
              {JSON.stringify(p._meta?.tool_params || {}, null, 2)}
            </pre>
          )}
          {elicitation && !toolConsent && (
            <p className="muted">
              此请求的表单类型无法安全显示，不能直接批准。普通输入请使用受支持的表单；私密凭证请使用设置中的独立通道。
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
