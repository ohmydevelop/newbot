import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { A2uiSurface, MarkdownContext } from "@a2ui/react/v0_9";
import { injectBasicCatalogStyles } from "@a2ui/web_core/v0_9/basic_catalog";
import type { ActionPayload, SurfaceModel } from "@a2ui/web_core/v0_9";
import type { ReactCatalogComponent } from "@a2ui/react/v0_9";
import {
  applyLabMessage,
  createLabProcessor,
  samples,
  sampleMessages,
  type LabVersion,
  type SampleId,
} from "./runtime.js";
import "./style.css";

injectBasicCatalogStyles();
const escapeText = async (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

function App() {
  const [sample, setSample] = useState<SampleId>("text");
  const [version, setVersion] = useState<LabVersion>("v0.9");
  const [generation, setGeneration] = useState(0);
  const [surfaces, setSurfaces] = useState<
    SurfaceModel<ReactCatalogComponent>[]
  >([]);
  const [actions, setActions] = useState<ActionPayload[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const processor = useRef<ReturnType<typeof createLabProcessor> | null>(null);
  const messages = sampleMessages(sample, version);
  useEffect(() => {
    const p = createLabProcessor(version, (action) => {
      setActions((previous) => [...previous, action].slice(-10));
    });
    processor.current = p;
    const sync = () => setSurfaces([...p.model.surfacesMap.values()]);
    const created = p.onSurfaceCreated(sync),
      deleted = p.onSurfaceDeleted(sync);
    setActions([]);
    setError("");
    try {
      p.processMessages(sampleMessages(sample, version));
      setCount(sampleMessages(sample, version).length);
      sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "样例未能加载");
    }
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
      processor.current = null;
      p.dispose();
    };
  }, [sample, version, generation]);

  const clear = () => {
    const p = processor.current;
    if (!p) return;
    for (const surfaceId of p.model.surfacesMap.keys())
      applyLabMessage(p, { version, deleteSurface: { surfaceId } });
    setActions([]);
    setCount(0);
    setError("");
  };
  const next = () => {
    try {
      if (processor.current && count < messages.length) {
        applyLabMessage(processor.current, messages[count]);
        setCount(count + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "消息未能应用");
    }
  };

  return (
    <main>
      <header>
        <p className="muted">Minimal Agent · 开发样例</p>
        <h1>A2UI 官方样例</h1>
        <p>操作只在此页显示结果，不会执行任务或调用外部服务。</p>
      </header>
      <section className="controls" aria-label="样例控制">
        <label>
          样例
          <select
            aria-label="样例"
            value={sample}
            onChange={(e) => setSample(e.target.value as SampleId)}
          >
            {Object.entries(samples).map(([id, value]) => (
              <option key={id} value={id}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          协议兼容验证
          <select
            aria-label="协议兼容验证"
            value={version}
            onChange={(e) => setVersion(e.target.value as LabVersion)}
          >
            <option value="v0.9.1">v0.9.1</option>
            <option value="v0.9">v0.9 原版</option>
          </select>
        </label>
        <div className="buttons">
          <button onClick={() => setGeneration(generation + 1)}>重放</button>
          <button onClick={clear}>清空</button>
          <button onClick={next} disabled={count >= messages.length}>
            下一条消息
          </button>
        </div>
      </section>
      <p role="status" className="muted">
        已应用 {count} / {messages.length} 条消息
      </p>
      {error && <p role="alert">{error}</p>}
      <section className="sample" aria-label="样例内容">
        {surfaces.length === 0 && <p className="muted">当前没有界面</p>}
        <MarkdownContext.Provider value={escapeText}>
          {surfaces.map((surface) => (
            <A2uiSurface key={surface.id + generation} surface={surface} />
          ))}
        </MarkdownContext.Provider>
      </section>
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
