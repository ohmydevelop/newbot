import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SearchIcon } from "./ReferenceIcons";
import { AutomationIdentity } from "./AutomationIdentity";
import { initialSchedule } from "./AutomationEditor";
import {
  automationCategories,
  automationTemplates,
} from "../automation-templates";
import {
  eventSourceLabels,
  scheduleLabel,
  type Automation,
  type AutomationInput,
} from "../../shared/automations";
export function AutomationCatalog({
  tasks,
  loaded,
  query,
  onQuery,
  category,
  onCategory,
  filter,
  onFilter,
  onSelect,
  onCreate,
  menu,
}: {
  tasks: Automation[];
  loaded: boolean;
  query: string;
  onQuery: (v: string) => void;
  category: string;
  onCategory: (v: string) => void;
  filter: string;
  onFilter: (v: "all" | "active" | "paused") => void;
  onSelect: (id: string, el: HTMLButtonElement) => void;
  onCreate: (initial?: Partial<AutomationInput>) => void;
  menu: (t: Automation) => ReactNode;
}) {
  const match = (text: string) =>
    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const rows = tasks.filter(
    (t) =>
      match(t.name + " " + t.prompt) &&
      (filter === "all" || (filter === "active" ? t.enabled : !t.enabled)),
  );
  const templates = automationTemplates.filter(
    (t) =>
      match(t.name + " " + t.description) &&
      (category === "全部" || category === t.category),
  );
  const groups =
    category === "全部"
      ? ["推荐", ...automationCategories.slice(1)]
      : [category];
  return (
    <>
      <div className="automation-heading automation-catalog-heading">
        <h1 id="automations-heading" tabIndex={-1}>
          自动任务
        </h1>
        <div className="catalog-query">
          <SearchIcon size={17} />
          <input
            type="search"
            className="catalog-search"
            aria-label="搜索自动任务"
            placeholder="搜索自动任务"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="新建任务"
          title="新建任务"
          onClick={() => onCreate()}
        >
          <Plus size={18} />
        </button>
      </div>
      {tasks.length > 0 && (
        <section aria-label="我的自动任务" className="automation-owned">
          <div className="automation-section-heading">
            <h2>我的任务</h2>
            <div
              className="automation-tabs"
              role="group"
              aria-label="筛选自动任务"
            >
              {(["all", "active", "paused"] as const).map((v, i) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={filter === v}
                  onClick={() => onFilter(v)}
                >
                  {["全部", "已启用", "已暂停"][i]}
                </button>
              ))}
            </div>
          </div>
          <div className="automation-grid">
            {rows.map((t) => (
              <div className="automation-row" key={t.id}>
                <AutomationIdentity icon={t.icon} color={t.color} />
                <button
                  type="button"
                  className="automation-row-copy"
                  data-task-id={t.id}
                  onClick={(e) => onSelect(t.id, e.currentTarget)}
                >
                  <strong>
                    {t.name}
                    {t.unread > 0 && (
                      <span
                        className="automation-unread"
                        aria-label={`${t.unread} 个未读结果`}
                      />
                    )}
                  </strong>
                  <small
                    title={[
                      ...t.triggers.map(scheduleLabel),
                      ...(t.eventTriggers || []).map(
                        (e) => eventSourceLabels[e.source],
                      ),
                    ].join(" · ")}
                  >
                    {t.activeRuns
                      ? "正在运行或等待处理"
                      : [
                          ...t.triggers.map(scheduleLabel),
                          ...(t.eventTriggers || []).map(
                            (e) => eventSourceLabels[e.source],
                          ),
                        ].join(" · ")}
                  </small>
                </button>
                {!t.enabled && (
                  <span className="automation-row-status">已暂停</span>
                )}
                {menu(t)}
              </div>
            ))}
          </div>
          {!rows.length && <p className="automation-empty">没有匹配的任务</p>}
        </section>
      )}
      <div
        className="automation-categories"
        role="group"
        aria-label="任务模板分类"
      >
        {automationCategories.map((c) => (
          <button
            type="button"
            key={c}
            aria-pressed={category === c}
            onClick={() => onCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {!loaded && (
        <p role="status" className="muted">
          正在读取…
        </p>
      )}
      <section className="automation-templates" aria-label="任务模板">
        {groups.map((group) => {
          const entries = templates.filter((t) =>
            group === "推荐"
              ? t.featured
              : (!t.featured || category !== "全部") && t.category === group,
          );
          const custom = group === "推荐" && !query.trim();
          if (!entries.length && !custom) return null;
          return (
            <section key={group}>
              <h2>{group}</h2>
              <div className="automation-grid">
                {custom && (
                  <div className="automation-row">
                    <span className="automation-identity catalog-mark">
                      <Plus size={18} />
                    </span>
                    <button
                      type="button"
                      className="automation-row-copy"
                      onClick={() => onCreate()}
                    >
                      <strong>自定义</strong>
                      <small>从头创建自动任务</small>
                    </button>
                    <button
                      type="button"
                      className="automation-template-add"
                      aria-label="添加自定义任务"
                      onClick={() => onCreate()}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
                {entries.map((t) => {
                  const create = () =>
                    onCreate({
                      name: t.name,
                      prompt: t.prompt,
                      icon: t.icon,
                      triggers: [
                        {
                          ...initialSchedule(),
                          frequency: t.frequency,
                          weekdays: [5],
                        },
                      ],
                    });
                  return (
                    <div className="automation-row" key={t.name}>
                      <AutomationIdentity icon={t.icon} />
                      <button
                        type="button"
                        className="automation-row-copy"
                        onClick={create}
                      >
                        <strong>{t.name}</strong>
                        <small title={t.description}>{t.description}</small>
                      </button>
                      <button
                        type="button"
                        className="automation-template-add"
                        aria-label={`添加${t.name}`}
                        onClick={create}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!templates.length && query.trim() && (
          <p className="automation-empty">没有匹配的模板</p>
        )}
      </section>
    </>
  );
}
