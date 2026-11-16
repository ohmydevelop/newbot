import { CatalogFilter } from "./CatalogFilter";
import { skillScopes } from "../../shared/skills";
import type { Json } from "../../shared/types";
import {
  lazy,
  Suspense,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  catalogViews,
  useCatalogField,
  type CatalogSection,
} from "../catalog-state";
import { CatalogNavigation } from "./CatalogNavigation";
const Models = lazy(() => import("./ProviderSettings"));
const Experts = lazy(() => import("./ExpertsSettings"));
const Plugins = lazy(() => import("./ToolsSettings"));
const Skills = lazy(() => import("./SkillsSettings"));
export default function ExtensionsSettings({
  tab,
  toolbar,
  onLocked,
  onUse,
  restoreFocus,
}: {
  tab: CatalogSection;
  restoreFocus: boolean;
  toolbar: HTMLElement | null;
  onUse?: (kind: "$" | "@", entry: Json, signal: AbortSignal) => Promise<void>;
  onLocked?: (locked: boolean) => void;
}) {
  const [skillScope, setSkillScope] = useCatalogField("skills", "filter");
  const [locks, setLocks] = useState(0);
  const lock = useCallback(() => {
    setLocks((n) => n + 1);
    return () => setLocks((n) => n - 1);
  }, []);
  useEffect(() => {
    onLocked?.(locks > 0);
    return () => onLocked?.(false);
  }, [locks, onLocked]);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const saved = catalogViews.getState().views[tab];
    restoring.current = saved.scroll > 0;
    const restore = () => {
      const current = catalogViews.getState().views[tab];
      if (current.query !== saved.query || current.filter !== saved.filter)
        restoring.current = false;
      if (
        !restoring.current ||
        node.scrollHeight - node.clientHeight < saved.scroll
      )
        return;
      node.scrollTop = saved.scroll;
      restoring.current = false;
    };
    const observer = new MutationObserver(restore);
    observer.observe(node, { childList: true, subtree: true });
    restore();
    const cancelRestore = () => {
      restoring.current = false;
    };
    const dialog = node.closest(".settings-dialog");
    dialog?.addEventListener("wheel", cancelRestore, { passive: true });
    dialog?.addEventListener("pointerdown", cancelRestore, true);
    dialog?.addEventListener("keydown", cancelRestore, true);
    return () => {
      observer.disconnect();
      dialog?.removeEventListener("wheel", cancelRestore);
      dialog?.removeEventListener("pointerdown", cancelRestore, true);
      dialog?.removeEventListener("keydown", cancelRestore, true);
    };
  }, [tab]);
  useEffect(() => {
    if (!restoreFocus || !toolbar || !scroller.current) return;
    const label = catalogViews.getState().views[tab].focus;
    if (!label) return;
    let done = false;
    const cancelRestore = () => {
      done = true;
    };
    const dialog = toolbar.closest(".settings-dialog");
    dialog?.addEventListener("wheel", cancelRestore, { passive: true });
    dialog?.addEventListener("pointerdown", cancelRestore, true);
    dialog?.addEventListener("keydown", cancelRestore, true);
    const restore = () => {
      if (done) return;
      const target = [
        ...toolbar.querySelectorAll<HTMLElement>("[aria-label]"),
        ...scroller.current!.querySelectorAll<HTMLElement>("[aria-label]"),
      ].find(
        (node) =>
          node.getAttribute("aria-label") === label &&
          node.getClientRects().length,
      );
      if (target) {
        done = true;
        target.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(restore);
    observer.observe(toolbar, { childList: true, subtree: true });
    observer.observe(scroller.current, { childList: true, subtree: true });
    restore();
    return () => {
      observer.disconnect();
      dialog?.removeEventListener("wheel", cancelRestore);
      dialog?.removeEventListener("pointerdown", cancelRestore, true);
      dialog?.removeEventListener("keydown", cancelRestore, true);
    };
  }, [restoreFocus, tab, toolbar]);
  return (
    <div className="extensions-settings">
      <CatalogNavigation.Provider value={{ toolbar, details, lock, onUse }}>
        <div
          ref={scroller}
          className="plugin-center-content"
          data-catalog-view={tab}
          onScroll={(event) => {
            if (!restoring.current && !details?.childElementCount)
              catalogViews
                .getState()
                .update(tab, { scroll: event.currentTarget.scrollTop });
          }}
        >
          <div className="plugin-center-list">
            {tab === "skills" && (
              <CatalogFilter
                label="技能分类"
                value={skillScope}
                onValueChange={setSkillScope}
                options={[
                  { value: "", label: "所有技能" },
                  ...Object.entries(skillScopes).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            )}
            <Suspense fallback={<p role="status">正在读取…</p>}>
              {tab === "connectors" ? (
                <Plugins />
              ) : tab === "experts" ? (
                <Experts />
              ) : tab === "models" ? (
                <Models />
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
