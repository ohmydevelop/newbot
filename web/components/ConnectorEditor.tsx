import ServerCertificateEditor from "./ServerCertificateEditor";
import { FormActions, FormSubmit } from "./FormActions";
import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  ConfigurationView,
  DefaultsSaveResult,
} from "../../shared/configuration";
import { request } from "../store";
import { CatalogDetail as Modal } from "./CatalogNavigation";
import ConfigurationFeedback, {
  useConfigurationRecovery,
} from "./ConfigurationFeedback";
import PrivateFieldEditor, {
  type PrivateFieldsHandle,
} from "./PrivateFieldEditor";
import {
  sendPrivateFields,
  PrivateOutcomeUnknown,
  privateApi,
} from "../private-input";

export default function ConnectorEditor({
  connector,
  configuration,
  onSaved,
  onClose,
}: {
  connector?: ConfigurationView["mcp"][number];
  configuration: ConfigurationView;
  onSaved: (result: DefaultsSaveResult) => void;
  onClose: () => void;
}) {
  const id = useRef(
    connector?.id || `connector_${crypto.randomUUID().replaceAll("-", "")}`,
  );
  const operationId = useRef(crypto.randomUUID());
  const [name, setName] = useState(connector?.name || connector?.id || "");
  const [transport, setTransport] = useState(
    !connector || connector.transport === "http" ? "http" : "stdio",
  );
  const [url, setUrl] = useState(connector?.definition?.url || "");
  const [caCertificate, setCaCertificate] = useState(
    connector?.definition?.caCertificate || "",
  );
  const [readingCertificate, setReadingCertificate] = useState(false);
  const [command, setCommand] = useState(connector?.definition?.command || "");
  const [args, setArgs] = useState<string[]>(connector?.definition?.args || []);
  const [startup, setStartup] = useState(connector?.startupTimeout || 10);
  const [timeout, setTimeoutValue] = useState(connector?.toolTimeout || 60);
  const [enabled, setEnabled] = useState(connector?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(
    configuration.revisions?.[`mcp:${id.current}`] || configuration.revision,
  );
  const recovery = useConfigurationRecovery();
  const fields = useRef<PrivateFieldsHandle>(null);
  const [saved, setSaved] = useState<DefaultsSaveResult | null>(null);
  const [privateError, setPrivateError] = useState("");
  const [unknown, setUnknown] = useState<string | null>(null);
  const [rebind, setRebind] = useState(false);
  const changedReceiver =
    !!connector?.definition &&
    (transport === "http"
      ? url !== connector.definition.url
      : command !== connector.definition.command ||
        JSON.stringify(args) !==
          JSON.stringify(connector.definition.args || []));
  async function finishPrivate(result: DefaultsSaveResult) {
    const draft = fields.current!.read();
    const target = result.configuration.mcp.find((m) => m.id === id.current)!;
    if (
      draft.fields.length ||
      target.privateFields?.fields.length ||
      target.managedCredential?.stored
    )
      await sendPrivateFields(
        {
          operation: "credential.fields.save",
          scope: "mcp",
          targetId: id.current,
          expectedRevision:
            result.configuration.revisions?.[`mcp:${id.current}`] ||
            result.configuration.revision,
          expectedFieldsRevision: target.privateFields?.revision || "absent",
          fields: draft.fields,
          clearValues: draft.clearValues,
          removeFields: draft.removeFields,
        },
        draft.values,
      );
    fields.current?.clear();
    onSaved(result);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || readingCertificate) return;
    setBusy(true);
    recovery.clear();
    setPrivateError("");
    let ordinary = saved;
    try {
      const result =
        ordinary ||
        (await request<DefaultsSaveResult>(
          "mcp/save",
          {
            id: id.current,
            create: !connector,
            transport,
            rebindCredentials: changedReceiver && rebind,
            expectedRevision: revision,
            patch: {
              name,
              enabled,
              startupTimeout: startup,
              toolTimeout: timeout,
              ...(transport === "http"
                ? url
                  ? { url, caCertificate: caCertificate || null }
                  : {}
                : {
                    ...(command ? { command } : {}),
                    ...(args.length || connector?.definition ? { args } : {}),
                  }),
            },
          },
          { operationId: operationId.current },
        ));
      ordinary = result;
      setSaved(result);
      setRevision(
        result.configuration.revisions?.[`mcp:${id.current}`] ||
          result.configuration.revision,
      );
      await finishPrivate(result);
    } catch (error) {
      if (error instanceof PrivateOutcomeUnknown) {
        setUnknown(error.ticketId);
        setPrivateError(error.message);
      } else if (ordinary)
        setPrivateError(
          error instanceof Error ? error.message : "凭证设置未保存",
        );
      else {
        recovery.capture(error, revision);
        if (!(error as { operationId?: string })?.operationId)
          operationId.current = crypto.randomUUID();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={
        connector ? `编辑 ${connector.name || connector.id}` : "添加连接器"
      }
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      dismissible={!busy}
      className="connection-editor-modal catalog-form-step"
    >
      <form className="connector-editor catalog-form" onSubmit={save}>
        <div className="connection-editor-body">
          <label className="field-label">
            <span className="sr-only">名称</span>
            <input
              aria-label="连接器名称"
              placeholder="连接器名称"
              value={name}
              required
              maxLength={80}
              autoFocus
              disabled={busy || !!saved}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field-label">
            <span className="sr-only">连接方式</span>
            <select
              aria-label="连接方式"
              value={transport}
              disabled={busy || !!connector}
              onChange={(e) => setTransport(e.target.value)}
            >
              <option value="http">远程服务</option>
              <option value="stdio">本地程序</option>
            </select>
          </label>
          {transport === "http" ? (
            <label className="field-label">
              <span className="sr-only">服务地址</span>
              <input
                aria-label="服务地址"
                type="url"
                required={!connector}
                value={url}
                disabled={busy || !!saved}
                placeholder={
                  connector ? "留空保留现有地址" : "https://example.com/mcp"
                }
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
              />
            </label>
          ) : (
            <>
              <label className="field-label">
                <span className="sr-only">启动程序</span>
                <input
                  aria-label="启动程序"
                  required={!connector}
                  value={command}
                  disabled={busy || !!saved}
                  placeholder={
                    connector ? "留空保留现有程序" : "例如 npx 或 node"
                  }
                  onChange={(e) => setCommand(e.target.value)}
                />
              </label>
              <fieldset className="connector-arguments">
                <legend>参数</legend>
                {args.map((value, i) => (
                  <div className="connector-input-row" key={i}>
                    <input
                      aria-label={`参数 ${i + 1}`}
                      value={value}
                      disabled={busy || !!saved}
                      onChange={(e) =>
                        setArgs(
                          args.map((a, n) => (n === i ? e.target.value : a)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      title="移除参数"
                      aria-label={`移除参数 ${i + 1}`}
                      disabled={busy || !!saved}
                      onClick={() => setArgs(args.filter((_, n) => n !== i))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || args.length >= 64}
                  onClick={() => setArgs([...args, ""])}
                >
                  <Plus size={15} /> 添加参数
                </button>
              </fieldset>
            </>
          )}
          {transport === "http" && (
            <ServerCertificateEditor
              address={url}
              value={caCertificate}
              disabled={busy || !!saved}
              onChange={setCaCertificate}
              onBusyChange={setReadingCertificate}
            />
          )}
          <PrivateFieldEditor
            compact
            key={transport}
            ref={fields}
            transport={transport as "http" | "stdio"}
            initial={connector?.privateFields}
            authentication={connector?.authentication}
            legacyBearer={
              (!connector?.privateFields ||
                connector.privateFields.revision === "absent") &&
              connector?.authentication?.source === "managed"
            }
            disabled={busy || !!unknown}
          />
          {changedReceiver && (
            <label className="provider-checkbox">
              <input
                type="checkbox"
                checked={rebind}
                required
                disabled={busy || !!saved}
                onChange={(e) => setRebind(e.target.checked)}
              />
              使用新连接信息，重新配置其凭证
            </label>
          )}
          {saved && privateError && (
            <p className="muted">连接信息已保存，凭证设置尚未完成。</p>
          )}
          {privateError && (
            <p role="alert" className="inline-error">
              {privateError}
            </p>
          )}
          {unknown && (
            <button
              type="button"
              className="text-button"
              disabled={busy || !!saved}
              onClick={() => {
                setBusy(true);
                void privateApi(`/api/credentials/${unknown}`)
                  .then((ticket) => {
                    if (ticket.state === "succeeded" && saved) {
                      fields.current?.clear();
                      onSaved(saved);
                    } else if (
                      [
                        "failed",
                        "cancelled",
                        "expired",
                        "invalidated",
                        "waiting",
                      ].includes(ticket.state)
                    ) {
                      setUnknown(null);
                      setPrivateError("凭证未保存，请重新输入后保存。");
                    } else setPrivateError("正在保存，请稍后再次读取。");
                  })
                  .catch(() =>
                    setPrivateError("状态暂不可读，请恢复连接后重试。"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              读取保存状态
            </button>
          )}
          <details className="advanced-settings">
            <summary>高级设置</summary>
            <label className="field-label">
              启动超时（秒）
              <input
                type="number"
                min={1}
                max={120}
                value={startup}
                disabled={busy || !!saved}
                onChange={(e) => setStartup(Number(e.target.value))}
              />
            </label>
            <label className="field-label">
              工具超时（秒）
              <input
                type="number"
                min={1}
                max={600}
                value={timeout}
                disabled={busy || !!saved}
                onChange={(e) => setTimeoutValue(Number(e.target.value))}
              />
            </label>
            <label className="provider-checkbox">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || !!saved}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用此连接器
            </label>
          </details>
          <ConfigurationFeedback
            recovery={recovery}
            scope="mcp"
            target={id.current}
            hasDraft
            busy={busy}
            showAvailability={false}
            onAdopt={(settings) => {
              if (recovery.operationResult)
                setSaved(recovery.operationResult as DefaultsSaveResult);
              operationId.current = crypto.randomUUID();
              setRevision(
                settings.configuration.revisions?.[`mcp:${id.current}`] ||
                  settings.configuration.revision,
              );
              recovery.clear();
            }}
          />
        </div>
        <FormActions layout="editor">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <FormSubmit
            busy={busy}
            spinner
            disabled={readingCertificate || recovery.blocked || !!unknown}
          >
            {connector ? "保存" : "添加"}
          </FormSubmit>
        </FormActions>
      </form>
    </Modal>
  );
}
