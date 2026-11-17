import { SubscriptionConnection } from "./AutomationSubscriptionFields";
import { PluginIcon } from "./AppIcons";
import * as Popover from "@radix-ui/react-popover";
import { PickerContent } from "./Picker";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  Pencil,
  Trash2,
  RefreshCw,
  Bell,
  Check,
  Clock3,
  MessageSquare,
  Square,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MoreIcon } from "./ReferenceIcons";
import { SidebarIcon } from "./SidebarIcon";
import { ActionMenuContent, ActionMenuItem } from "./ActionMenu";
import { Modal } from "./ui";
import AutomationMailSettings from "./AutomationMailSettings";
import AutomationEditor from "./AutomationEditor";
import { AutomationCatalog } from "./AutomationCatalog";
import { automationRequest, useAutomations } from "../automations";
import {
  eventSourceLabels,
  scheduleLabel,
  notificationLabels,
  deliveryLabels,
  runStateLabels,
  type Automation,
  type AutomationInput,
  type AutomationRun,
} from "../../shared/automations";
import { modeLabels } from "../../shared/runtime-settings";
import { absoluteTime } from "../time";
export default function Automations({
  open,
  data,
  onOpenChat,
  onSidebar,
  sidebarOpen,
  chatDraft,
}: {
  open: boolean;
  data: ReturnType<typeof useAutomations>;
  onOpenChat: (id: string) => void;
  onSidebar: () => void;
  sidebarOpen: boolean;
  chatDraft?: Partial<AutomationInput>;
}) {
  const panelId = useId();
  const [category, setCategory] = useState("全部");
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const lastTask = useRef<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [older, setOlder] = useState<AutomationRun[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null | undefined>(
      undefined,
    );
  const currentSelection = useRef<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const runRequests = useRef(new Map<string, string>());
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<{
      task: Automation;
      runs: AutomationRun[];
      nextCursor: string | null;
    } | null>(null),
    [tab, setTab] = useState<"overview" | "runs">("overview"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"all" | "active" | "paused">("all"),
    [editor, setEditor] = useState<{
      task?: Automation;
      initial?: Partial<AutomationInput>;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Automation | null>(null),
    [notice, setNotice] = useState("");
  const [browserNotify, setBrowserNotify] = useState(
    () =>
      localStorage.getItem("newbot:automation-browser-notifications") === "1",
  );
  const posting = useRef(false),
    detailTitle = useRef<HTMLHeadingElement>(null),
    listFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!selected || !open) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await automationRequest(
          "/" + selected,
          undefined,
          c.signal,
        );
        if (!c.signal.aborted) setDetail(value);
      } catch (e) {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        if (!c.signal.aborted) timer = setTimeout(read, 5000);
      }
    }
    void read();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [selected, open, detailVersion]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("automation");
    if (!id || !open) return;
    const abort = new AbortController();
    void automationRequest<AutomationRun>(
      "/result/" + encodeURIComponent(id),
      undefined,
      abort.signal,
    )
      .then((run) => {
        if (abort.signal.aborted) return;
        if (run.threadId) onOpenChat(run.threadId);
        else {
          currentSelection.current = run.taskId;
          setSelected(run.taskId);
          setTab("runs");
        }
        const url = new URL(location.href);
        url.searchParams.delete("automation");
        history.replaceState(null, "", url);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById("automations-heading")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  function select(id: string, target?: HTMLButtonElement) {
    listFocus.current = target || null;
    lastTask.current = id;
    listPosition.current = scroll.current?.scrollTop || 0;
    currentSelection.current = id;
    setOlder([]);
    setHistoryCursor(undefined);
    setDetail(null);
    setSelected(id);
    setTab("overview");
    setError("");
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = 0;
      detailTitle.current?.focus({ preventScroll: true });
    });
  }
  function back() {
    currentSelection.current = null;
    setOlder([]);
    setHistoryCursor(undefined);
    setSelected(null);
    setError("");
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = listPosition.current;
      const target = lastTask.current
        ? document.querySelector<HTMLButtonElement>(
            `[data-task-id="${lastTask.current}"]`,
          )
        : listFocus.current;
      target?.focus({ preventScroll: true });
    });
  }
  async function act(fn: () => Promise<unknown>) {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      data.refresh();
      setDetailVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  async function run(task: Automation) {
    await act(async () => {
      await automationRequest("/run", {
        id: task.id,
        revision: task.revision,
        requestId:
          runRequests.current.get(task.id) ||
          (() => {
            const id = crypto.randomUUID();
            runRequests.current.set(task.id, id);
            return id;
          })(),
      });
      runRequests.current.delete(task.id);
      if (selected !== task.id) select(task.id);
      setTab("runs");
    });
  }
  async function control(
    task: Automation,
    action: "pause" | "resume" | "delete",
  ) {
    await act(async () => {
      await automationRequest("/control", {
        id: task.id,
        revision: task.revision,
        action,
      });
      if (action === "delete") {
        setRemove(null);
        back();
      }
    });
  }
  async function openRun(run: AutomationRun) {
    if (!run.threadId) return;
    await act(async () => {
      await automationRequest("/read", { id: run.id });
      onOpenChat(run.threadId!);
    });
  }
  const task = detail?.task;
  const menu = (t: Automation) => (
    <Dropdown.Root>
      <Dropdown.Trigger
        type="button"
        className="icon-button"
        aria-label={`更多操作：${t.name}`}
        disabled={busy}
      >
        <MoreIcon size={18} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <ActionMenuContent>
          <ActionMenuItem
            icon={Play}
            disabled={!!t.activeRuns}
            onSelect={() => void run(t)}
          >
            立即运行
          </ActionMenuItem>
          <ActionMenuItem icon={Pencil} onSelect={() => setEditor({ task: t })}>
            编辑
          </ActionMenuItem>
          <ActionMenuItem
            icon={t.enabled ? Pause : Play}
            onSelect={() => void control(t, t.enabled ? "pause" : "resume")}
          >
            {t.enabled ? "暂停" : "恢复"}
          </ActionMenuItem>
          <ActionMenuItem
            icon={Trash2}
            separated
            destructive
            onSelect={() => setRemove(t)}
          >
            删除
          </ActionMenuItem>
        </ActionMenuContent>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
  return (
    <main
      className="main automation-page"
      hidden={!open}
      inert={!open}
      aria-label="自动任务工作区"
    >
      <header className="topbar" hidden={!!editor}>
        <div className="topbar-left">
          {!sidebarOpen && (
            <button
              type="button"
              className="icon-button expand-sidebar"
              aria-label="展开侧栏"
              onClick={onSidebar}
            >
              <SidebarIcon size={18} />
            </button>
          )}
          <span className="muted">
            {editor ? "编辑任务" : selected ? "任务详情" : ""}
          </span>
        </div>
        <div className="topbar-right">
          <Popover.Root>
            <Popover.Trigger
              type="button"
              className="icon-button"
              aria-label={`任务通知 ${data.notices.length}`}
            >
              <Bell size={18} />
              {data.notices.length > 0 && (
                <span className="automation-unread" />
              )}
            </Popover.Trigger>
            <PickerContent className="automation-notices" align="end">
              <h3>任务通知</h3>
              {data.notices.length ? (
                data.notices.map((n) => (
                  <button
                    type="button"
                    className="automation-notice"
                    key={n.id}
                    onClick={() =>
                      void act(async () => {
                        await automationRequest("/read", { id: n.id });
                        if (n.threadId) onOpenChat(n.threadId);
                        else {
                          setNotice(n.error || runStateLabels[n.state]);
                          if (data.tasks.some((t) => t.id === n.taskId))
                            select(n.taskId);
                        }
                      })
                    }
                  >
                    <strong>{n.name}</strong>
                    <small>
                      {runStateLabels[n.state]} ·{" "}
                      {absoluteTime(n.completed || n.scheduledAt)}
                    </small>
                  </button>
                ))
              ) : (
                <p className="picker-note">暂无未读通知</p>
              )}
            </PickerContent>
          </Popover.Root>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新自动任务"
            onClick={data.refresh}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>
      <div
        className="automation-scroll"
        ref={scroll}
        hidden={!!editor}
        inert={!!editor}
      >
        <div className="automation-content">
          {selected ? (
            <>
              <div className="automation-heading">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="返回自动任务"
                  onClick={back}
                >
                  <ArrowLeft size={19} />
                </button>
                <h1 id="automations-heading" tabIndex={-1} ref={detailTitle}>
                  {task?.name || "自动任务"}
                </h1>
                {task && menu(task)}
              </div>
              <div
                className="automation-tabs"
                role="tablist"
                aria-label="任务详情"
                onKeyDown={(event) => {
                  let next: "overview" | "runs";
                  if (event.key === "Home") next = "overview";
                  else if (event.key === "End") next = "runs";
                  else if (["ArrowLeft", "ArrowRight"].includes(event.key))
                    next = tab === "overview" ? "runs" : "overview";
                  else return;
                  event.preventDefault();
                  setTab(next);
                  document.getElementById(panelId + "-" + next)?.focus();
                }}
              >
                <button
                  type="button"
                  role="tab"
                  id={panelId + "-overview"}
                  aria-controls={panelId}
                  tabIndex={tab === "overview" ? 0 : -1}
                  aria-selected={tab === "overview"}
                  onClick={() => setTab("overview")}
                >
                  概览
                </button>
                <button
                  type="button"
                  role="tab"
                  id={panelId + "-runs"}
                  aria-controls={panelId}
                  tabIndex={tab === "runs" ? 0 : -1}
                  aria-selected={tab === "runs"}
                  onClick={() => setTab("runs")}
                >
                  运行记录
                </button>
              </div>
              {!detail && !error && (
                <p role="status" className="muted">
                  正在读取…
                </p>
              )}
              {task && tab === "overview" && (
                <section
                  className="automation-overview"
                  role="tabpanel"
                  id={panelId}
                  aria-labelledby={panelId + "-overview"}
                  tabIndex={0}
                >
                  <div className="automation-detail-actions">
                    <span className="muted">
                      {task.enabled ? "已启用" : "已暂停"}
                    </span>
                    {task.threadId && (
                      <button
                        type="button"
                        className="secondary automation-detail-secondary"
                        aria-label="任务会话"
                        title="任务会话"
                        onClick={() => onOpenChat(task.threadId!)}
                      >
                        <MessageSquare size={16} />
                        <span>任务会话</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary automation-detail-secondary"
                      aria-label="编辑"
                      title="编辑"
                      disabled={busy}
                      onClick={() => setEditor({ task })}
                    >
                      <Pencil size={16} />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || !!task.activeRuns}
                      onClick={() => void run(task)}
                    >
                      <Play size={16} />
                      立即运行
                    </button>
                  </div>
                  <section>
                    <h2>触发器</h2>
                    {task.triggers.map((t) => (
                      <div className="automation-trigger-summary" key={t.id}>
                        <Clock3 size={18} />
                        <span>
                          {scheduleLabel(t)}
                          <small>{t.timezone}</small>
                        </span>
                      </div>
                    ))}
                    {(task.eventTriggers || []).map((t) => (
                      <div className="automation-trigger-summary" key={t.id}>
                        <PluginIcon size={18} />
                        <span>
                          {eventSourceLabels[t.source]}
                          <small>{t.events.join(", ")}</small>
                        </span>
                        <SubscriptionConnection task={task} trigger={t} />
                      </div>
                    ))}
                    <p className="muted">
                      {task.nextRun
                        ? `下次运行 ${absoluteTime(task.nextRun)}`
                        : task.enabled
                          ? task.eventTriggers?.length
                            ? "等待事件触发"
                            : "计划已执行完毕"
                          : "计划已暂停"}
                    </p>
                  </section>
                  <section>
                    <h2>指令</h2>
                    <p className="automation-instructions">{task.prompt}</p>
                    <div className="automation-summary-line">
                      <span>{modeLabels[task.mode]}</span>
                      <span>{task.model || "默认模型"}</span>
                      {task.plugins.length > 0 && (
                        <span>{task.plugins.length} 个连接器</span>
                      )}
                      {task.skills.length > 0 && (
                        <span>{task.skills.length} 个技能</span>
                      )}
                      {task.expertId && <span>已选择专家</span>}
                      {task.attachments.length > 0 && (
                        <span>{task.attachments.length} 个附件</span>
                      )}
                    </div>
                  </section>
                  <section>
                    <h2>通知</h2>
                    <p>{notificationLabels[task.notification]}</p>
                  </section>
                </section>
              )}
              {detail && tab === "runs" && (
                <section
                  className="automation-runs"
                  role="tabpanel"
                  id={panelId}
                  aria-labelledby={panelId + "-runs"}
                  tabIndex={0}
                >
                  {(historyCursor === undefined
                    ? detail.nextCursor
                    : historyCursor) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const id = selected;
                          const page = await automationRequest(
                            "/" +
                              id +
                              "?cursor=" +
                              (historyCursor === undefined
                                ? detail.nextCursor
                                : historyCursor),
                          );
                          if (currentSelection.current !== id) return;
                          setOlder((v) => [...v, ...page.runs]);
                          setHistoryCursor(page.nextCursor);
                        })
                      }
                    >
                      加载更早记录
                    </button>
                  )}
                  {!detail.runs.length && (
                    <p className="automation-empty">还没有运行记录</p>
                  )}
                  {[
                    ...detail.runs,
                    ...older.filter(
                      (r) => !detail.runs.some((v) => v.id === r.id),
                    ),
                  ].map((r) => (
                    <div className="automation-run" key={r.id}>
                      <div className="automation-run-icon">
                        {r.state === "succeeded" ? (
                          <Check size={19} />
                        ) : (
                          <Clock3
                            size={19}
                            className={
                              ["running", "dispatching"].includes(r.state)
                                ? "spin"
                                : ""
                            }
                          />
                        )}
                      </div>
                      <div className="automation-run-copy">
                        <button
                          type="button"
                          disabled={!r.threadId || busy}
                          onClick={() => void openRun(r)}
                        >
                          {runStateLabels[r.state] || r.state}
                        </button>
                        <small>{absoluteTime(r.scheduledAt)}</small>
                        {r.error && <p role="status">{r.error}</p>}
                        {r.delivery && (
                          <div className="automation-delivery">
                            <span>{deliveryLabels[r.delivery.state]}</span>
                            {r.delivery.error && <p>{r.delivery.error}</p>}
                            {["failed", "unknown"].includes(
                              r.delivery.state,
                            ) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await automationRequest("/mail/retry", {
                                      id: r.id,
                                    });
                                  })
                                }
                              >
                                仅重发邮件
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {["queued", "running", "waiting", "dispatching"].includes(
                        r.state,
                      ) && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="停止自动任务"
                          disabled={busy || r.state === "dispatching"}
                          onClick={() =>
                            void act(() =>
                              automationRequest("/stop", { id: r.id }),
                            )
                          }
                        >
                          <Square size={17} />
                        </button>
                      )}
                      {r.threadId && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => void openRun(r)}
                        >
                          打开会话
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <>
              <AutomationCatalog
                tasks={data.tasks}
                loaded={data.loaded}
                query={query}
                onQuery={setQuery}
                category={category}
                onCategory={setCategory}
                filter={filter}
                onFilter={setFilter}
                onSelect={select}
                onCreate={(initial) => setEditor({ initial })}
                menu={menu}
              />
              {chatDraft?.prompt && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditor({ initial: chatDraft })}
                >
                  从当前聊天创建
                </button>
              )}
              <div className="automation-notification-setting">
                <button onClick={() => setMailOpen(true)}>邮件通知设置</button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (browserNotify) {
                      localStorage.setItem(
                        "newbot:automation-browser-notifications",
                        "0",
                      );
                      setBrowserNotify(false);
                      setNotice("已关闭浏览器提醒，站内通知保持不变。");
                      return;
                    }
                    if (!("Notification" in window)) {
                      setNotice("此浏览器不支持桌面提醒");
                      return;
                    }
                    void Notification.requestPermission().then((p) => {
                      localStorage.setItem(
                        "newbot:automation-browser-notifications",
                        p === "granted" ? "1" : "0",
                      );
                      setBrowserNotify(p === "granted");
                      localStorage.setItem(
                        "newbot:automation-browser-since",
                        String(Date.now()),
                      );
                      setNotice(
                        p === "granted"
                          ? "已开启，网页打开时提醒；关闭后仍可在运行记录查看结果。"
                          : "浏览器未允许通知，结果仍保存在运行记录。",
                      );
                    });
                  }}
                >
                  <Bell size={16} />
                  {browserNotify ? "关闭浏览器提醒" : "开启浏览器提醒"}
                </button>
                {notice && (
                  <p role="status" className="muted">
                    {notice}
                  </p>
                )}
              </div>
            </>
          )}
          {(error || data.error) && (
            <p role="alert" className="inline-error">
              {error || data.error}
              <button type="button" onClick={data.refresh}>
                重试
              </button>
            </p>
          )}
        </div>
      </div>
      {mailOpen && (
        <AutomationMailSettings onClose={() => setMailOpen(false)} />
      )}
      {editor && (
        <AutomationEditor
          task={editor.task}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={(t) => {
            setEditor(null);
            currentSelection.current = t.id;
            setOlder([]);
            setHistoryCursor(undefined);
            setSelected(t.id);
            setDetailVersion((v) => v + 1);
            requestAnimationFrame(() =>
              detailTitle.current?.focus({ preventScroll: true }),
            );
            setDetail({
              task: t,
              runs: detail?.task.id === t.id ? detail.runs : [],
              nextCursor: detail?.task.id === t.id ? detail.nextCursor : null,
            });
            data.refresh();
          }}
        />
      )}
      <Modal
        open={!!remove}
        title="删除自动任务"
        dismissible={!busy}
        onOpenChange={(v) => {
          if (!v) setRemove(null);
        }}
      >
        <p>
          删除“{remove?.name}”？以后不会再运行，已生成的聊天会保留。
          {remove?.activeRuns ? "当前运行不会自动停止。" : ""}
        </p>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={() => setRemove(null)}>
            取消
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => remove && void control(remove, "delete")}
          >
            删除
          </button>
        </div>
      </Modal>
    </main>
  );
}
