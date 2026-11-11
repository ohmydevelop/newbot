import SkillImport from "./SkillImport";
import { CatalogToolbar } from "./CatalogToolbar";
import { useRef, useState, useEffect } from "react";
import { BookOpen, RefreshCw, Trash2, Plus } from "lucide-react";
import type { Skill, SkillDocument } from "../../shared/types";
import { loadSettings, loadDiscovery, request, useApp } from "../store";
import {
  skillScopes as scopes,
  skillLabel as displayName,
} from "../../shared/skills";
import SkillReader from "./SkillReader";
import CatalogIcon from "./CatalogIcon";
import { Modal } from "./ui";
import { readSkill } from "../skills";
export default function SkillsSettings() {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    void loadDiscovery("skills");
  }, []);
  const readable = useApp((s) => s.skillDocuments);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [removing, setRemoving] = useState<SkillDocument | null>(null);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const entries = useRef(new Map<string, HTMLButtonElement>());
  const refresh = useRef<HTMLButtonElement>(null);
  const discoveryFailed = settings?.errors?.some(
    (e: { section: string }) => e.section === "skills",
  );
  async function action(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "技能操作失败，请重试",
      );
    } finally {
      setBusy("");
    }
  }
  if (selected && readable)
    return (
      <SkillReader
        skill={selected}
        onBack={() => {
          const id = selected.id;
          setSelected(null);
          requestAnimationFrame(() =>
            (entries.current.get(id) || refresh.current)?.focus(),
          );
        }}
      />
    );
  return (
    <div className="skills-settings">
      <CatalogToolbar
        label="技能"
        query={query}
        onQuery={setQuery}
        filters={
          <select
            aria-label="技能来源"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">所有来源</option>
            {Object.entries(scopes).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        }
      >
        <button
          className="icon-button"
          aria-label="添加技能"
          title="添加技能"
          onClick={() => setImporting(true)}
        >
          <Plus size={18} />
        </button>
        <button
          ref={refresh}
          className="icon-button"
          aria-label="刷新技能"
          title="刷新技能"
          disabled={!!busy}
          onClick={() => void action("refresh", () => loadDiscovery("skills"))}
        >
          <RefreshCw
            size={17}
            className={busy === "refresh" ? "spin" : ""}
            aria-hidden="true"
          />
        </button>
      </CatalogToolbar>
      {importing && <SkillImport onClose={() => setImporting(false)} />}
      {(error || discoveryFailed) && (
        <p className="inline-error" role="alert">
          {error || "技能列表读取失败，请刷新后重试。"}
        </p>
      )}
      {settings?.skillsWarnings > 0 && (
        <p className="inline-error" role="alert">
          有 {settings?.skillsWarnings}{" "}
          项技能无法加载，请检查服务端技能配置后刷新。
        </p>
      )}
      {!settings?.skills.length && !discoveryFailed && (
        <div className="empty-settings">
          <BookOpen size={28} aria-hidden="true" />
          <strong>没有发现技能</strong>
          <p>添加技能后刷新。</p>
        </div>
      )}
      {removing && (
        <Modal
          open
          title={`卸载 ${displayName(removing.skill)}`}
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        >
          <p>该技能将移出个人技能目录，可从服务端备份恢复。</p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() => setRemoving(null)}
            >
              保留
            </button>
            <button
              type="button"
              className="primary destructive"
              disabled={!!busy}
              onClick={() =>
                void action("uninstall", async () => {
                  await request("skills/uninstall", {
                    id: removing.skill.id,
                    sha256: removing.sha256,
                  });
                  setRemoving(null);
                  await loadSettings();
                  await loadDiscovery("skills");
                })
              }
            >
              卸载
            </button>
          </div>
        </Modal>
      )}
      <div className="skill-catalog">
        {settings?.skills
          .filter((skill: Skill) => !skill.pluginId)
          .filter(
            (skill: Skill) =>
              (!scope || skill.scope === scope) &&
              `${displayName(skill)} ${skill.name} ${skill.description}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((skill: Skill) => (
            <div className="skill-list-row compact-skill-entry" key={skill.id}>
              {readable ? (
                <button
                  type="button"
                  className="catalog-entry-main"
                  aria-label={`查看 ${skill.name} 说明`}
                  disabled={!readable}
                  ref={(node) => {
                    if (node) entries.current.set(skill.id, node);
                    else entries.current.delete(skill.id);
                  }}
                  onClick={() => setSelected(skill)}
                >
                  <CatalogIcon name={skill.name} />
                  <span>
                    <strong>{displayName(skill)}</strong>
                    <small>
                      {skill.interface?.shortDescription ||
                        skill.shortDescription ||
                        skill.description}
                    </small>
                  </span>
                </button>
              ) : (
                <div className="catalog-entry-main">
                  <CatalogIcon name={skill.name} />
                  <span>
                    <strong>{displayName(skill)}</strong>
                    <small>
                      {skill.interface?.shortDescription ||
                        skill.shortDescription ||
                        skill.description}
                    </small>
                  </span>
                </div>
              )}
              <div className="skill-entry-controls">
                <button
                  type="button"
                  className="icon-button skill-remove"
                  data-variant="destructive"
                  aria-label={`卸载 ${skill.name}`}
                  title={
                    skill.removable
                      ? "卸载"
                      : skill.removalReason || "此来源不支持卸载"
                  }
                  disabled={!!busy || !readable || !skill.removable}
                  onClick={() =>
                    void action(skill.id, async () => {
                      setRemoving(
                        await readSkill(skill.id, new AbortController().signal),
                      );
                    })
                  }
                >
                  <Trash2 size={17} />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  aria-label={`${skill.enabled ? "停用" : "启用"} ${skill.name}`}
                  className={`switch ${skill.enabled ? "on" : ""}`}
                  disabled={!!busy}
                  onClick={() =>
                    void action(skill.path, async () => {
                      await request("skills/config/write", {
                        path: skill.path,
                        enabled: !skill.enabled,
                      });
                      await loadSettings();
                      await loadDiscovery("skills");
                    })
                  }
                >
                  <span />
                </button>
              </div>
            </div>
          ))}
      </div>
      {!!settings?.skills.length &&
        !settings.skills.some(
          (skill: Skill) =>
            (!scope || skill.scope === scope) &&
            `${displayName(skill)} ${skill.name} ${skill.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ) && <p className="muted">没有匹配的技能</p>}
    </div>
  );
}
