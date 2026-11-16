import { CatalogCopy } from "./CatalogCopy";
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import SkillCreate from "./SkillCreate";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import { visibleCatalogSkills } from "../skill-catalog";
import { SkillIcon as BookOpen } from "./AppIcons";
import SkillImport from "./SkillImport";
import { CatalogToolbar } from "./CatalogToolbar";
import { useRef, useState, useEffect } from "react";
import { Trash2, Plus, Check, ChevronDown, Upload } from "lucide-react";
import type { Skill, SkillDocument } from "../../shared/types";
import { loadSettings, loadDiscovery, request, useApp } from "../store";
import {
  skillScopes as scopes,
  skillLabel as displayName,
} from "../../shared/skills";
import SkillReader from "./SkillReader";
import CatalogIcon from "./CatalogIcon";
import { CatalogDetail, CatalogUse } from "./CatalogNavigation";
import { Modal } from "./ui";
import { readSkill } from "../skills";
export default function SkillsSettings({ scope = "" }: { scope?: string }) {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    void loadDiscovery("skills");
  }, []);
  const readable = useApp((s) => s.skillDocuments);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<SkillDocument | null>(null);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const entries = useRef(new Map<string, HTMLButtonElement>());
  const refresh = useRef<HTMLButtonElement>(null);
  const visibleSkills = visibleCatalogSkills(
    settings?.skills || [],
    query,
    scope,
  );
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
  function controls(skill: Skill) {
    return (
      <div className="skill-detail-actions">
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() =>
            void action(skill.id, async () => {
              await request("skills/config/write", {
                path: skill.path,
                enabled: !skill.enabled,
              });
              await loadSettings();
              await loadDiscovery("skills");
              setSelected((current) =>
                current?.id === skill.id
                  ? { ...current, enabled: !skill.enabled }
                  : current,
              );
            })
          }
        >
          {skill.enabled ? "停用" : "启用"}
        </button>
        {skill.removable && (
          <button
            className="secondary danger-text"
            disabled={!!busy || !readable}
            onClick={() =>
              void action(skill.id, async () => {
                setRemoving(
                  await readSkill(skill.id, new AbortController().signal),
                );
              })
            }
          >
            <Trash2 size={16} />
            卸载
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="skills-settings">
      {creating && <SkillCreate onClose={() => setCreating(false)} />}
      {selected && readable && (
        <CatalogDetail
          open
          title={displayName(selected)}
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <SkillReader skill={selected} onBack={() => setSelected(null)} />
          <CatalogUse
            kind="$"
            entry={{ ...selected, displayName: displayName(selected) }}
            disabled={!selected.enabled || !!busy}
          />
          {controls(selected)}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </CatalogDetail>
      )}
      <CatalogToolbar label="技能" query={query} onQuery={setQuery}>
        <Dropdown.Root>
          <Dropdown.Trigger
            className="primary catalog-add"
            aria-label="添加技能"
          >
            新技能 <ChevronDown size={14} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <ActionMenuContent className="dropdown" align="end" sideOffset={6}>
              <ActionMenuItem
                icon={BookOpen}
                onSelect={() => setCreating(true)}
              >
                编写技能
              </ActionMenuItem>
              <ActionMenuItem icon={Upload} onSelect={() => setImporting(true)}>
                导入技能
              </ActionMenuItem>
            </ActionMenuContent>
          </Dropdown.Portal>
        </Dropdown.Root>
        <CatalogRefreshButton
          ref={refresh}
          label="刷新技能"
          iconSize={17}
          busy={busy === "refresh"}
          disabled={!!busy}
          onClick={() => void action("refresh", () => loadDiscovery("skills"))}
        />
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
      {!visibleSkills.length && !discoveryFailed && (
        <div className="empty-settings">
          <BookOpen size={28} aria-hidden="true" />
          <strong>{query || scope ? "没有匹配的技能" : "暂无独立技能"}</strong>
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
                  setSelected(null);
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
        {visibleSkills.map((skill: Skill) => (
          <div className="skill-list-row compact-skill-entry" key={skill.id}>
            {readable ? (
              <button
                type="button"
                className="catalog-entry-main"
                aria-label={`查看 ${displayName(skill)} 说明`}
                disabled={!readable}
                ref={(node) => {
                  if (node) entries.current.set(skill.id, node);
                  else entries.current.delete(skill.id);
                }}
                onClick={() => setSelected(skill)}
              >
                <CatalogIcon name={skill.name} />
                <CatalogCopy
                  name={displayName(skill)}
                  description={
                    skill.interface?.shortDescription ||
                    skill.shortDescription ||
                    skill.description
                  }
                  status={
                    skill.enabled ? (
                      <>
                        <Check size={14} /> 已启用
                      </>
                    ) : (
                      "已停用"
                    )
                  }
                />
              </button>
            ) : (
              <div className="catalog-entry-main">
                <CatalogIcon name={skill.name} />
                <CatalogCopy
                  name={displayName(skill)}
                  description={
                    skill.interface?.shortDescription ||
                    skill.shortDescription ||
                    skill.description
                  }
                  status={
                    skill.enabled ? (
                      <>
                        <Check size={14} /> 已启用
                      </>
                    ) : (
                      "已停用"
                    )
                  }
                />
              </div>
            )}
            {!readable && controls(skill)}
          </div>
        ))}
      </div>
    </div>
  );
}
