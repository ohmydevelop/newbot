import { FormActions, FormSubmit } from "./FormActions";
import { useMcpOAuthCompletion, type OAuthAttempt } from "../use-mcp-oauth";
import { connectionStateLabels } from "../connection-state";
import { CatalogDetail } from "./CatalogNavigation";
import { SkillIcon as BookOpen } from "./AppIcons";
import { useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Power,
  PowerOff,
  Settings2,
  Unplug,
} from "lucide-react";
import type { Json } from "../../shared/types";
import type { PluginConnection } from "../../shared/plugin-configuration";
import {
  privateApi,
  PrivateOutcomeUnknown,
  sendPrivateFields,
} from "../private-input";
import { loadDiscovery, request } from "../store";
import SkillReader from "./SkillReader";
import CertificatePicker from "./CertificatePicker";
import {
  certificateSelectionValid,
  clearStaleCertificate,
  type CertificateSelection,
} from "../certificate-draft";

function ConnectionEditor({
  connection: c,
  onSaved,
  onDirty,
  onCheck,
  checking,
  blocked,
  canCheck,
}: {
  connection: PluginConnection;
  onSaved: () => Promise<void>;
  onDirty: () => void;
  onCheck: () => void;
  checking: boolean;
  blocked: boolean;
  canCheck: boolean;
}) {
  const form = useRef<HTMLFormElement>(null),
    uid = useId();
  const acquiredCertificate = useRef<CertificateSelection | null>(null);
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >(() =>
    Object.fromEntries(
      c.fields
        .filter((f) => !f.sensitive && f.value !== undefined)
        .map((f) => [f.id, f.value!]),
    ),
  );
  const [enabled, setEnabled] = useState(c.enabled),
    [clear, setClear] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(""),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  async function accepted() {
    if (form.current)
      for (const el of form.current.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      ))
        el.value = "";
    setUnknown("");
    setDirty(false);
    try {
      await onSaved();
    } catch {
      setError("配置已保存，详情读取失败；请重新打开插件查看。");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || unknown) return;
    onDirty();
    setBusy(true);
    setError("");
    const secrets: Record<string, string> = {};
    for (const f of c.fields.filter((f) => f.sensitive)) {
      const el = form.current?.elements.namedItem(
        f.id,
      ) as HTMLInputElement | null;
      if (el?.value) secrets[f.id] = el.value;
    }
    try {
      await sendPrivateFields(
        {
          operation: "plugin.configuration.save",
          pluginId: c.pluginId,
          connectionId: c.id,
          expectedRevision: c.revision,
          schemaDigest: c.schemaDigest,
          values,
          enabled,
          clearSecrets: clear,
        },
        secrets,
      );
      await accepted();
    } catch (e) {
      if (e instanceof PrivateOutcomeUnknown) setUnknown(e.ticketId);
      setError(e instanceof Error ? e.message : "保存未完成，请重试。");
    } finally {
      Object.keys(secrets).forEach((k) => delete secrets[k]);
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    try {
      const ticket = await privateApi(`/api/credentials/${unknown}`);
      if (ticket.state === "succeeded") await accepted();
      else if (
        ["failed", "cancelled", "expired", "invalidated"].includes(ticket.state)
      ) {
        setUnknown("");
        setError(ticket.message || "配置未保存，可以重新提交。");
      } else setError("保存仍在处理中，请稍后再次查询。");
    } catch {
      setError("暂时无法确认保存结果，请恢复连接后查询。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="plugin-connection-form"
      onSubmit={submit}
      onChange={() => {
        setDirty(true);
        onDirty();
      }}
    >
      <fieldset disabled={busy || blocked || !!unknown}>
        {c.fields.map((f) => (
          <div className="plugin-config-field" key={f.id}>
            <label htmlFor={`${uid}-${f.id}`}>
              {f.title}
              {!f.required && !/[（(]可选[）)]/.test(f.title) && (
                <span className="muted">（可选）</span>
              )}
            </label>
            {f.type === "boolean" ? (
              <input
                id={`${uid}-${f.id}`}
                type="checkbox"
                checked={values[f.id] === true}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.checked }))
                }
              />
            ) : f.sensitive ? (
              <div className="plugin-secret-input">
                <input
                  id={`${uid}-${f.id}`}
                  name={f.id}
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  required={
                    enabled && f.required && !f.stored && !clear.includes(f.id)
                  }
                  placeholder={
                    clear.includes(f.id)
                      ? "保存后清除"
                      : f.stored
                        ? "已保存，输入新值可替换"
                        : "请输入"
                  }
                  aria-describedby={
                    f.description ? `${uid}-${f.id}-help` : undefined
                  }
                />
                {f.stored && (
                  <button
                    type="button"
                    className="secondary"
                    aria-pressed={clear.includes(f.id)}
                    onClick={() => {
                      setDirty(true);
                      onDirty();
                      setClear((v) =>
                        v.includes(f.id)
                          ? v.filter((id) => id !== f.id)
                          : [...v, f.id],
                      );
                    }}
                  >
                    {clear.includes(f.id) ? "撤销清除" : "清除"}
                  </button>
                )}
              </div>
            ) : (
              <input
                id={`${uid}-${f.id}`}
                type={f.type === "number" ? "number" : "text"}
                value={String(values[f.id] ?? "")}
                min={f.min}
                max={f.max}
                step="any"
                maxLength={4096}
                required={enabled && f.required}
                aria-describedby={
                  f.description ? `${uid}-${f.id}-help` : undefined
                }
                onChange={(e) =>
                  setValues((v) => {
                    const next = { ...v };
                    if (e.target.value === "") delete next[f.id];
                    else
                      next[f.id] =
                        f.type === "number"
                          ? Number(e.target.value)
                          : e.target.value;
                    return clearStaleCertificate(
                      next,
                      acquiredCertificate.current,
                    );
                  })
                }
              />
            )}
            {f.description && (
              <small id={`${uid}-${f.id}-help`} className="muted">
                {f.description}
              </small>
            )}
          </div>
        ))}
        <CertificatePicker
          connection={c}
          values={values}
          onUse={(selection) => {
            if (!certificateSelectionValid(c, values, selection)) return;
            setDirty(true);
            onDirty();
            acquiredCertificate.current = selection;
            setValues((v) =>
              certificateSelectionValid(c, v, selection)
                ? {
                    ...v,
                    [selection.targetId]: selection.observation.fingerprint,
                  }
                : v,
            );
          }}
        />
        <label className="plugin-enable">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用连接器
        </label>
        <FormActions layout="editor">
          <button
            className="secondary"
            type="button"
            disabled={!canCheck || dirty || checking}
            onClick={onCheck}
            title={dirty ? "请先保存更改" : undefined}
          >
            <Unplug size={16} />
            {checking ? "正在检查…" : dirty ? "保存后检查" : "检查连接"}
          </button>
          <FormSubmit busy={busy} busyLabel="正在保存…">
            保存
          </FormSubmit>
        </FormActions>
      </fieldset>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {unknown && (
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => void check()}
        >
          查询保存结果
        </button>
      )}
    </form>
  );
}

export default function PluginComponents({
  detail,
  onUpdate,
}: {
  detail: Json;
  onUpdate: (detail: Json) => void;
}) {
  const [editing, setEditing] = useState(""),
    [reading, setReading] = useState<Json | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<Record<string, string>>({}),
    [statuses, setStatuses] = useState<Record<string, Json>>({});
  const [oauth, setOauth] = useState<OAuthAttempt | null>(null);
  useMcpOAuthCompletion(oauth, (success, id) => {
    setOauth(null);
    const connection = detail.connections?.find(
      (c: PluginConnection) => c.id === id,
    );
    if (!connection) return;
    if (success) void check(connection);
    else setError("账号授权未完成，请重新连接账号。");
  });
  const diagnosticGeneration = useRef<Record<string, number>>({});
  function invalidateConnection(id: string) {
    diagnosticGeneration.current[id] =
      (diagnosticGeneration.current[id] || 0) + 1;
    setNotice((v) => ({ ...v, [id]: "" }));
    setStatuses((v) => {
      const next = { ...v };
      delete next[id];
      return next;
    });
    setOauth((v) => (v?.id === id ? null : v));
  }
  const refresh = async () => {
    const next = await request<Json>("plugin/read", { id: detail.id });
    onUpdate(next);
    return next;
  };
  async function action(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy("");
    }
  }
  const check = (c: PluginConnection) =>
    action(`check:${c.id}`, async () => {
      invalidateConnection(c.id);
      const generation = diagnosticGeneration.current[c.id];
      let result: Json;
      try {
        result = await request<Json>("plugin/connection/test", {
          pluginId: detail.id,
          connectionId: c.id,
        });
      } catch (error) {
        if (diagnosticGeneration.current[c.id] !== generation) return;
        throw error;
      }
      if (diagnosticGeneration.current[c.id] !== generation) return;
      setStatuses((v) => ({ ...v, [c.id]: result }));
      setNotice((v) => ({ ...v, [c.id]: "" }));
    });
  if (reading)
    return (
      <CatalogDetail
        open
        title={reading.displayName || reading.name}
        onOpenChange={(open) => {
          if (!open) setReading(null);
        }}
      >
        <SkillReader
          skill={{
            id: reading.id,
            name: reading.name,
            displayName: reading.displayName || reading.name,
            scope: "user",
            pluginId: detail.id,
          }}
          pluginId={detail.id}
          backLabel="返回插件"
          onBack={() => setReading(null)}
        />
      </CatalogDetail>
    );
  return (
    <div className="plugin-components">
      {!!detail.connections?.length && (
        <section aria-label="插件连接器">
          <h4>连接器</h4>
          {(detail.connections as PluginConnection[]).map((c) => (
            <div className="plugin-component" key={c.id}>
              <div className="plugin-component-row">
                <span className="plugin-component-copy">
                  <strong>{c.name}</strong>
                  <small className="muted">
                    {c.reason ||
                      (!detail.enabled
                        ? "插件已停用"
                        : !c.enabled
                          ? "已停用"
                          : statuses[c.id]?.authStatus === "notLoggedIn"
                            ? "需要授权"
                            : connectionStateLabels[
                                statuses[c.id]?.runtimeStatus
                              ] || (c.configured ? "已配置" : "待配置"))}
                  </small>
                </span>
                {c.fields.length || c.reviewRequired ? (
                  <button
                    type="button"
                    className="secondary"
                    aria-expanded={editing === c.id}
                    aria-controls={`config-${c.id}`}
                    onClick={() => setEditing((v) => (v === c.id ? "" : c.id))}
                  >
                    <Settings2 size={16} />
                    配置
                    <ChevronDown size={15} />
                  </button>
                ) : (
                  !c.reason && (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        title="检查连接"
                        aria-label={`检查 ${c.name} 连接`}
                        disabled={!!busy || !detail.enabled || !c.enabled}
                        onClick={() => void check(c)}
                      >
                        <Unplug size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title={c.enabled ? "停用连接器" : "启用连接器"}
                        aria-label={`${c.enabled ? "停用" : "启用"} ${c.name}`}
                        disabled={!!busy}
                        onClick={() =>
                          void action(c.id, async () => {
                            await sendPrivateFields(
                              {
                                operation: "plugin.configuration.save",
                                pluginId: c.pluginId,
                                connectionId: c.id,
                                expectedRevision: c.revision,
                                schemaDigest: c.schemaDigest,
                                values: {},
                                enabled: !c.enabled,
                                clearSecrets: [],
                              },
                              {},
                            );
                            await refresh();
                          })
                        }
                      >
                        {c.enabled ? (
                          <Power size={18} />
                        ) : (
                          <PowerOff size={18} />
                        )}
                      </button>
                    </>
                  )
                )}
              </div>
              {editing === c.id && (
                <div id={`config-${c.id}`}>
                  <ConnectionEditor
                    key={`${c.id}:${c.revision}:${c.schemaDigest}`}
                    connection={c}
                    onCheck={() => void check(c)}
                    checking={busy === `check:${c.id}`}
                    blocked={!!busy}
                    canCheck={
                      !!detail.enabled && c.enabled && c.configured && !c.reason
                    }
                    onDirty={() => invalidateConnection(c.id)}
                    onSaved={async () => {
                      const next = await refresh();
                      const connection = next.connections?.find(
                        (v: PluginConnection) => v.id === c.id,
                      );
                      setNotice((v) => ({
                        ...v,
                        [c.id]:
                          !next.enabled || connection?.enabled === false
                            ? "已保存，连接器已停用。"
                            : connection?.configured
                              ? "已保存，下次任务使用。"
                              : `已保存，连接器待配置${connection?.reason ? `：${connection.reason}` : ""}。`,
                      }));
                    }}
                  />
                </div>
              )}
              {notice[c.id] && (
                <p role="status" className="plugin-component-notice">
                  <Check size={15} />
                  {notice[c.id]}
                </p>
              )}
              {!!statuses[c.id]?.toolCount && (
                <details>
                  <summary>工具目录</summary>
                  <ul>
                    {Object.keys(statuses[c.id].tools).map((tool) => (
                      <li key={tool}>{tool}</li>
                    ))}
                  </ul>
                </details>
              )}
              {(statuses[c.id]?.authStatus === "notLoggedIn" ||
                statuses[c.id]?.runtimeStatus === "authenticationRequired") && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void action(c.id, async () => {
                      const generation =
                        diagnosticGeneration.current[c.id] || 0;
                      let result: Json;
                      try {
                        result = await request<Json>("mcp/oauth", {
                          name: c.id,
                        });
                      } catch (error) {
                        if (
                          (diagnosticGeneration.current[c.id] || 0) !==
                          generation
                        )
                          return;
                        throw error;
                      }
                      if (
                        (diagnosticGeneration.current[c.id] || 0) !== generation
                      )
                        return;
                      const url = new URL(result.authorizationUrl);
                      if (
                        url.protocol !== "https:" &&
                        !(
                          url.protocol === "http:" &&
                          ["127.0.0.1", "localhost", "[::1]"].includes(
                            url.hostname,
                          )
                        )
                      )
                        throw Error("授权地址无效");
                      setOauth({
                        id: c.id,
                        url: url.href,
                        loginId: result.loginId,
                      });
                    })
                  }
                >
                  连接账号
                </button>
              )}
              {oauth?.id === c.id && (
                <a
                  className="secondary"
                  href={oauth.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  继续账号授权
                </a>
              )}
            </div>
          ))}
        </section>
      )}
      {!!detail.skills?.length && (
        <section aria-label="插件技能">
          <h4>技能</h4>
          {detail.skills.map((skill: Json) => (
            <div className="plugin-component-row" key={skill.id || skill.name}>
              <button
                type="button"
                className="catalog-entry-main"
                disabled={!skill.id || !!busy}
                onClick={() => setReading(skill)}
              >
                <BookOpen size={20} />
                <span>
                  <strong>{skill.displayName || skill.name}</strong>
                  <small>{skill.description}</small>
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                title={skill.enabled ? "停用技能" : "启用技能"}
                aria-label={`${skill.enabled ? "停用" : "启用"} ${skill.displayName || skill.name}`}
                disabled={!skill.id || !!busy || !detail.available}
                onClick={() =>
                  void action(skill.id, async () => {
                    onUpdate(
                      await request("plugin/skill/enabled", {
                        pluginId: detail.id,
                        id: skill.id,
                        enabled: !skill.enabled,
                        expectedRevision: detail.extensionRevision,
                      }),
                    );
                    await loadDiscovery("skills");
                  })
                }
              >
                {skill.enabled ? <Power size={18} /> : <PowerOff size={18} />}
              </button>
            </div>
          ))}
        </section>
      )}
      {!!detail.hooks?.length && (
        <section aria-label="插件钩子">
          <h4>自动操作</h4>
          <p className="muted">{detail.hooks.join("、")}</p>
        </section>
      )}
      {error && (
        <div>
          <p className="inline-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={() => void action("refresh", refresh)}
          >
            重新读取插件
          </button>
        </div>
      )}
    </div>
  );
}
