import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  AuthenticationView,
  PrivateField,
  PrivateFieldView,
} from "../../shared/credentials";
export type PrivateFieldsDraft = {
  fields: PrivateField[];
  values: Record<string, string>;
  clearValues: boolean;
  removeFields: PrivateField[];
};
export type PrivateFieldsHandle = {
  read: () => PrivateFieldsDraft;
  clear: () => void;
};
export default forwardRef<
  PrivateFieldsHandle,
  {
    transport: "http" | "stdio";
    initial?: PrivateFieldView;
    legacyBearer?: boolean;
    authentication?: AuthenticationView;
    disabled: boolean;
    compact?: boolean;
    provider?: boolean;
  }
>(function PrivateFieldEditor(
  {
    transport,
    initial,
    legacyBearer,
    authentication,
    disabled,
    provider,
    compact,
  },
  ref,
) {
  const [auth, setAuth] = useState(
    authentication?.source === "external"
      ? "external"
      : initial?.fields.some((f) => f.kind === "bearer") || legacyBearer
        ? "bearer"
        : "none",
  );
  const [rows, setRows] = useState(
    () =>
      initial?.fields
        .filter((f) => f.kind !== "bearer")
        .map((f) => ({ ...f, id: crypto.randomUUID() })) || [],
  );
  const [chat, setChat] = useState(
    !!initial?.fields.length && initial.fields.every((f) => !f.stored),
  );
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const bearerStored =
    authentication?.state !== "invalid" &&
    (initial?.fields.some((f) => f.kind === "bearer" && f.stored) ||
      (legacyBearer && authentication?.state !== "missing"));
  const fields = () => [
    ...(transport === "http" && auth === "bearer"
      ? [{ kind: "bearer" as const, name: "Authorization" }]
      : []),
    ...rows
      .filter((r) => r.name.trim())
      .map(({ kind, name }) => ({ kind, name: name.trim() })),
  ];
  useImperativeHandle(ref, () => ({
    read() {
      const list = fields(),
        values: Record<string, string> = {};
      if (!chat)
        for (const f of list) {
          const value = inputs.current.get(
            f.kind === "bearer"
              ? "bearer"
              : rows.find((r) => r.name.trim() === f.name)?.id || "",
          )?.value;
          if (value) values[`${f.kind}:${f.name}`] = value;
        }
      const existing: PrivateField[] = initial?.fields.length
        ? initial.fields
        : legacyBearer
          ? [{ kind: "bearer", name: "Authorization" }]
          : [];
      return {
        fields: list,
        values,
        clearValues: chat,
        removeFields: existing.filter(
          (field) =>
            !list.some(
              (next) => next.kind === field.kind && next.name === field.name,
            ),
        ),
      };
    },
    clear() {
      for (const input of inputs.current.values()) input.value = "";
    },
  }));
  const bind = (id: string) => (node: HTMLInputElement | null) => {
    if (node) inputs.current.set(id, node);
    else inputs.current.delete(id);
  };
  return (
    <fieldset
      className="private-fields"
      disabled={disabled || authentication?.source === "external"}
    >
      <legend className={compact ? "sr-only" : undefined}>
        {transport === "stdio" ? "环境变量" : "认证"}
      </legend>
      {transport === "http" && (
        <label className="field-label">
          <span className={compact ? "sr-only" : undefined}>认证方式</span>
          <select
            aria-label="认证方式"
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
          >
            <option value="none">无需认证</option>
            {auth === "external" && (
              <option value="external">由服务端配置</option>
            )}
            {!provider && <option value="oauth">OAuth 登录</option>}
            <option value="bearer">
              {provider ? "API Key" : "Bearer Token"}
            </option>
          </select>
        </label>
      )}
      {authentication?.state === "invalid" && (
        <p className="inline-error" role="status">
          已保存凭证与当前接收方不匹配或暂不可用，请重新填写。
        </p>
      )}
      {authentication?.source === "external" && (
        <p className="muted">认证由服务端配置管理，本次编辑会保留。</p>
      )}
      {(auth === "bearer" || rows.length > 0) && (
        <label className="provider-checkbox">
          <input
            type="checkbox"
            checked={chat}
            onChange={(e) => {
              setChat(e.target.checked);
              for (const input of inputs.current.values()) input.value = "";
            }}
          />
          在对话中授权
        </label>
      )}
      {transport === "http" && auth === "bearer" && !chat && (
        <label className="field-label">
          <span className={compact ? "sr-only" : undefined}>
            {provider ? "API Key" : "Token"}
          </span>
          <input
            ref={bind("bearer")}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={provider ? "API Key" : "Bearer Token"}
            placeholder={
              bearerStored
                ? "已加密保存，留空保留"
                : provider
                  ? "API Key"
                  : "Bearer Token"
            }
            maxLength={4096}
          />
        </label>
      )}
      {rows.map((row, i) => (
        <div className="private-field-row" key={row.id}>
          <input
            aria-label={`${transport === "stdio" ? "环境变量" : "请求头"}名称 ${i + 1}`}
            value={row.name}
            placeholder={transport === "stdio" ? "SERVICE_TOKEN" : "X-Api-Key"}
            onChange={(e) =>
              setRows(
                rows.map((r) =>
                  r.id === row.id
                    ? { ...r, name: e.target.value, stored: false }
                    : r,
                ),
              )
            }
            required
            maxLength={128}
          />
          {!chat && (
            <input
              ref={bind(row.id)}
              type="password"
              aria-label={`${transport === "stdio" ? "环境变量" : "请求头"}私密值 ${i + 1}`}
              autoComplete="off"
              spellCheck={false}
              placeholder={row.stored ? "已保存，留空保留" : "私密值"}
              maxLength={4096}
            />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`移除私密字段 ${i + 1}`}
            title="移除字段"
            onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={rows.length >= 31}
        onClick={() =>
          setRows([
            ...rows,
            {
              id: crypto.randomUUID(),
              kind: transport === "stdio" ? "env" : "header",
              name: "",
              stored: false,
            },
          ])
        }
      >
        <Plus size={15} />
        添加{transport === "stdio" ? "环境变量" : "请求头"}
      </button>
      {chat && (
        <p className="muted">任务开始前输入，可选择仅本次任务或当前会话。</p>
      )}
      {auth === "oauth" && <p className="muted">保存后在连接器菜单中登录。</p>}
    </fieldset>
  );
});
