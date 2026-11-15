import { FormActions, FormSubmit } from "./FormActions";
import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Modal } from "./ui";
import { request, useApp } from "../store";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
import { customModelIds } from "../../shared/gateways";
import PrivateFieldEditor, {
  type PrivateFieldsHandle,
} from "./PrivateFieldEditor";
import {
  sendPrivateFields,
  PrivateOutcomeUnknown,
  privateApi,
} from "../private-input";
type Provider = ConfigurationView["providers"][number];
export default function GatewayEditor({
  provider,
  revision: initialRevision,
  onClose,
  onSaved,
  children,
}: {
  provider?: Provider;
  revision: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const fields = useRef<PrivateFieldsHandle>(null),
    posting = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const [name, setName] = useState(
      provider?.missing ? "" : provider?.name || "",
    ),
    [url, setUrl] = useState(provider?.editableEndpoint || ""),
    [customModels, setCustomModels] = useState(
      (provider?.customModels || []).join("\n"),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modelError, setModelError] = useState(""),
    [models, setModels] = useState<string[]>([]),
    [unknown, setUnknown] = useState<string | null>(null);
  const [saved, setSaved] = useState<
    (DefaultsSaveResult & { id: string }) | null
  >(null);
  const readOnly = !!provider && !provider.editable;
  const [rebind, setRebind] = useState(false);
  const [unknownWrite, setUnknownWrite] = useState<string | null>(null);
  const changedReceiver =
    !!provider?.editableEndpoint &&
    url.replace(/\/+$/, "") !== provider.editableEndpoint.replace(/\/+$/, "");
  async function finish() {
    fields.current?.clear();
    try {
      await onSaved();
    } catch {
      useApp.getState().notify("模型服务已保存，列表暂未刷新。");
    }
    onClose();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (posting.current || readOnly || unknown || unknownWrite) return;
    posting.current = true;
    setBusy(true);
    setError("");
    let ordinary = saved;
    try {
      const manual = customModelIds.safeParse(
        customModels
          .split(/[\n,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
      );
      if (!manual.success)
        throw new Error("请输入有效的模型 ID，每行一个，不含空格。");
      ordinary ||= await request<DefaultsSaveResult & { id: string }>(
        "gateway/save",
        {
          requestId: requestId.current,
          targetId: provider?.id,
          expectedRevision: initialRevision,
          name,
          ...(url && url !== provider?.editableEndpoint
            ? { baseUrl: url }
            : {}),
          customModels: manual.data,
          ...(changedReceiver ? { rebindCredentials: rebind } : {}),
        },
        { operationId: requestId.current },
      );
      setSaved(ordinary);
      const draft = fields.current!.read(),
        target = ordinary.configuration.providers.find(
          (p) => p.id === ordinary!.id,
        )!;
      if (
        draft.fields.length ||
        target.privateFields?.fields.length ||
        target.managedCredential?.stored
      )
        await sendPrivateFields(
          {
            operation: "credential.fields.save",
            scope: "provider",
            targetId: ordinary.id,
            expectedRevision:
              ordinary.configuration.revisions?.[`provider:${ordinary.id}`] ||
              ordinary.configuration.revision,
            expectedFieldsRevision: target.privateFields?.revision || "absent",
            fields: draft.fields,
            clearValues: draft.clearValues,
            removeFields: draft.removeFields,
          },
          draft.values,
        );
      await finish();
    } catch (err) {
      if (err instanceof PrivateOutcomeUnknown) setUnknown(err.ticketId);
      else if ((err as { operationId?: string })?.operationId)
        setUnknownWrite((err as { operationId: string }).operationId);
      else if (!ordinary) requestId.current = crypto.randomUUID();
      setError(
        `${ordinary ? "模型服务信息已保存；" : ""}${err instanceof Error ? err.message : "保存未完成"}`,
      );
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const id = saved?.id || provider?.id;
    if (!id) return;
    setBusy(true);
    setModelError("");
    try {
      const result = await request<{ models: string[] }>("provider/models", {
        id,
        expectedRevision:
          saved?.configuration.revisions?.[`provider:${id}`] || initialRevision,
      });
      setModels(result.models);
      if (!result.models.length) setModelError("目录为空，可添加自定义模型。");
    } catch {
      setModelError("模型目录暂不可用，可重试或添加自定义模型。");
    } finally {
      setBusy(false);
    }
  }
  async function read() {
    setBusy(true);
    try {
      const ticket = await privateApi(`/api/credentials/${unknown}`);
      if (ticket.state === "succeeded") await finish();
      else if (
        ["waiting", "failed", "cancelled", "invalidated", "expired"].includes(
          ticket.state,
        )
      ) {
        setUnknown(null);
        setError("凭证未保存，请重新输入后保存。");
      } else setError("正在保存，请稍后再次读取。");
    } catch {
      setError("状态暂不可读，请恢复连接后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={provider ? provider.name : "添加模型服务"}
      wide
      className="connection-editor-modal gateway-editor-modal"
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form
        className="provider-editor"
        aria-label={provider ? "编辑模型服务 表单" : "新增模型服务 表单"}
        onSubmit={save}
      >
        <div className="connection-editor-body">
          <label className="field-label">
            名称
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              disabled={busy || readOnly || !!saved}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {provider && !provider.missing && readOnly && (
            <div className="current-endpoint">
              <span>当前连接地址</span>
              <code>
                {provider.endpointOrigin ||
                  (provider.requiresAccountAuth ? "账户授权" : "未配置")}
              </code>
            </div>
          )}
          {!readOnly && (
            <>
              <label className="field-label">
                连接地址
                <input
                  type="url"
                  required={!provider || provider.missing}
                  value={url}
                  disabled={busy || !!saved}
                  placeholder={
                    provider && !provider.missing
                      ? "留空保留当前完整地址"
                      : "https://api.example.com/v1"
                  }
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setRebind(false);
                  }}
                />
              </label>
              {changedReceiver && (
                <label className="provider-checkbox">
                  <input
                    type="checkbox"
                    checked={rebind}
                    disabled={busy || !!saved}
                    required
                    onChange={(e) => setRebind(e.target.checked)}
                  />
                  使用新地址，重新配置其凭证
                </label>
              )}
              <PrivateFieldEditor
                ref={fields}
                transport="http"
                provider
                initial={provider?.privateFields}
                authentication={provider?.authentication}
                legacyBearer={
                  (!provider?.privateFields ||
                    provider.privateFields.revision === "absent") &&
                  provider?.authentication?.source === "managed"
                }
                disabled={busy || !!unknown}
              />
            </>
          )}
          {(provider || saved) && (
            <div className="model-directory-control">
              <select
                aria-label="已发现模型"
                disabled={!models.length}
                defaultValue=""
              >
                <option value="" disabled>
                  模型目录
                </option>
                {models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                title="获取模型"
                aria-label="获取模型"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={18} className={busy ? "spin" : ""} />
              </button>
            </div>
          )}
          <details
            className="advanced-settings"
            open={customModels.trim() ? true : undefined}
          >
            <summary>自定义模型</summary>
            <label className="field-label">
              模型 ID
              <textarea
                aria-label="自定义模型"
                value={customModels}
                rows={3}
                spellCheck={false}
                disabled={busy || readOnly || !!saved}
                onChange={(e) => setCustomModels(e.target.value)}
                placeholder="每行一个模型 ID，例如 my-model"
              />
              <span className="muted">
                无法获取目录时可手动添加。实际可用性由模型服务决定。
              </span>
            </label>
          </details>
          {readOnly && (
            <p className="muted">此模型服务由账户或其他配置来源管理。</p>
          )}
          {children && (
            <section className="gateway-connection-tools" aria-label="连接管理">
              {children}
            </section>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {modelError && <p className="inline-error">{modelError}</p>}
        </div>
        <FormActions layout="editor">
          {unknownWrite && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const receipt = await privateApi(
                    `/api/config/operations/${unknownWrite}`,
                  );
                  if (receipt.state === "saved") {
                    setSaved(receipt.result);
                    setUnknownWrite(null);
                    setError("模型服务信息已保存，请继续完成凭证设置。");
                  } else if (["unseen", "unchanged"].includes(receipt.state)) {
                    setUnknownWrite(null);
                    requestId.current = crypto.randomUUID();
                    setError("此次修改未保存，可以重新提交。");
                  } else setError("保存结果仍未确认，请稍后再次读取。");
                } catch {
                  setError("状态暂不可读，请恢复连接后重试。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              读取保存状态
            </button>
          )}
          {unknown && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void read()}
            >
              读取保存状态
            </button>
          )}
          {!readOnly && (
            <FormSubmit
              busy={busy}
              spinner
              disabled={!!unknown || !!unknownWrite}
            >
              保存
            </FormSubmit>
          )}
        </FormActions>
      </form>
    </Modal>
  );
}
