import { useId, useSyncExternalStore } from "react";
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { A2uiControls } from "./catalog.js";
import type { A2uiRuntime } from "../../a2ui.js";
import "./style.css";

export function A2uiPanel({
  runtime,
  disabled = false,
}: {
  runtime: A2uiRuntime<ReactCatalogComponent>;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  useSyncExternalStore(runtime.subscribe, () => runtime.revision);
  const components = [...runtime.components().values()];
  const hasInputs = components.some((component) =>
    ["TextField", "ChoicePicker"].includes(String(component.component)),
  );
  const interactive =
    hasInputs ||
    components.some((component) => component.component === "Button");
  return (
    <section
      className="a2ui-panel"
      aria-label={interactive ? "助手生成的表单" : "助手生成的内容"}
      aria-busy={runtime.busy}
    >
      {hasInputs && (
        <p className="a2ui-notice" id={descriptionId}>
          普通信息会随操作发送给助手，请勿填写密码或密钥。
        </p>
      )}
      {runtime.error && (
        <p role="alert" className="a2ui-error">
          {runtime.error}
        </p>
      )}
      <A2uiControls.Provider
        value={{ disabled: disabled || runtime.busy, descriptionId }}
      >
        {runtime.surface && runtime.components().has("root") ? (
          <A2uiSurface surface={runtime.surface} />
        ) : (
          <p className="a2ui-caption">
            {runtime.surface
              ? "表单描述不完整，请让助手重新生成。"
              : "当前表单已关闭。"}
          </p>
        )}
      </A2uiControls.Provider>
    </section>
  );
}
