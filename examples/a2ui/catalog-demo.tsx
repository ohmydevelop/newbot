import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ActionPayload } from "@a2ui/web_core/v0_9";
import { A2uiRuntime } from "../../web/a2ui.js";
import { A2uiPanel } from "../../web/components/a2ui/Panel.js";
import { createA2uiCatalog } from "../../web/components/a2ui/catalog.js";
import { encodeA2ui } from "../../shared/a2ui-policy.js";
import { demoMessages, demoActions, demoSurfaceId } from "./catalog-fixture.js";
import "./style.css";

let active: ReturnType<typeof makeRuntime> | null = null;
let deferAction = false,
  rejectAction = false;
let resolvePending: (() => void) | null = null;
function makeRuntime(onAction: (action: ActionPayload) => Promise<void>) {
  return new A2uiRuntime(createA2uiCatalog(), {
    surfaceId: demoSurfaceId,
    allowedActions: demoActions,
    onAction,
  });
}
// Browser-test hooks exist only in this loopback fixture; no product import.
declare global {
  interface Window {
    a2uiFixture: {
      apply: (raw: string) => string;
      control: (control: "defer" | "reject" | "resolve" | "normal") => void;
    };
  }
}
function App() {
  const [generation, setGeneration] = useState(0);
  const [runtime, setRuntime] = useState<ReturnType<typeof makeRuntime> | null>(
    null,
  );
  const [actions, setActions] = useState<ActionPayload[]>([]);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    const r = makeRuntime(async (action) => {
      if (deferAction)
        await new Promise<void>((resolve) => {
          resolvePending = resolve;
        });
      if (rejectAction) throw new Error("fixture consumer rejected");
      if (active !== r) return;
      setActions((previous) => [...previous, action].slice(-10));
    });
    active = r;
    window.a2uiFixture = {
      apply: (raw) => {
        try {
          r.apply(raw);
          setError("");
          return "ok";
        } catch (e) {
          const code = e instanceof Error ? e.message : "FAILED";
          setError(`描述未应用：${code}`);
          return code;
        }
      },
      control: (control) => {
        deferAction = control === "defer";
        rejectAction = control === "reject";
        if (control === "resolve") {
          resolvePending?.();
          resolvePending = null;
        }
      },
    };
    r.apply(encodeA2ui(demoMessages()));
    setRuntime(r);
    setActions([]);
    setError("");
    return () => {
      active = null;
      r.dispose();
      resolvePending?.();
      resolvePending = null;
    };
  }, [generation]);
  return (
    <main>
      <header>
        <p className="muted">Minimal Agent · 组件验证</p>
        <h1>A2UI React 组件</h1>
        <p>本页使用静态示例，创建操作只显示结果。</p>
      </header>
      <div className="controls">
        <button onClick={() => setGeneration(generation + 1)}>重新载入</button>
        <button
          onClick={() =>
            active?.apply(
              encodeA2ui({
                version: "v0.9",
                updateDataModel: {
                  surfaceId: demoSurfaceId,
                  path: "/status",
                  value: "监控设置已更新，已填写的内容会保留。",
                },
              }),
            )
          }
        >
          更新说明
        </button>
        <button
          onClick={() =>
            active?.apply(
              encodeA2ui({
                version: "v0.9",
                deleteSurface: { surfaceId: demoSurfaceId },
              }),
            )
          }
        >
          关闭表单
        </button>
        <label className="demo-readonly">
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => setDisabled(event.target.checked)}
          />
          只读展示
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="demo-panel">
        {runtime && <A2uiPanel runtime={runtime} disabled={disabled} />}
      </div>
      <section aria-label="本地操作结果">
        <h2>操作结果</h2>
        {actions.length ? (
          <pre data-testid="actions">{JSON.stringify(actions, null, 2)}</pre>
        ) : (
          <p className="muted">尚未触发操作</p>
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
