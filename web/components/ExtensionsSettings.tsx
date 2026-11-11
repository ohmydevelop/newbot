import { lazy, Suspense, useId, useRef, useState } from "react";
const Experts = lazy(() => import("./ExpertsSettings"));
const Plugins = lazy(() => import("./ToolsSettings"));
const Skills = lazy(() => import("./SkillsSettings"));
const tabs = [
  { id: "experts", label: "专家" },
  { id: "plugins", label: "插件" },
  { id: "skills", label: "技能" },
  { id: "connectors", label: "连接器" },
];
export default function ExtensionsSettings({
  initialTab = "experts",
}: {
  initialTab?: string;
}) {
  const [tab, setTab] = useState(
    initialTab === "mcp"
      ? "connectors"
      : tabs.some((t) => t.id === initialTab)
        ? initialTab
        : "experts",
  );
  const id = useId(),
    refs = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div className="extensions-settings">
      <div className="extension-tabs" role="tablist" aria-label="扩展分类">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${id}-${t.id}`}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
            }}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const index =
                e.key === "ArrowRight"
                  ? (i + 1) % tabs.length
                  : e.key === "ArrowLeft"
                    ? (i + tabs.length - 1) % tabs.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (index >= 0) {
                e.preventDefault();
                setTab(tabs[index].id);
                refs.current.get(tabs[index].id)?.focus();
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        <Suspense fallback={<p role="status">正在读取扩展…</p>}>
          {tab === "experts" && <Experts />}
          {(tab === "plugins" || tab === "connectors") && (
            <Plugins key={tab} mode={tab} />
          )}
          {tab === "skills" && <Skills />}
        </Suspense>
      </div>
    </div>
  );
}
