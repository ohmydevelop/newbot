import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp, LoaderCircle } from "lucide-react";
import {
  validateInput,
  type InputRequest,
  type InputValue,
} from "../../shared/elicitation";
import { connectorLabel } from "../../shared/tool-display";
import type { Approval } from "../../shared/types";
import { request, useApp } from "../store";
export default function ElicitationForm({ approval }: { approval: Approval }) {
  const input = approval.params.elicitation as InputRequest,
    form = input.form,
    prefix = useId(),
    summary = useRef<HTMLDivElement>(null),
    lock = useRef(false);
  const [draft, setDraft] = useState<Record<string, InputValue | undefined>>(
      () =>
        Object.fromEntries(
          (form?.fields || [])
            .filter((f) => f.default !== undefined)
            .map((f) => [f.name, f.default]),
        ),
    ),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(() =>
      Math.max(0, Math.ceil((input.expiresAt - Date.now()) / 1000)),
    );
  const finished = () =>
    useApp.setState((s) => ({
      approvals: s.approvals.filter(
        (a) => a.params.elicitation?.token !== input.token,
      ),
    }));
  useEffect(() => {
    const timer = setInterval(
      () =>
        setRemaining(
          Math.max(0, Math.ceil((input.expiresAt - Date.now()) / 1000)),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [input.expiresAt]);
  function change(name: string, value: InputValue | undefined) {
    setDraft((s) => ({ ...s, [name]: value }));
    const next = Object.fromEntries(
      Object.entries(errors).filter(([k]) => k !== name),
    );
    setErrors(next);
    if (!Object.keys(next).length && error === "请检查以下字段后再提交。")
      setError("");
  }
  async function send(decision: "accept" | "decline" | "cancel") {
    if (lock.current) return;
    let content: Record<string, InputValue> | undefined;
    if (decision === "accept") {
      if (!form || !remaining) return;
      const converted = Object.fromEntries(
        form.fields
          .filter((f) => draft[f.name] !== undefined)
          .map((f) => {
            const value = draft[f.name];
            return [
              f.name,
              (f.type === "number" || f.type === "integer") &&
              typeof value === "string"
                ? value.trim() === ""
                  ? undefined
                  : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
                    ? Number(value)
                    : NaN
                : value,
            ];
          }),
      );
      const validated = validateInput(form, converted);
      if (validated.invalid) {
        setErrors(validated.errors);
        setError(
          Object.keys(validated.errors).length
            ? "请检查以下字段后再提交。"
            : "表单内容过大，请缩短部分输入后再提交。",
        );
        requestAnimationFrame(() => summary.current?.focus());
        return;
      }
      content = validated.content;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setErrors({});
    try {
      await request(
        "elicitation/respond",
        {
          id: approval.id,
          token: input.token,
          decision,
          ...(decision === "accept" ? { content } : {}),
        },
        { signal: AbortSignal.timeout(15000) },
      );
      finished();
    } catch {
      try {
        const current = await request<Approval[]>(
          "approval/list",
          {},
          { signal: AbortSignal.timeout(5000) },
        );
        if (!current.some((a) => a.params.elicitation?.token === input.token)) {
          finished();
          useApp
            .getState()
            .notify(
              new Error("输入请求已结束或由其他页面处理，请查看会话状态。"),
            );
          return;
        }
        setError(
          "响应未完成，当前请求仍在等待。填写内容已保留，可以重试或取消。",
        );
      } catch {
        setError(
          "响应结果暂未确认，请恢复连接后读取当前请求；不要重复提交其他内容。",
        );
      }
      requestAnimationFrame(() => summary.current?.focus());
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="approval-card elicitation-card"
      data-wait-id={`approval:${approval.id}`}
      aria-label="需要补充信息"
    >
      <header>
        <CircleHelp size={19} aria-hidden="true" />
        <strong>需要补充信息</strong>
        <span className="input-countdown">
          {remaining ? `剩余 ${remaining} 秒` : "请求已到期，等待同步"}
        </span>
      </header>
      <p className="input-source">
        来自{" "}
        {approval.display?.serverTitle ||
          connectorLabel(approval.params.serverName)}
      </p>
      <p className="input-boundary">
        请勿填写密码、密钥或验证码；信息会发送给此服务，并可能用于助手的回答。
      </p>
      {form ? (
        <p className="input-message">{form.message}</p>
      ) : (
        <p role="alert">
          {input.issue === "sensitive"
            ? "此请求包含私密输入要求，普通表单不会收集这些内容。"
            : "此请求的模式、字段或大小超出当前支持范围，不能填写或提交。"}
        </p>
      )}
      {!!error && (
        <div
          className="input-error-summary"
          ref={summary}
          role="alert"
          tabIndex={-1}
        >
          <strong>{error}</strong>
          <ul>
            {form?.fields.map(
              (f, i) =>
                errors[f.name] && (
                  <li key={f.name}>
                    <a
                      href={`#${prefix}-${i}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(`${prefix}-${i}`)?.focus();
                      }}
                    >
                      {f.title}：{errors[f.name]}
                    </a>
                  </li>
                ),
            )}
          </ul>
        </div>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send("accept");
        }}
      >
        <fieldset disabled={busy || !remaining} className="input-fields">
          {form?.fields.map((f, i) => {
            const id = `${prefix}-${i}`,
              help = `${id}-help`,
              invalid = errors[f.name],
              value = draft[f.name],
              props = {
                id,
                "aria-invalid": !!invalid,
                "aria-describedby": `${help}${invalid ? ` ${id}-error` : ""}`,
                "aria-required": f.required,
              };
            return (
              <div className="input-field" key={f.name}>
                <label
                  htmlFor={f.type === "multi" ? undefined : id}
                  id={`${id}-label`}
                >
                  {f.title}
                  {f.required ? (
                    <span className="muted">（必填）</span>
                  ) : (
                    <span className="muted">（可选）</span>
                  )}
                </label>
                {f.type === "enum" ? (
                  <select
                    {...props}
                    value={
                      value === undefined
                        ? ""
                        : String(f.options!.findIndex((o) => o.value === value))
                    }
                    onChange={(e) =>
                      change(
                        f.name,
                        e.target.value === ""
                          ? undefined
                          : f.options![Number(e.target.value)].value,
                      )
                    }
                  >
                    <option value="">请选择</option>
                    {f.options!.map((o, n) => (
                      <option key={n} value={n}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "boolean" ? (
                  <select
                    {...props}
                    value={value === undefined ? "" : String(value)}
                    onChange={(e) =>
                      change(
                        f.name,
                        e.target.value === ""
                          ? undefined
                          : e.target.value === "true",
                      )
                    }
                  >
                    <option value="">请选择</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                ) : f.type === "multi" ? (
                  <div
                    {...props}
                    role="group"
                    tabIndex={-1}
                    aria-labelledby={`${id}-label`}
                    className="input-options"
                  >
                    {f.options!.map((o, n) => (
                      <label key={n}>
                        <input
                          type="checkbox"
                          checked={
                            Array.isArray(value) && value.includes(o.value)
                          }
                          onChange={(e) => {
                            const selected = Array.isArray(value) ? value : [],
                              next = e.target.checked
                                ? [...selected, o.value]
                                : selected.filter((v) => v !== o.value);
                            change(
                              f.name,
                              !next.length && !f.required ? undefined : next,
                            );
                          }}
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    {...props}
                    type="text"
                    inputMode={
                      f.type === "integer" || f.type === "number"
                        ? "decimal"
                        : f.format === "email"
                          ? "email"
                          : f.format === "uri"
                            ? "url"
                            : "text"
                    }
                    autoComplete="off"
                    maxLength={f.type === "string" ? f.maxLength : 64}
                    value={String(value ?? "")}
                    onChange={(e) => change(f.name, e.target.value)}
                  />
                )}
                <p className="input-help" id={help}>
                  {f.description}
                  {f.type === "string" &&
                    ` 长度 ${f.minLength ?? 0}–${f.maxLength} 字符${f.format ? `；格式 ${f.format}` : ""}。`}
                  {(f.type === "number" || f.type === "integer") &&
                    ` ${f.type === "integer" ? "整数" : "数字"}${f.minimum !== undefined ? `，最小 ${f.minimum}` : ""}${f.maximum !== undefined ? `，最大 ${f.maximum}` : ""}。`}
                  {f.type === "multi" &&
                    ` 选择 ${f.minItems ?? 0}–${f.maxItems ?? f.options!.length} 项。`}
                </p>
                {invalid && (
                  <p className="inline-error" id={`${id}-error`}>
                    {invalid}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="approval-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("cancel")}
          >
            取消填写
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("decline")}
          >
            拒绝提供
          </button>
          {form && (
            <button
              className="primary"
              type="submit"
              disabled={busy || !remaining}
            >
              {busy ? (
                <>
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  正在提交
                </>
              ) : (
                "提交信息"
              )}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
