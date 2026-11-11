import { useEffect, useId, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { PluginConnection } from "../../shared/plugin-configuration";
import type { CertificateObservation } from "../../shared/certificates";
import { privateApi } from "../private-input";
import {
  certificateSources,
  certificateSelectionValid,
  type CertificateSelection,
} from "../certificate-draft";

export default function CertificatePicker({
  connection,
  values,
  onUse,
}: {
  connection: PluginConnection;
  values: Record<string, string | number | boolean>;
  onUse: (selection: CertificateSelection) => void;
}) {
  const uid = useId(),
    sources = certificateSources(connection, values);
  const [chosenSource, setChosenSource] = useState("");
  const source = sources.find((f) => f.id === chosenSource) || sources[0];
  const address = source ? String(values[source.id]) : "";
  const targets = connection.fields.filter(
    (f) =>
      f.type === "string" &&
      !f.sensitive &&
      f.id !== source?.id &&
      !sources.some((s) => s.id === f.id),
  );
  const [target, setTarget] = useState("");
  const targetId =
    targets.length === 1
      ? targets[0].id
      : targets.some((t) => t.id === target)
        ? target
        : "";
  const [result, setResult] = useState<CertificateObservation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [used, setUsed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const key = JSON.stringify([
    connection.id,
    connection.schemaDigest,
    connection.revision,
    source?.id,
    address,
  ]);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setResult(null);
    setError("");
    setBusy(false);
    setUsed(false);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [key]);
  async function inspect() {
    if (!source || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setUsed(false);
    try {
      const observation = await privateApi("/api/plugins/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
        body: JSON.stringify({
          pluginId: connection.pluginId,
          connectionId: connection.id,
          schemaDigest: connection.schemaDigest,
          expectedRevision: connection.revision,
          fieldId: source.id,
          address,
        }),
      });
      if (pending.current === controller) setResult(observation);
    } catch (e) {
      if (pending.current === controller)
        setError(
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "证书获取超时，请重试。",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  if (!source || !targets.length) return null;
  const selection = result
    ? { sourceId: source.id, address, targetId, observation: result }
    : null;
  const filled = used && values[targetId] === result?.fingerprint;
  return (
    <div className="certificate-picker">
      {sources.length > 1 && (
        <label htmlFor={`${uid}-source`}>
          获取证书的服务地址
          <select
            id={`${uid}-source`}
            value={source.id}
            onChange={(e) => setChosenSource(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="certificate-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void inspect()}
        >
          <ShieldCheck size={17} />
          {busy ? "正在获取证书…" : "获取服务器证书"}
        </button>
        {busy && (
          <button
            type="button"
            className="icon-button"
            aria-label="取消证书获取"
            title="取消证书获取"
            onClick={() => {
              pending.current?.abort();
              pending.current = null;
              setBusy(false);
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="certificate-result" aria-live="polite">
          <strong>{result.origin}</strong>
          <p>
            {result.systemTrusted
              ? "系统证书验证通过。"
              : "此证书未通过系统验证，请确认服务器身份后再使用指纹。"}
          </p>
          <small>
            有效期至 {new Date(result.validTo).toLocaleDateString()}
          </small>
          <details>
            <summary>证书详情</summary>
            <dl>
              <dt>颁发给</dt>
              <dd>{result.subject}</dd>
              <dt>颁发者</dt>
              <dd>{result.issuer}</dd>
              <dt>地址校验</dt>
              <dd>
                {result.hostnameMatches
                  ? "匹配"
                  : "不匹配；使用指纹将绑定这张具体证书"}
              </dd>
              <dt>SHA-256 指纹</dt>
              <dd>
                <code>{result.fingerprint}</code>
              </dd>
            </dl>
          </details>
          {!result.canUse ? (
            <p className="inline-error">
              证书有效期或用途不符合要求，请先更新服务端证书。
            </p>
          ) : (
            <>
              {targets.length > 1 && (
                <label htmlFor={`${uid}-target`}>
                  填入配置项
                  <select
                    id={`${uid}-target`}
                    value={targetId}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setUsed(false);
                    }}
                  >
                    <option value="">请选择接收证书指纹的字段</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <small>
                确认后填入
                {targets.length === 1 ? `“${targets[0].title}”` : "所选字段"}
                ，保存配置后生效。服务更换证书时需要重新确认。
              </small>
              <button
                type="button"
                className="secondary"
                disabled={!targetId || filled}
                onClick={() => {
                  if (
                    !selection ||
                    !certificateSelectionValid(connection, values, selection)
                  ) {
                    setError("地址或证书信息已变化，请重新获取。");
                    return;
                  }
                  onUse(selection);
                  setUsed(true);
                }}
              >
                {filled ? "已填入，等待保存" : "确认使用此证书指纹"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
