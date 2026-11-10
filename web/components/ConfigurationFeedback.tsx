import { useEffect, useRef, useState } from "react";
import { RefreshCw, LoaderCircle } from "lucide-react";
import {
  configurationIssue,
  type ConfigurationIssue,
  type ConfigurationView,
} from "../../shared/configuration";
import type { Json } from "../../shared/types";
import { useApp, acceptSettings, request } from "../store";
type Failure = {
  message: string;
  issue: ConfigurationIssue | null;
  revision?: string;
};
export function savedReadFailure(message: string) {
  return Object.assign(new Error(message), {
    configurationIssue: {
      code: "readback_failed",
      persistence: "saved",
      recovery: "read",
    } as ConfigurationIssue,
  });
}
export function useConfigurationRecovery() {
  const [failure, setFailure] = useState<Failure | null>(null),
    [snapshot, setSnapshot] = useState<Json | null>(null),
    [busy, setBusy] = useState("");
  function report(
    message: string,
    issue: ConfigurationIssue | null,
    revision?: string,
  ) {
    setSnapshot(null);
    setFailure({ message, issue, revision });
  }
  function capture(reason: unknown, revision?: string) {
    report(
      reason instanceof Error ? reason.message : "操作失败，请重新读取配置",
      configurationIssue(
        (reason as { configurationIssue?: unknown })?.configurationIssue,
      ),
      revision,
    );
  }
  function clear() {
    setFailure(null);
    setSnapshot(null);
  }
  async function recover(mode: "read" | "reconnect") {
    setBusy(mode);
    try {
      const result = await request<{ settings: Json }>(
        "configuration/recover",
        { mode },
      );
      acceptSettings(result.settings);
      setSnapshot(result.settings);
    } catch (reason) {
      const issue = configurationIssue(
        (reason as { configurationIssue?: unknown })?.configurationIssue,
      );
      setSnapshot(null);
      setFailure((previous) => ({
        message:
          reason instanceof Error
            ? reason.message
            : "恢复失败，请检查服务端配置",
        issue:
          issue?.code === "busy" && previous?.issue
            ? previous.issue
            : issue
              ? {
                  ...issue,
                  persistence:
                    previous?.issue?.persistence || issue.persistence,
                }
              : previous?.issue || null,
        revision: previous?.revision,
      }));
    } finally {
      setBusy("");
    }
  }
  const sameVersion =
    !!snapshot &&
    !!failure?.revision &&
    snapshot.configuration?.revision === failure.revision;
  const blocked =
    !!failure?.issue &&
    !["busy"].includes(failure.issue.code) &&
    !(sameVersion && !["read_only", "overridden"].includes(failure.issue.code));
  return {
    failure,
    snapshot,
    busy,
    blocked,
    sameVersion,
    report,
    capture,
    clear,
    recover,
  };
}
export default function ConfigurationFeedback({
  recovery,
  busy,
  onAdopt,
  target,
  scope = "defaults",
  hasDraft = false,
  showAvailability = true,
}: {
  recovery: ReturnType<typeof useConfigurationRecovery>;
  busy?: boolean;
  onAdopt: (settings: Json) => void;
  target?: string;
  scope?: "defaults" | "provider" | "mcp";
  hasDraft?: boolean;
  showAvailability?: boolean;
}) {
  const supported = useApp((s) => s.configurationRecovery),
    runtime = useApp((s) => s.runtime),
    loading = useApp((s) => s.settingsLoading),
    settings = useApp((s) => s.settings),
    loadError = useApp((s) => s.settingsError);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recovery.failure) ref.current?.focus();
  }, [recovery.failure]);
  const issue =
      recovery.failure?.issue ||
      configurationIssue(settings?.configurationIssue),
    unavailable = !settings?.configuration,
    readOnly = !!settings?.configuration && !settings.configuration.writable;
  if (!recovery.failure && (!showAvailability || (!unavailable && !readOnly)))
    return null;
  if (!recovery.failure && loading)
    return (
      <p className="configuration-feedback-loading" role="status">
        正在读取配置…
      </p>
    );
  const message =
    recovery.failure?.message ||
    loadError ||
    (readOnly
      ? settings?.configuration.reason
      : "配置暂不可读，请重新读取后再保存。");
  const reconnect = issue?.recovery === "reconnect" || runtime === "offline";
  const current = recovery.snapshot?.configuration as
    | ConfigurationView
    | undefined;
  const entry =
    scope === "provider"
      ? current?.providers.find((p) => p.id === target)
      : scope === "mcp"
        ? current?.mcp.find((m) => m.id === target)
        : null;
  const disabled = !!busy || !!recovery.busy;
  return (
    <div
      className="configuration-feedback"
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label="配置恢复"
    >
      <p
        className={
          issue?.code === "overridden"
            ? "configuration-notice"
            : "inline-error configuration-error"
        }
        role={
          recovery.snapshot || issue?.code === "overridden" ? "status" : "alert"
        }
      >
        {message}
      </p>
      {issue?.persistence === "saved" && (
        <p className="muted">配置已提交到服务端，请核对实际生效状态。</p>
      )}
      {issue?.persistence === "unconfirmed" && (
        <p className="muted">当前结果尚未确认，请先读取配置再决定下一步。</p>
      )}
      {hasDraft && <p className="muted">输入内容已保留。</p>}
      {current && (
        <div className="configuration-current" role="status">
          <strong>当前生效配置</strong>
          <dl>
            <dt>Provider</dt>
            <dd>{current.defaults.provider || "运行时默认值"}</dd>
            <dt>模型</dt>
            <dd>{current.defaults.model || "运行时默认值"}</dd>
            <dt>推理强度</dt>
            <dd>{current.defaults.effort || "运行时默认值"}</dd>
            {target && (
              <>
                <dt>
                  {scope === "mcp" ? "MCP" : "Provider"} {target}
                </dt>
                <dd>
                  {entry
                    ? "name" in entry
                      ? entry.name
                      : `${entry.transport} · ${entry.enabled ? "启用" : "停用"}`
                    : "当前配置中不存在"}
                </dd>
                {entry?.endpointOrigin && (
                  <>
                    <dt>端点 origin</dt>
                    <dd>{entry.endpointOrigin}</dd>
                  </>
                )}
              </>
            )}
          </dl>
          <p>
            {recovery.sameVersion && !recovery.blocked
              ? "配置版本未变化，可检查草稿后重新保存。"
              : hasDraft
                ? "草稿仍保留原版本；采用当前配置后可重新编辑。"
                : "当前配置已读取，可采用此状态继续操作。"}
          </p>
        </div>
      )}
      {supported && (
        <div className="configuration-actions">
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => void recovery.recover("read")}
          >
            <RefreshCw size={15} aria-hidden="true" />
            读取当前生效配置
          </button>
          {reconnect && (
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => void recovery.recover("reconnect")}
            >
              {recovery.busy === "reconnect" && (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              )}
              重新连接并读取配置
            </button>
          )}
          {recovery.snapshot && (
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => {
                const section = ref.current?.closest("section");
                onAdopt(recovery.snapshot!);
                requestAnimationFrame(() =>
                  section
                    ?.querySelector<HTMLElement>(
                      "select:not(:disabled), input:not(:disabled), button:not(:disabled)",
                    )
                    ?.focus(),
                );
              }}
            >
              采用当前配置{hasDraft ? "并放弃草稿" : ""}
            </button>
          )}
        </div>
      )}
      {recovery.busy && (
        <p role="status" className="muted">
          {recovery.busy === "read"
            ? "正在读取当前配置…"
            : "正在重新连接并读取配置…"}
        </p>
      )}
    </div>
  );
}
