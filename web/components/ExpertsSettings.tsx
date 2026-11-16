import { CatalogAddButton } from "./CatalogAddButton";
import { useCatalogField } from "../catalog-state";
import { CatalogCopy } from "./CatalogCopy";
import { useOperationScope } from "../use-operation-scope";
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import { FormActions, FormSubmit } from "./FormActions";
import { MoreIcon as MoreHorizontal } from "./ReferenceIcons";
import { ExpertIcon as UsersRound } from "./AppIcons";
import { CatalogToolbar } from "./CatalogToolbar";
import { useEffect, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Pencil, Trash2, Eye } from "lucide-react";
import type {
  Expert,
  ExpertMembers,
  ExpertReference,
} from "../../shared/experts";
import { request } from "../store";
import { Modal } from "./ui";
import { CatalogDetail } from "./CatalogNavigation";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import ExpertDetails, {
  memberGroups,
  type ExpertCatalog,
} from "./ExpertDetails";
type Draft = ExpertMembers & {
  id?: string;
  revision?: number;
  name: string;
  description: string;
  instructions?: string;
};
const empty = (): Draft => ({
  name: "",
  description: "",
  instructions: "",
  skillIds: [],
  pluginIds: [],
  connectorIds: [],
});
export default function ExpertsSettings() {
  const [data, setData] = useState<ExpertCatalog | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useCatalogField("experts", "query");
  const [draft, setDraft] = useState<Draft | null>(null),
    [memberQuery, setMemberQuery] = useState(""),
    [formError, setFormError] = useState(""),
    [detail, setDetail] = useState<ExpertReference | null>(null),
    [removing, setRemoving] = useState<Expert | null>(null);
  const scope = useOperationScope();
  const busy = !!scope.busy;
  async function read() {
    const task = scope.start("read", "list");
    if (!task) return;
    setError("");
    try {
      const result = await request<ExpertCatalog>(
        "expert/list",
        {},
        { signal: task.signal },
      );
      if (task.isCurrent()) setData(result);
    } catch (e) {
      if (task.isCurrent())
        setError(e instanceof Error ? e.message : "读取失败，请重试");
    } finally {
      task.finish();
    }
  }
  useEffect(() => {
    void read();
  }, []);
  function edit(value: Draft) {
    setDraft({ ...value });
    setMemberQuery("");
    setFormError("");
  }
  async function save() {
    if (!draft) return;
    const task = scope.start("write", "save");
    if (!task) return;
    setFormError("");
    setError("");
    let committed = false;
    try {
      await request("expert/save", {
        id: draft.id,
        expectedRevision: draft.revision,
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions || "",
        skillIds: draft.skillIds,
        pluginIds: draft.pluginIds,
        connectorIds: draft.connectorIds,
      });
      committed = true;
      if (!task.isCurrent()) return;
      setDraft(null);
      const result = await request<ExpertCatalog>("expert/list");
      if (task.isCurrent()) setData(result);
    } catch (e) {
      if (!task.isCurrent()) return;
      if (committed) setError("专家已保存，目录读取失败。请刷新查看最新状态。");
      else setFormError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      task.finish();
    }
  }
  async function removeExpert() {
    if (!removing) return;
    const task = scope.start("write", "delete");
    if (!task) return;
    setFormError("");
    setError("");
    let committed = false;
    try {
      await request("expert/delete", {
        id: removing.id,
        expectedRevision: removing.revision,
      });
      committed = true;
      if (!task.isCurrent()) return;
      setRemoving(null);
      const result = await request<ExpertCatalog>("expert/list");
      if (task.isCurrent()) setData(result);
    } catch (e) {
      if (!task.isCurrent()) return;
      if (committed) setError("专家已删除，目录读取失败。请刷新查看最新状态。");
      else setFormError(e instanceof Error ? e.message : "删除失败，请重试");
    } finally {
      task.finish();
    }
  }
  const matches =
    data?.entries.filter((e) =>
      `${e.name} ${e.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ) || [];
  return (
    <section className="experts-settings" aria-label="专家管理">
      <CatalogToolbar label="专家" query={query} onQuery={setQuery}>
        <CatalogAddButton
          type="button"
          label="添加专家"
          disabled={busy || !data}
          onClick={() => edit(empty())}
        />
        <CatalogRefreshButton
          label="刷新专家"
          busy={busy}
          onClick={() => void read()}
        />
      </CatalogToolbar>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!data && busy && (
        <p role="status" className="muted">
          正在读取专家…
        </p>
      )}
      {data && !matches.length && (
        <div className="extension-empty">
          <UsersRound size={24} aria-hidden="true" />
          <p>{query ? "没有匹配的专家" : "尚未创建专家"}</p>
          {!query && (
            <button
              type="button"
              className="secondary"
              onClick={() => edit(empty())}
            >
              创建专家
            </button>
          )}
        </div>
      )}
      <div className="catalog-grid">
        {matches.map((e) => (
          <div className="catalog-entry expert-entry" key={e.id}>
            <button
              type="button"
              className="catalog-entry-main"
              onClick={() => setDetail(e)}
              aria-label={`查看专家 ${e.name}`}
            >
              <span className="expert-icon">
                <UsersRound size={22} aria-hidden="true" />
              </span>
              <CatalogCopy
                name={e.name}
                description={
                  e.description ||
                  memberGroups
                    .filter((g) => e[g.key].length)
                    .map((g) => `${e[g.key].length} 个${g.label}`)
                    .join(" · ")
                }
                status={
                  !e.available ? (
                    <span className="danger-text">有扩展不可用</span>
                  ) : undefined
                }
              />
            </button>
            <Dropdown.Root>
              <Dropdown.Trigger
                className="icon-button catalog-more"
                aria-label={`${e.name} 更多操作`}
                title="更多操作"
                disabled={busy}
              >
                <MoreHorizontal size={20} />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <ActionMenuContent
                  className="dropdown"
                  align="end"
                  sideOffset={5}
                >
                  <ActionMenuItem icon={Eye} onSelect={() => setDetail(e)}>
                    详情
                  </ActionMenuItem>
                  <ActionMenuItem icon={Pencil} onSelect={() => edit(e)}>
                    编辑
                  </ActionMenuItem>
                  <ActionMenuItem
                    icon={Trash2}
                    destructive
                    separated
                    onSelect={() => {
                      setFormError("");
                      setRemoving(e);
                    }}
                  >
                    删除
                  </ActionMenuItem>
                </ActionMenuContent>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        ))}
      </div>
      {detail && (
        <ExpertDetails value={detail} onClose={() => setDetail(null)} />
      )}
      {draft && data && (
        <CatalogDetail
          open
          title={draft.id ? "编辑专家" : "创建专家"}
          className="expert-editor catalog-form-step"
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setDraft(null);
          }}
        >
          <form
            className="catalog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              名称
              <input
                data-autofocus
                value={draft.name}
                maxLength={80}
                required
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              简介
              <textarea
                value={draft.description}
                maxLength={500}
                rows={2}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            <label>
              提示词
              <textarea
                value={draft.instructions || ""}
                maxLength={20000}
                rows={5}
                placeholder="这个专家应该如何回答、使用哪些方法…"
                onChange={(e) =>
                  setDraft({ ...draft, instructions: e.target.value })
                }
              />
            </label>
            <input
              type="search"
              aria-label="搜索专家成员"
              placeholder="搜索技能、插件或连接器"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
            />
            <div className="expert-member-picker">
              {memberGroups.map((g) => {
                const entries = [
                  ...data.catalog[g.catalog],
                  ...draft[g.key]
                    .filter(
                      (id) => !data.catalog[g.catalog].some((x) => x.id === id),
                    )
                    .map((id) => ({
                      id,
                      name: "已移除的扩展",
                      enabled: false,
                    })),
                ].filter((m) =>
                  m.name.toLowerCase().includes(memberQuery.toLowerCase()),
                );
                return (
                  <fieldset key={g.key}>
                    <legend>
                      {g.label}
                      <span>
                        {draft[g.key].length} / {g.max}
                      </span>
                    </legend>
                    {entries.length ? (
                      entries.map((m) => {
                        const checked = draft[g.key].includes(m.id);
                        return (
                          <label key={m.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                busy ||
                                (!checked &&
                                  (!m.enabled || draft[g.key].length >= g.max))
                              }
                              onChange={() =>
                                setDraft({
                                  ...draft,
                                  [g.key]: checked
                                    ? draft[g.key].filter((id) => id !== m.id)
                                    : [...draft[g.key], m.id],
                                })
                              }
                            />
                            <span>{m.name}</span>
                            {!m.enabled && <small>不可用</small>}
                          </label>
                        );
                      })
                    ) : (
                      <p className="muted">
                        {memberQuery ? "没有匹配的结果" : `暂无${g.label}`}
                      </p>
                    )}
                  </fieldset>
                );
              })}
            </div>
            {formError && (
              <p role="alert" className="inline-error">
                {formError}
              </p>
            )}
            <FormActions layout="modal">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <FormSubmit
                busy={busy}
                busyLabel="保存中…"
                disabled={
                  !draft.name.trim() ||
                  (!draft.instructions?.trim() &&
                    !memberGroups.some((g) => draft[g.key].length))
                }
              >
                保存
              </FormSubmit>
            </FormActions>
          </form>
        </CatalogDetail>
      )}
      {removing && (
        <Modal
          open
          title={`删除“${removing.name}”？`}
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        >
          <p>引用它的会话需要重新选择专家。成员扩展仍会保留。</p>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              取消
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={() => void removeExpert()}
            >
              删除
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
