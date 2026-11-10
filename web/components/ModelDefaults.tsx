import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type {
  ConfigurationView,
  DefaultsSaveResult,
  ConfigSource,
} from "../../shared/configuration";
import type { Model } from "../../shared/types";
import ConfigurationFeedback, {
  useConfigurationRecovery,
} from "./ConfigurationFeedback";
import { useApp, loadSettings, request } from "../store";
const originLabel = (source: ConfigSource | null | undefined) =>
  source?.profile
    ? "用户 Profile"
    : {
        user: "用户配置",
        memory: "服务端内存",
        sqlite: "服务端数据库",
        project: "项目配置",
        system: "系统配置",
        sessionFlags: "运行参数",
        enterpriseManaged: "管理策略",
        mdm: "管理策略",
        packagedDefaults: "内置默认值",
      }[source?.type || ""] || "运行时默认值";
export default function ModelDefaults() {
  const settings = useApp((s) => s.settings);
  const settingsLoading = useApp((s) => s.settingsLoading);
  const models = (settings?.models || []) as Model[];
  const current = (settings?.configuration || null) as ConfigurationView | null;
  const fallback = (view: ConfigurationView | null, inventory = models) => {
    const model =
      view?.defaults.model ||
      inventory.find((m) => m.isDefault)?.model ||
      inventory[0]?.model ||
      "";
    return {
      model,
      effort:
        view?.defaults.effort ||
        inventory.find((m) => m.model === model)?.defaultReasoningEffort ||
        "",
    };
  };
  const [base, setBase] = useState(current);
  const [model, setModel] = useState(fallback(current).model);
  const [effort, setEffort] = useState(fallback(current).effort);
  const recovery = useConfigurationRecovery();
  const [busyState, setBusy] = useState("");
  const busy = busyState || (recovery.busy ? "recovery" : "");
  const [notice, setNotice] = useState("");
  const initial = fallback(base);
  const dirty = model !== initial.model || effort !== initial.effort;
  useEffect(() => {
    if (!recovery.blocked && (!base || (!dirty && !busy))) {
      setBase(current);
      const values = fallback(current);
      setModel(values.model);
      setEffort(values.effort);
    }
  }, [current?.revision]);
  const selected = models.find((m) => m.model === model);
  const validEffort = !!selected?.supportedReasoningEfforts.some(
    (e) => e.reasoningEffort === effort,
  );
  async function reload() {
    setBusy("read");
    recovery.clear();
    setNotice("");
    try {
      await loadSettings();
      const view = useApp.getState().settings
        ?.configuration as ConfigurationView | null;
      if (!view) throw new Error("配置读取失败，请检查服务端配置后重试");
      setBase(view);
      const values = fallback(
        view,
        useApp.getState().settings?.models || models,
      );
      setModel(values.model);
      setEffort(values.effort);
    } catch (reason) {
      recovery.capture(reason, base?.revision);
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("save");
    recovery.clear();
    setNotice("");
    try {
      const result = await request<DefaultsSaveResult>("settings/defaults", {
        expectedRevision: base?.revision,
        model,
        effort,
      });
      const view = result.configuration;
      setBase(view);
      setModel(view.defaults.model || model);
      setEffort(view.defaults.effort || effort);
      useApp.setState((state) => ({
        settings: state.settings
          ? {
              ...state.settings,
              configuration: view,
              model: view.defaults.model,
              effort: view.defaults.effort,
            }
          : null,
        model: state.selectedId
          ? state.model
          : view.defaults.model || state.model,
        effort: state.selectedId
          ? state.effort
          : view.defaults.effort || state.effort,
      }));
      if (result.state === "overridden")
        recovery.report(
          "已写入用户配置，但生效值仍受其他配置覆盖，请检查配置来源。",
          { code: "overridden", persistence: "saved", recovery: "read" },
          base?.revision,
        );
      setNotice(
        result.state === "overridden"
          ? ""
          : "已通过 Codex 保存，并读取确认生效。下次新建对话使用此默认值。",
      );
    } catch (reason) {
      recovery.capture(reason, base?.revision);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="model-defaults" aria-label="默认模型配置">
      <label className="field-label">
        默认模型
        <select
          aria-label="默认模型"
          value={model}
          disabled={!!busy}
          onChange={(event) => {
            setModel(event.target.value);
            setEffort(
              models.find((m) => m.model === event.target.value)
                ?.defaultReasoningEffort || "",
            );
            setNotice("");
          }}
          aria-describedby={!selected ? "default-model-error" : undefined}
        >
          {!selected && !settingsLoading && (
            <option value={model}>{model || "暂无可用模型"}</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.model}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      {!selected && (
        <p className="inline-error" id="default-model-error">
          当前默认模型未被发现，请选择可用模型后保存。
        </p>
      )}
      <label className="field-label">
        默认推理强度
        <select
          aria-label="默认推理强度"
          value={effort}
          disabled={!!busy || !selected}
          onChange={(e) => {
            setEffort(e.target.value);
            setNotice("");
          }}
          aria-describedby={!validEffort ? "default-effort-error" : undefined}
        >
          {!validEffort && <option value={effort}>{effort || "请选择"}</option>}
          {selected?.supportedReasoningEfforts.map((e) => (
            <option key={e.reasoningEffort} value={e.reasoningEffort}>
              {e.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      {!validEffort && selected && (
        <p className="inline-error" id="default-effort-error">
          请选择该模型支持的推理强度。
        </p>
      )}
      <p className="configuration-sources">
        生效来源：模型 · {originLabel(base?.sources.model)}；推理强度 ·{" "}
        {originLabel(base?.sources.effort)}
      </p>
      <ConfigurationFeedback
        recovery={recovery}
        busy={!!busyState}
        hasDraft={dirty}
        onAdopt={(settings) => {
          const view = settings.configuration as ConfigurationView;
          setBase(view);
          const values = fallback(view, settings.models);
          setModel(values.model);
          setEffort(values.effort);
          recovery.clear();
          setNotice("已采用当前生效配置。");
        }}
      />
      {notice && (
        <p className="configuration-notice" role="status">
          {notice}
        </p>
      )}
      <div className="configuration-actions">
        <button
          type="button"
          className="primary"
          disabled={
            !!busy ||
            recovery.blocked ||
            !base?.writable ||
            !current ||
            !dirty ||
            !selected ||
            !validEffort
          }
          onClick={() => void save()}
        >
          {busy === "save" && (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          )}
          保存到 Codex
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => void reload()}
        >
          <RefreshCw
            size={15}
            className={busy === "read" ? "spin" : ""}
            aria-hidden="true"
          />
          {dirty ? "读取最新并重置修改" : "重新读取配置"}
        </button>
      </div>
    </section>
  );
}
