import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Upload, X } from "lucide-react";
import { privateApi } from "../private-input";
import type { CertificateObservation } from "../../shared/certificates";

/** Public trust material only. Observing a certificate never silently trusts it. */
export default function ServerCertificateEditor({
  address,
  value,
  disabled = false,
  onChange,
  onBusyChange,
}: {
  address: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const current = useRef(address);
  current.current = address;
  const prior = useRef(address);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<CertificateObservation | null>(null);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError("");
    setResult(null);
    if (prior.current !== address) {
      prior.current = address;
      if (value) onChange("");
    }
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [address]);
  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }
  async function acquire(upload?: File) {
    if (pending.current || disabled) return;
    const controller = new AbortController(),
      source = address;
    pending.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    const valid = () =>
      pending.current === controller && current.current === source;
    try {
      if (upload) {
        if (upload.size > 32768) throw new Error("证书不能超过 32 KiB");
        const bytes = new Uint8Array(await upload.arrayBuffer());
        if (new TextDecoder().decode(bytes).includes("PRIVATE KEY"))
          throw new Error("请选择不含私钥的 PEM 或 DER 证书");
        if (valid()) onChange(btoa(String.fromCharCode(...bytes)));
      } else {
        const observation: CertificateObservation = await privateApi(
          "/api/certificates/inspect",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: source }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        if (valid()) setResult(observation);
      }
    } catch (e) {
      if (valid())
        setError(e instanceof Error ? e.message : "证书获取失败，请重试");
    } finally {
      if (valid()) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="connector-certificate certificate-picker">
      <span className="muted">
        服务器证书 · {value ? "自定义" : "系统信任"}
      </span>
      <div className="certificate-actions">
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy || !address}
          onClick={() => void acquire()}
        >
          <ShieldCheck size={17} />
          {busy ? "正在读取证书…" : "获取服务器证书"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy || !address.startsWith("https://")}
          onClick={() => file.current?.click()}
        >
          <Upload size={17} />
          选择证书
        </button>
        {busy && (
          <button
            type="button"
            className="icon-button"
            aria-label="取消证书获取"
            onClick={cancel}
          >
            <X size={18} />
          </button>
        )}
        {value && (
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            onClick={() => {
              onChange("");
              setResult(null);
            }}
          >
            恢复系统信任
          </button>
        )}
      </div>
      <input
        ref={file}
        hidden
        type="file"
        accept=".pem,.crt,.cer,.der"
        aria-label="选择服务器 CA 证书"
        disabled={disabled || busy}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = "";
          if (selected) void acquire(selected);
        }}
      />
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
              ? "系统验证通过"
              : "请核对服务器身份后确认使用"}
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
              <dt>SHA-256</dt>
              <dd>
                <code>{result.fingerprint}</code>
              </dd>
            </dl>
          </details>
          {result.trustFingerprint &&
            result.trustFingerprint !== result.fingerprint && (
              <details>
                <summary>签发 CA</summary>
                <p>{result.trustSubject}</p>
                <code>{result.trustFingerprint}</code>
              </details>
            )}
          {!result.canUse || !result.hostnameMatches ? (
            <p className="inline-error">
              证书已过期、用途不符或与服务地址不匹配，请更新服务端证书。
            </p>
          ) : !result.certificatePem ? (
            <p>
              {result.systemTrusted
                ? "系统验证通过，无需添加证书。"
                : "服务未提供签发 CA，请选择 CA 证书文件。"}
            </p>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={
                disabled ||
                !result.certificatePem ||
                value === result.certificatePem
              }
              onClick={() => {
                if (result.expiresAt <= Date.now()) {
                  setError("证书信息已过期，请重新获取");
                  return;
                }
                if (result.certificatePem) onChange(result.certificatePem);
              }}
            >
              {value === result.certificatePem
                ? "已填入，等待保存"
                : "确认使用此证书"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
