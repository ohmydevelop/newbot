import { skillScopes } from "../../shared/skills";
import type { Json } from "../../shared/types";
import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import { CatalogNavigation } from "./CatalogNavigation";
const Experts = lazy(() => import("./ExpertsSettings"));
const Plugins = lazy(() => import("./ToolsSettings"));
const Skills = lazy(() => import("./SkillsSettings"));
const tabs = [
  { id: "connectors", label: "连接器" },
  { id: "skills", label: "技能" },
  { id: "experts", label: "专家" },
];
export default function ExtensionsSettings({
  initialTab = "plugins",
  onLocked,
  onUse,
}: {
  initialTab?: string;
  onUse?: (kind: "$" | "@", entry: Json, signal: AbortSignal) => Promise<void>;
  onLocked?: (locked: boolean) => void;
}) {
  const [tab, setTab] = useState(
    ["skills", "experts"].includes(initialTab) ? initialTab : "connectors",
  );
  const [skillScope, setSkillScope] = useState("");
  const [locks, setLocks] = useState(0);
  const lock = useCallback(() => {
    setLocks((n) => n + 1);
    return () => setLocks((n) => n - 1);
  }, []);
  useEffect(() => {
    onLocked?.(locks > 0);
    return () => onLocked?.(false);
  }, [locks, onLocked]);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  const id = useId(),
    refs = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div
      className="extensions-settings"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && details?.lastElementChild) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          details.lastElementChild
            .querySelector<HTMLButtonElement>(".catalog-back")
            ?.click();
        }
      }}
    >
      <header className="plugin-center-header">
        <div className="extension-tabs" role="tablist" aria-label="插件分类">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              id={`${id}-${t.id}`}
              ref={(el) => {
                if (el) refs.current.set(t.id, el);
              }}
              type="button"
              disabled={locks > 0}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`${id}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const index =
                  e.key === "ArrowRight" || e.key === "ArrowLeft"
                    ? (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                      tabs.length
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
        <div className="plugin-center-tools" ref={setToolbar} />
      </header>
      <CatalogNavigation.Provider value={{ toolbar, details, lock, onUse }}>
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}`}
          className="plugin-center-content"
          data-catalog-view={tab}
        >
          <div className="plugin-center-list">
            {tab === "skills" && (
              <select
                className="catalog-kind-filter"
                aria-label="技能分类"
                value={skillScope}
                onChange={(event) => setSkillScope(event.target.value)}
              >
                <option value="">所有技能</option>
                {Object.entries(skillScopes).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <Suspense fallback={<p role="status">正在读取…</p>}>
              {tab === "connectors" ? (
                <Plugins />
              ) : tab === "experts" ? (
                <Experts />
              ) : (
                <Skills scope={skillScope} />
              )}
            </Suspense>
          </div>
          <div className="plugin-center-details" ref={setDetails} />
        </div>
      </CatalogNavigation.Provider>
    </div>
  );
}
