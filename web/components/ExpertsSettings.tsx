import { CatalogToolbar } from "./CatalogToolbar";
import { useEffect, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Pencil,
  Trash2,
  UsersRound,
  Eye,
} from "lucide-react";
import type {
  Expert,
  ExpertMembers,
  ExpertReference,
} from "../../shared/experts";
import { request } from "../store";
import { Modal } from "./ui";
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
};
const empty = (): Draft => ({
  name: "",
  description: "",
  skillIds: [],
  pluginIds: [],
  connectorIds: [],
});
export default function ExpertsSettings() {
  const [data, setData] = useState<ExpertCatalog | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null),
    [memberQuery, setMemberQuery] = useState(""),
    [formError, setFormError] = useState(""),
    [detail, setDetail] = useState<ExpertReference | null>(null),
    [removing, setRemoving] = useState<Expert | null>(null);
  async function read() {
    setBusy(true);
    setError("");
    try {
      setData(await request("expert/list"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败，请重试");
    } finally {
      setBusy(false);
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
    setBusy(true);
    setFormError("");
    try {
      await request("expert/save", {
        id: draft.id,
        expectedRevision: draft.revision,
        name: draft.name,
        description: draft.description,
        skillIds: draft.skillIds,
        pluginIds: draft.pluginIds,
        connectorIds: draft.connectorIds,
      });
      setData(await request("expert/list"));
      setDraft(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
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
        <button
          type="button"
          className="icon-button"
          aria-label="添加专家"
          title="添加专家"
          disabled={busy || !data}
          onClick={() => edit(empty())}
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新专家"
          title="刷新专家"
          disabled={busy}
          onClick={() => void read()}
        >
          <RefreshCw size={18} className={busy ? "spin" : ""} />
        </button>
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
          <p>
            {query
              ? "没有匹配的专家"
              : "将常用扩展组合成专家，在聊天中用 @ 选择。"}
          </p>
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
            <span>
              <strong>{e.name}</strong>
              <small>
                {e.description ||
                  memberGroups
                    .filter((g) => e[g.key].length)
                    .map((g) => `${e[g.key].length} 个${g.label}`)
                    .join(" · ")}
              </small>
              {!e.available && (
                <small className="danger-text">有扩展不可用</small>
              )}
            </span>
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
      {detail && (
        <ExpertDetails value={detail} onClose={() => setDetail(null)} />
      )}
      {draft && data && (
        <Modal
          open
          title={draft.id ? "编辑专家" : "创建专家"}
          className="expert-editor"
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!open) setDraft(null);
          }}
        >
          <form
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
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !draft.name.trim() ||
                  !memberGroups.some((g) => draft[g.key].length)
                }
              >
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
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
              onClick={() => {
                setBusy(true);
                void request("expert/delete", {
                  id: removing.id,
                  expectedRevision: removing.revision,
                })
                  .then(async () => {
                    setRemoving(null);
                    await read();
                  })
                  .catch((e) => setFormError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              删除
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
