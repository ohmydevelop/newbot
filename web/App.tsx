import { lazy, useEffect, useRef, useState, type FormEvent } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ActionMenuContent, ActionMenuItem } from "./components/ActionMenu";
import {
  ArrowUp,
  Square,
  Plus,
  Search,
  PanelLeft,
  SquarePen,
  Settings as SettingsIcon,
  ChevronDown,
  Check,
  X,
  MoreHorizontal,
  Archive,
  Pencil,
  CheckCheck,
  ArrowDown,
  Blocks,
  BookOpen,
  Terminal,
  LoaderCircle,
  ShieldCheck,
  ArrowRight,
  Paperclip,
  FolderOpen,
  AlertCircle,
  WifiOff,
} from "lucide-react";
import type { Json, Model, Thread, SkillReference } from "../shared/types";
import {
  useApp,
  connect,
  disconnect,
  request,
  loadThread,
  loadThreads,
  loadSettings,
  newChat,
  submitRun,
  clearPendingRun,
} from "./store";
import { useComposerMentions } from "./components/ComposerMentions";
import type { ComposerPanel } from "./components/Picker";
import { removeMention } from "./composer-selection";
import { useChatDrop } from "./chat-drop";
import { readSkill } from "./skills";
import RuntimeSelector from "./components/RuntimeSelector";
import type { ApprovalPreset } from "../shared/runtime-settings";
import AttachmentPreview, {
  AttachmentImage,
  type AttachmentSource,
} from "./components/AttachmentPreview";
import { Mark, Modal } from "./components/ui";
import { Sidebar } from "./components/Sidebar";
import { DeferredPanel } from "./components/DeferredPanel";
import { publishAppearance } from "./appearance";
import { chatShortcut, composerEnter, resolveTheme } from "./interaction";
import { useComposerDrafts, type DraftSnapshot } from "./composer-drafts";
import { HistoryPager } from "./components/chat/HistoryPager";
import { RenameDialog } from "./components/chat/RenameDialog";
import { useTaskStop } from "./components/chat/StopTask";
import { ChatTurn } from "./components/chat/Turn";
const Settings = lazy(() => import("./components/Settings"));
import { BackgroundNotice } from "./components/chat/BackgroundNotice";
import { ApprovalCard } from "./components/Approvals";
function Login() {
  const s = useApp();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      setPassword("");
      s.set({ authenticated: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-brand">
        <Mark size={38} />
        <span>Minimal Agent</span>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <h1>回到你的工作台</h1>
        <p>你的 Codex，你的私有空间。</p>
        <label htmlFor="password">登录密码</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? "login-error" : undefined}
        />
        {error && (
          <p id="login-error" className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <>
              继续
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
      <footer>
        <ShieldCheck size={14} /> 密码只用于访问你的私有实例
      </footer>
    </main>
  );
}
const WorkspaceFiles = lazy(() => import("./components/WorkspaceFiles"));
export default function App() {
  const s = useApp();
  const composer = useComposerDrafts(s.selectedId);
  const draft = composer.value.text,
    setDraft = composer.setText;
  const attachments = composer.value.files,
    setAttachments = composer.setFiles;
  const selectedPlugins = composer.value.plugins;
  const selectedSkills = composer.value.skills,
    setSelectedSkills = composer.setSkills;
  const sendingOrigin = useRef<object | null>(null);
  const submissionError = useRef<string | null>(null);
  const navigation = useRef(0),
    lastSubmission = useRef<{
      draft: DraftSnapshot;
      navigation: number;
      threadId: string | null;
    } | null>(null);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  useEffect(() => {
    if (search) void loadThreads().catch(() => {});
  }, [search]);
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [archiving, setArchiving] = useState<string | null>(null);
  const archivePosting = useRef(false);
  const checkingRef = useRef(false);
  const [canAbandon, setCanAbandon] = useState<string | null>(null);
  const [checkingRun, setCheckingRun] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState("");
  const [recoveredThread, setRecoveredThread] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const appleKeys = /Mac|iPhone|iPad/.test(navigator.platform);
  const scroll = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showDown, setShowDown] = useState(false);
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null);
  useEffect(() => {
    setComposerPanel(null);
    setAttachmentPreview(null);
    setWorkspacePicker(false);
  }, [s.selectedId, s.authenticated]);
  const [newApproval, setNewApproval] = useState<ApprovalPreset>("ask");
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentSource | null>(null);
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadControl = useRef<AbortController | null>(null);
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadOwner, setUploadOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!s.authenticated) {
      uploadControl.current?.abort();
      composer.store.clear();
      lastSubmission.current = null;
      sendingOrigin.current = null;
      setSending(false);
      setUploadNotice("");
      setRecoveryNotice("");
      setRecoveredThread(null);
      composer.refresh();
    }
  }, [s.authenticated]);
  useEffect(() => {
    if (!uploading && !sending && !s.pendingRun)
      composer.store.pruneEmpty(composer.key);
  }, [s.selectedId, uploading, sending, s.pendingRun]);
  useEffect(() => () => uploadControl.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal })
      .then((r) => r.json())
      .then((r) => {
        if (!controller.signal.aborted)
          s.set({ authenticated: r.authenticated });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          s.set({ authenticated: false, error: "无法连接服务端" });
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (s.authenticated) {
      connect();
      return disconnect;
    }
  }, [s.authenticated]);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const collapse = () => {
      if (media.matches) useApp.setState({ sidebar: false });
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = resolveTheme(s.theme, media.matches);
      document.documentElement.dataset.theme = theme;
      publishAppearance(theme);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#212121" : "#ffffff");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [s.theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = chatShortcut(
        e,
        !!useApp.getState().authenticated,
        !!document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        ),
      );
      if (action === "search") {
        e.preventDefault();
        setSearch(true);
      } else if (action === "new") {
        e.preventDefault();
        fresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`;
    }
  }, [draft]);
  useEffect(() => {
    if (pinned.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [s.thread, s.approvals]);
  useEffect(() => {
    pinned.current = true;
    setShowDown(false);
  }, [s.selectedId]);
  const activeTurn = s.thread?.turns.find((t) => t.status === "inProgress");
  const running = !!activeTurn || s.thread?.status?.type === "active";
  const selectionDisabled =
    running ||
    sending ||
    !!s.pendingRun ||
    !s.authenticated ||
    !s.settings ||
    !s.connected ||
    s.runtime !== "ready" ||
    s.loading ||
    !!(
      settings ||
      search ||
      rename ||
      archiving ||
      attachmentPreview ||
      workspacePicker
    );
  const mentions = useComposerMentions({
    value: draft,
    scope: `${composer.key}:${composer.value.generation}`,
    disabled: selectionDisabled,
    panel: composerPanel,
    setPanel: setComposerPanel,
    textarea,
    selectedSkills: selectedSkills.map((x) => x.id),
    selectedPlugins: selectedPlugins.map((x) => x.id),
    async onSelect(kind, entry, token, signal) {
      const scope = composer.store.get(composer.key);
      let selection: SkillReference | undefined;
      if (kind === "$" && !scope.skills.some((x) => x.id === entry.id)) {
        const document = await readSkill(
          entry.id,
          AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        );
        if (!document.skill.enabled)
          throw new Error("技能已停用，请刷新后重试");
        selection = {
          id: document.skill.id,
          name: document.skill.name,
          displayName: entry.displayName,
          scope: document.skill.scope,
          sha256: document.sha256,
        };
      }
      const current = composer.store.get(scope.key);
      if (signal.aborted || current.generation !== scope.generation) return;
      if (kind === "$") {
        if (!current.skills.some((x) => x.id === entry.id)) {
          if (current.skills.length >= 8)
            throw new Error("每条消息最多选择 8 个技能");
          composer.store.setSkills(scope.key, [...current.skills, selection!]);
        }
      } else if (!current.plugins.some((x) => x.id === entry.id)) {
        if (current.plugins.length >= 8)
          throw new Error("每条消息最多选择 8 个插件");
        composer.store.setPlugins(scope.key, [
          ...current.plugins,
          { id: entry.id, name: entry.name, displayName: entry.displayName },
        ]);
      }
      if (token && current.text === scope.text)
        composer.store.setText(scope.key, removeMention(current.text, token));
      composer.refresh();
    },
  });
  useEffect(() => {
    if (
      settings ||
      search ||
      rename ||
      archiving ||
      attachmentPreview ||
      workspacePicker
    )
      setComposerPanel(null);
  }, [settings, search, rename, archiving, attachmentPreview, workspacePicker]);
  const drop = useChatDrop({
    disabled: uploading || sending || running || !!s.pendingRun,
    scope: `${composer.key}:${s.authenticated}`,
    upload: (files) => {
      void upload(files);
    },
    begin: () => setComposerPanel(null),
    blocked: () => {
      setUploadNotice(
        uploading
          ? "请等待当前上传完成后再添加附件"
          : running || sending || s.pendingRun
            ? "当前任务执行中，完成后可添加附件"
            : "没有可上传的文件，文件夹暂不支持",
      );
      setUploadOwner(composer.key);
    },
  });
  const stopTask = useTaskStop(s.selectedId, activeTurn?.id);
  const model = s.settings?.models.find((m: Model) => m.model === s.model);
  const pending = s.approvals.filter((a) => a.params.threadId === s.selectedId);
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (
      !draft.trim() ||
      sending ||
      !!s.pendingRun ||
      uploading ||
      attachments.some((a) => !!a.state) ||
      running ||
      !s.connected ||
      !s.settings ||
      s.runtime !== "ready"
    )
      return;
    const snapshot = composer.store.get(composer.key);
    const origin = {
      draft: snapshot,
      navigation: navigation.current,
      threadId: s.selectedId,
    };
    setRecoveryNotice("");
    setRecoveredThread(null);
    setCanAbandon(null);
    submissionError.current = null;
    lastSubmission.current = origin;
    sendingOrigin.current = origin;
    const text = draft;
    const files = [...attachments];
    const skills = selectedSkills.map(({ id, sha256 }) => ({ id, sha256 }));
    setSending(true);
    s.set({ error: "" });
    pinned.current = true;
    try {
      const result = await submitRun({
        threadId: s.selectedId || undefined,
        text,
        attachments: files.map((a) => a.id),
        ...(skills.length ? { skills } : {}),
        ...(selectedPlugins.length
          ? { plugins: selectedPlugins.map((p) => p.id) }
          : {}),
        provider: s.provider || undefined,
        ...(s.selectedId
          ? { runtimeRevision: s.thread?.runtime?.revision || 0 }
          : { approval: newApproval }),
        ...(s.model ? { model: s.model, effort: s.effort || undefined } : {}),
      });
      if (lastSubmission.current !== origin) return;
      const follow =
        navigation.current === origin.navigation &&
        useApp.getState().selectedId === origin.threadId;
      composer.store.acknowledge(
        snapshot,
        follow && origin.threadId === null ? result.threadId : undefined,
      );
      composer.refresh();
      lastSubmission.current = null;
      if (uploadOwner === snapshot.key) setUploadNotice("");
      if (follow) await loadThread(result.threadId);
      await loadThreads();
    } catch (e) {
      if (lastSubmission.current === origin) {
        const message = useApp.getState().pendingRun
          ? "发送结果未确认，请检查发送状态。"
          : e instanceof Error
            ? e.message
            : "发送未完成";
        submissionError.current = message;
        s.notify(message);
      }
    } finally {
      if (sendingOrigin.current === origin) {
        sendingOrigin.current = null;
        setSending(false);
        if (navigation.current === origin.navigation) textarea.current?.focus();
      }
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length || uploading || sending || running || s.pendingRun)
      return;
    const list = Array.from(files),
      scope = composer.store.get(composer.key);
    if (scope.files.length + list.length > 8) {
      setUploadNotice("每条消息最多 8 个附件，请减少选择后重试。");
      return;
    }
    const queued = list.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      mime: file.type,
      state: "uploading" as const,
      file,
    }));
    composer.store.addFiles(scope, queued);
    composer.refresh();
    const controller = new AbortController();
    uploadControl.current = controller;
    setUploadOwner(scope.key);
    setUploading(true);
    setUploadNotice(`正在上传 0 / ${list.length}…`);
    let added = 0;
    const failures: string[] = [];
    try {
      for (const entry of queued) {
        const file = entry.file;
        if (controller.signal.aborted) break;
        try {
          if (file.size > 8 * 1024 * 1024)
            throw new Error("单个附件不能超过 8 MiB");
          const response = await fetch(
            `/api/attachments?name=${encodeURIComponent(file.name)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: file,
              signal: controller.signal,
            },
          );
          if (response.status === 401)
            useApp.setState({ authenticated: false });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "上传未完成");
          const current = composer.store.get(scope.key);
          if (current.generation === scope.generation)
            composer.store.setFiles(
              scope.key,
              current.files.map((f) => (f.id === entry.id ? data : f)),
            );
          composer.refresh();
          added++;
        } catch (error) {
          if (controller.signal.aborted) break;
          const current = composer.store.get(scope.key);
          if (current.generation === scope.generation)
            composer.store.setFiles(
              scope.key,
              current.files.map((f) =>
                f.id === entry.id
                  ? {
                      ...f,
                      state: "failed",
                      error:
                        error instanceof Error ? error.message : "上传未完成",
                    }
                  : f,
              ),
            );
          composer.refresh();
          failures.push(
            `${file.name.slice(0, 60)}：${error instanceof Error ? error.message : "上传未完成"}`,
          );
        }
        setUploadNotice(
          `正在上传 ${added + failures.length} / ${list.length}…`,
        );
      }
      setUploadNotice(
        `${controller.signal.aborted ? "已取消剩余上传；" : ""}已添加 ${added} 个附件${failures.length ? `；${failures.length} 个未完成：${failures.join("；")}` : "。"}`,
      );
    } finally {
      const current = composer.store.get(scope.key);
      if (current.generation === scope.generation)
        composer.store.setFiles(
          scope.key,
          current.files.map((f) =>
            f.state === "uploading"
              ? { ...f, state: "failed", error: "上传已取消" }
              : f,
          ),
        );
      composer.refresh();
      uploadControl.current = null;
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function chooseThread(id: string) {
    navigation.current++;
    void loadThread(id);
    if (window.innerWidth <= 760) s.set({ sidebar: false });
    setSearch(false);
  }
  async function archive(id: string) {
    if (archivePosting.current) return;
    archivePosting.current = true;
    setArchiving(id);
    try {
      await request("thread/archive", { threadId: id });
      useApp.setState((state) => ({
        threads: state.threads.filter((t) => t.id !== id),
      }));
      if (useApp.getState().selectedId === id) {
        navigation.current++;
        newChat();
      }
      await loadThreads();
    } catch (e) {
      s.notify(e);
    } finally {
      archivePosting.current = false;
      setArchiving(null);
    }
  }
  function fresh() {
    setComposerPanel(null);
    setNewApproval("ask");
    navigation.current++;
    composer.store.reset("$new");
    composer.refresh();
    newChat();
    if (window.innerWidth <= 760) s.set({ sidebar: false });
    textarea.current?.focus();
  }
  function clearSubmissionError() {
    if (
      submissionError.current &&
      useApp.getState().error === submissionError.current
    )
      useApp.setState({ error: "" });
    submissionError.current = null;
  }
  async function inspectSubmission() {
    const id = useApp.getState().pendingRun;
    if (!id || checkingRef.current) return;
    checkingRef.current = true;
    setCheckingRun(true);
    setCanAbandon(null);
    try {
      const response = await fetch(`/api/agent/runs/${id}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        s.set({ authenticated: false });
        return;
      }
      if (response.status === 404) {
        setCanAbandon(id);
        setRecoveryNotice(
          "暂未找到提交记录，请稍后核对；也可放弃尚未登记的发送。",
        );
        return;
      }
      if (!response.ok) throw new Error("无法读取请求状态");
      const status = await response.json();
      if (useApp.getState().pendingRun !== id) return;
      if (status.turn?.id) {
        const origin = lastSubmission.current,
          follow =
            !!origin &&
            origin.navigation === navigation.current &&
            useApp.getState().selectedId === origin.threadId;
        if (origin)
          composer.store.acknowledge(
            origin.draft,
            follow && origin.threadId === null ? status.threadId : undefined,
          );
        composer.refresh();
        lastSubmission.current = null;
        if (origin && sendingOrigin.current === origin) {
          sendingOrigin.current = null;
          setSending(false);
        }
        clearPendingRun(id);
        clearSubmissionError();
        setRecoveredThread(status.threadId);
        setRecoveryNotice("上次消息已确认提交。");
        if (follow) await loadThread(status.threadId);
        void loadThreads().catch(() => {});
      } else if (["rejected", "abandoned"].includes(status.state)) {
        clearPendingRun(id);
        clearSubmissionError();
        sendingOrigin.current = null;
        setSending(false);
        lastSubmission.current = null;
        setRecoveryNotice("上次发送未进入执行阶段，草稿已保留。");
      } else
        setRecoveryNotice(
          "提交结果仍未确认，请检查对话记录；不会自动重复执行。",
        );
    } catch {
      setRecoveryNotice("发送状态未能读取，请恢复连接后重试。");
    } finally {
      checkingRef.current = false;
      setCheckingRun(false);
    }
  }
  async function abandonSubmission() {
    const id = useApp.getState().pendingRun;
    if (!id || canAbandon !== id || checkingRef.current) return;
    checkingRef.current = true;
    setCheckingRun(true);
    try {
      const response = await fetch(`/api/agent/runs/${id}/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        s.set({ authenticated: false });
        return;
      }
      const result = await response.json();
      if (!response.ok || !["abandoned", "rejected"].includes(result.state)) {
        setCanAbandon(null);
        setRecoveryNotice("已有提交记录，无法直接放弃；请读取任务状态。");
        return;
      }
      if (useApp.getState().pendingRun === id) {
        clearPendingRun(id);
        clearSubmissionError();
      }
      lastSubmission.current = null;
      sendingOrigin.current = null;
      setSending(false);
      setCanAbandon(null);
      setRecoveryNotice("尚未登记的发送已放弃，草稿保留；迟到请求不会执行。");
    } catch {
      setRecoveryNotice("放弃结果未确认，请重新核对发送状态。");
    } finally {
      checkingRef.current = false;
      setCheckingRun(false);
    }
  }
  if (s.authenticated === null)
    return (
      <div className="boot">
        <Mark size={40} />
        <span>Minimal Agent</span>
      </div>
    );
  if (!s.authenticated) return <Login />;
  return (
    <div className={`workspace ${s.sidebar ? "sidebar-open" : ""}`}>
      {s.pendingRun && (
        <div className="pending-run" role="status">
          <span>上次发送等待确认</span>
          <button
            disabled={checkingRun}
            onClick={() => void inspectSubmission()}
          >
            {checkingRun ? "正在核对…" : "检查发送状态"}
          </button>
          {s.abandonUnseen && canAbandon === s.pendingRun && (
            <button
              disabled={checkingRun}
              onClick={() => void abandonSubmission()}
            >
              放弃尚未登记的发送
            </button>
          )}
        </div>
      )}
      <a
        className="skip-link"
        href="#message-input"
        onClick={(event) => {
          event.preventDefault();
          textarea.current?.focus();
        }}
      >
        跳到消息输入
      </a>
      <Sidebar
        open={s.sidebar}
        onOpenChange={(sidebar) => s.set({ sidebar })}
        restoreFocus={() =>
          (sidebarToggle.current || textarea.current)?.focus({
            preventScroll: true,
          })
        }
      >
        <div className="sidebar-top">
          <button
            className="brand-button"
            onClick={fresh}
            aria-label="Minimal Agent，新对话"
          >
            <Mark size={29} />
            <span>Minimal Agent</span>
          </button>
          <button
            className="icon-button"
            title="收起侧栏"
            aria-label="收起侧栏"
            aria-expanded="true"
            onClick={() => s.set({ sidebar: false })}
          >
            <PanelLeft size={19} />
          </button>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button onClick={fresh}>
            <SquarePen size={19} />
            <span>新聊天</span>
            <kbd>{appleKeys ? "⇧ ⌘ O" : "Ctrl ⇧ O"}</kbd>
          </button>
          <button onClick={() => setSearch(true)}>
            <Search size={19} />
            <span>搜索聊天</span>
            <kbd>{appleKeys ? "⌘ K" : "Ctrl K"}</kbd>
          </button>
          <button onClick={() => setSettings("mcp")}>
            <Blocks size={19} />
            <span>工具连接</span>
          </button>
          <button onClick={() => setSettings("skills")}>
            <BookOpen size={19} />
            <span>技能</span>
          </button>
        </nav>
        <div className="history">
          {s.threadsLoading && (
            <p className="muted" role="status">
              正在读取对话…
            </p>
          )}
          {s.threadsError && (
            <p className="inline-error" role="alert">
              {s.threadsError}
              <button onClick={() => void loadThreads().catch(() => {})}>
                重试
              </button>
            </p>
          )}
          <h2>最近对话</h2>
          {s.threads.length === 0 ? (
            <p className="history-empty">新的想法，从这里开始。</p>
          ) : (
            s.threads.map((t) => (
              <div
                className={`history-row ${s.selectedId === t.id ? "selected" : ""}`}
                key={t.id}
              >
                <button
                  className="history-link"
                  onClick={() => chooseThread(t.id)}
                  title={t.title}
                  aria-current={s.selectedId === t.id ? "page" : undefined}
                >
                  {t.title}
                </button>
                <Dropdown.Root>
                  <Dropdown.Trigger
                    className="icon-button history-more"
                    aria-label={`更多操作：${t.title}`}
                  >
                    <MoreHorizontal size={16} />
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <ActionMenuContent
                      className="dropdown"
                      sideOffset={4}
                      align="start"
                    >
                      <ActionMenuItem
                        icon={Pencil}
                        onSelect={() => setRename({ id: t.id, name: t.title })}
                      >
                        重命名
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={Archive}
                        disabled={!!archiving}
                        onSelect={() => void archive(t.id)}
                      >
                        {archiving === t.id ? "正在归档…" : "归档"}
                      </ActionMenuItem>
                    </ActionMenuContent>
                  </Dropdown.Portal>
                </Dropdown.Root>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="account-button"
            onClick={() => setSettings("general")}
          >
            <span className="avatar">M</span>
            <span>
              <strong>个人工作台</strong>
              <small>私有实例</small>
            </span>
            <SettingsIcon size={18} />
          </button>
        </div>
      </Sidebar>
      <main className="main" aria-label="聊天工作区" {...drop.handlers}>
        {drop.dragging && (
          <div className="chat-drop-hint" role="status">
            <span>
              {uploading
                ? "请等待当前上传完成"
                : running || sending || s.pendingRun
                  ? "当前任务执行中，暂不能添加附件"
                  : "松开以添加附件"}
            </span>
          </div>
        )}
        <header className="topbar">
          <div className="topbar-left">
            {!s.sidebar && (
              <button
                className="icon-button"
                ref={sidebarToggle}
                aria-expanded={s.sidebar}
                aria-label="展开侧栏"
                title="展开侧栏"
                onClick={() => s.set({ sidebar: true })}
              >
                <PanelLeft size={20} />
              </button>
            )}
            <strong className="workspace-title">Minimal Agent</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`runtime-status ${s.runtime === "ready" && s.connected ? "ready" : ""}`}
            >
              <span />
              {!s.connected
                ? "重新连接中"
                : s.runtime === "ready"
                  ? "Codex 已连接"
                  : s.runtime === "starting"
                    ? "Codex 连接中"
                    : "Codex 离线"}
            </span>
          </div>
        </header>
        {s.connectionResourceError && (
          <div className="connection-banner" role="alert">
            <span>
              连接组件未能加载。重新加载会清空未发送草稿，请先复制需要保留的内容。
            </span>
            <button onClick={() => location.reload()}>重新加载页面</button>
          </div>
        )}
        {s.runtime === "offline" && (
          <div className="connection-banner">
            <WifiOff size={16} />
            <span>
              {s.runtimeReason || "Codex 暂不可用，请检查服务端登录与配置。"}
            </span>
            <button
              onClick={() =>
                void request("bridge/restart")
                  .then(loadSettings)
                  .catch(s.notify)
              }
            >
              重新连接
            </button>
          </div>
        )}
        <div
          className={`conversation ${!s.thread ? "empty" : ""}`}
          ref={scroll}
          onScroll={() => {
            const el = scroll.current!;
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            setShowDown(!pinned.current);
          }}
        >
          {!s.thread && !s.loading ? (
            <div className="welcome">
              <div className="welcome-mark">
                <Mark size={43} />
              </div>
              <h1>有什么可以帮忙的？</h1>
              <p>从一个问题开始，把想法变成现实。</p>
              <div className="suggestions">
                {[
                  {
                    icon: Terminal,
                    tone: "violet",
                    title: "一起写点代码",
                    text: "帮我分析一个项目的结构，并提出改进建议。",
                  },
                  {
                    icon: BookOpen,
                    tone: "amber",
                    title: "梳理一个想法",
                    text: "我有一个新想法，请帮我厘清目标、约束和第一步。",
                  },
                  {
                    icon: Blocks,
                    tone: "teal",
                    title: "连接我的工具",
                    text: "查看当前可用的 MCP 工具，告诉我它们可以帮我做什么。",
                  },
                ].map((x) => (
                  <button
                    key={x.title}
                    onClick={() => {
                      setDraft(x.text);
                      textarea.current?.focus();
                    }}
                  >
                    <span className="suggestion-icon">
                      <x.icon size={17} aria-hidden="true" />
                    </span>
                    <span>{x.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-column">
              <HistoryPager scroll={scroll} pinned={pinned} />
              {s.loading && !s.thread && (
                <div className="loading-history">
                  <LoaderCircle size={20} className="spin" />
                  正在恢复对话…
                </div>
              )}
              {s.thread?.turns.map((turn, turnIndex) => (
                <ChatTurn
                  key={turn.id}
                  threadId={s.thread!.id}
                  turn={turn}
                  canAdd={
                    s.artifactRegistration &&
                    turnIndex === s.thread!.turns.length - 1 &&
                    turn.status !== "inProgress"
                  }
                />
              ))}
              {pending.map((a) => (
                <ApprovalCard
                  key={a.params.elicitation?.token || a.id}
                  approval={a}
                />
              ))}
              {s.thread && !s.thread.turns.length && !s.loading && (
                <p className="empty-thread">准备好了，发送第一条消息吧。</p>
              )}
            </div>
          )}
        </div>
        <div className="composer-area">
          {showDown && (
            <button
              className="scroll-bottom icon-button"
              aria-label="回到最新消息"
              onClick={() => {
                pinned.current = true;
                scroll.current?.scrollTo({
                  top: scroll.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              <ArrowDown size={18} />
            </button>
          )}
          {!s.error && <BackgroundNotice />}
          {s.error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{s.error}</span>
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => s.set({ error: "" })}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {stopTask.entry && (
            <div className="composer-feedback" role="status">
              <span>{stopTask.entry.message}</span>
              {stopTask.entry.stage !== "pending" && (
                <button
                  type="button"
                  disabled={stopTask.entry.reading}
                  onClick={() => void stopTask.read()}
                >
                  读取停止状态
                </button>
              )}
            </div>
          )}
          {uploadNotice && (
            <div
              className="composer-feedback"
              role={uploading ? "status" : "status"}
            >
              <span>
                {uploadOwner && uploadOwner !== composer.key
                  ? "另一草稿："
                  : ""}
                {uploadNotice}
              </span>
              {uploading ? (
                <button
                  type="button"
                  onClick={() => uploadControl.current?.abort()}
                >
                  取消上传
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="关闭上传提示"
                  onClick={() => setUploadNotice("")}
                >
                  关闭
                </button>
              )}
            </div>
          )}
          {recoveryNotice && (
            <div className="composer-feedback" role="status">
              <span>{recoveryNotice}</span>
              {recoveredThread && (
                <button onClick={() => chooseThread(recoveredThread)}>
                  查看已提交对话
                </button>
              )}
            </div>
          )}
          {attachmentPreview && (
            <AttachmentPreview
              value={attachmentPreview}
              onClose={() => setAttachmentPreview(null)}
            />
          )}
          {workspacePicker && s.thread && (
            <DeferredPanel
              label="工作区文件"
              onClose={() => setWorkspacePicker(false)}
            >
              <WorkspaceFiles
                threadId={s.thread.id}
                turnId={s.thread.turns.at(-1)!.id}
                onClose={() => setWorkspacePicker(false)}
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  textarea.current?.focus();
                }}
              />
            </DeferredPanel>
          )}
          <form className="composer" onSubmit={(e) => void send(e)}>
            {attachments.length > 0 && (
              <div className="attachment-list">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className={`draft-attachment ${a.mime?.startsWith("image/") ? "image-attachment" : ""}`}
                  >
                    <button
                      type="button"
                      className="attachment-open"
                      aria-label={`预览 ${a.name}`}
                      onClick={() =>
                        setAttachmentPreview({
                          ...a,
                          url: a.state ? undefined : `/api/files/${a.id}`,
                        })
                      }
                    >
                      {a.mime?.startsWith("image/") ? (
                        <AttachmentImage
                          value={{
                            ...a,
                            url: a.state ? undefined : `/api/files/${a.id}`,
                          }}
                        />
                      ) : (
                        <>
                          <Paperclip size={18} />
                          <span>{a.name}</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="attachment-remove"
                      aria-label={`移除 ${a.name}`}
                      disabled={
                        sending || !!s.pendingRun || a.state === "uploading"
                      }
                      onClick={() =>
                        setAttachments((prev) =>
                          prev.filter((v) => v.id !== a.id),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                    {a.state === "uploading" && (
                      <span className="attachment-state" role="status">
                        <LoaderCircle size={15} className="spin" />
                        上传中
                      </span>
                    )}
                    {a.state === "failed" && (
                      <div className="attachment-state failed">
                        <span title={a.error}>上传失败</span>
                        <button
                          type="button"
                          disabled={
                            uploading || running || sending || !!s.pendingRun
                          }
                          onClick={() => {
                            setAttachments((prev) =>
                              prev.filter((v) => v.id !== a.id),
                            );
                            void upload([a.file!]);
                          }}
                        >
                          重试
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {selectedPlugins.length > 0 && (
              <div className="skill-draft-list" aria-label="下一条消息的插件">
                {selectedPlugins.map((p) => (
                  <span key={p.id}>
                    <Blocks size={14} />
                    {p.displayName}
                    <button
                      type="button"
                      disabled={sending || !!s.pendingRun}
                      aria-label={`移除插件 ${p.displayName}`}
                      onClick={() => {
                        composer.store.setPlugins(
                          composer.key,
                          selectedPlugins.filter((v) => v.id !== p.id),
                        );
                        composer.refresh();
                      }}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {mentions.menu}
            {selectedSkills.length > 0 && (
              <div className="skill-draft-list" aria-label="下一条消息的技能">
                {selectedSkills.map((skill) => {
                  const current = s.settings?.skills.find(
                    (s: Json) => s.id === skill.id,
                  );
                  const unavailable = !current || !current.enabled;
                  return (
                    <span
                      key={skill.id}
                      className={unavailable ? "is-unavailable" : ""}
                    >
                      <BookOpen size={14} aria-hidden="true" />
                      <span>
                        {skill.displayName}
                        {unavailable ? "（已停用或失效）" : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={`移除技能 ${skill.displayName}`}
                        disabled={sending || !!s.pendingRun}
                        onClick={() =>
                          setSelectedSkills((prev) =>
                            prev.filter((s) => s.id !== skill.id),
                          )
                        }
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <textarea
              ref={textarea}
              id="message-input"
              aria-label="消息"
              placeholder="询问任何问题"
              rows={1}
              value={draft}
              onPaste={(e) => {
                const images = Array.from(e.clipboardData.files).filter((f) =>
                  f.type.startsWith("image/"),
                );
                if (images.length) {
                  e.preventDefault();
                  void upload(images);
                }
              }}
              aria-controls={mentions.active ? mentions.listId : undefined}
              aria-activedescendant={
                mentions.active ? mentions.activeId : undefined
              }
              aria-autocomplete="list"
              onSelect={mentions.onCaretChange}
              onClick={mentions.onCaretChange}
              onKeyUp={mentions.onCaretChange}
              onChange={(e) => {
                setDraft(e.target.value);
                mentions.onCaretChange();
              }}
              onKeyDown={(e) => {
                if (mentions.onKeyDown(e)) return;
                if (composerEnter(e.nativeEvent)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-tools">
              <div className="composer-tools-left">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.json,.csv,.log,.ts,.tsx,.js,.py,.html,.css,.yaml,.yml,.toml,.png,.jpg,.jpeg,.webp"
                  hidden
                  multiple
                  onChange={(e) => void upload(e.target.files)}
                />
                <Dropdown.Root
                  open={composerPanel === "attachments"}
                  onOpenChange={(open) =>
                    setComposerPanel((p) =>
                      open ? "attachments" : p === "attachments" ? null : p,
                    )
                  }
                >
                  <Dropdown.Trigger
                    type="button"
                    className="icon-button attach-button"
                    id="composer-add"
                    aria-label="添加附件"
                    title="添加附件与工具"
                    disabled={uploading || sending || running || !!s.pendingRun}
                  >
                    {uploading ? (
                      <LoaderCircle size={20} className="spin" />
                    ) : (
                      <Plus size={22} />
                    )}
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <ActionMenuContent
                      className="dropdown"
                      sideOffset={8}
                      align="start"
                      onCloseAutoFocus={(e) => {
                        if (
                          composerPanel === "plugins" ||
                          composerPanel === "skills"
                        )
                          e.preventDefault();
                      }}
                    >
                      <ActionMenuItem
                        icon={Paperclip}
                        onSelect={() => fileInput.current?.click()}
                      >
                        上传文件
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={FolderOpen}
                        disabled={
                          !s.artifactRegistration || !s.thread?.turns.length
                        }
                        onSelect={() => setWorkspacePicker(true)}
                      >
                        添加工作区文件
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={Blocks}
                        separated
                        disabled={!s.pluginSelection}
                        onSelect={() =>
                          mentions.open(
                            "plugins",
                            document.getElementById("composer-add"),
                          )
                        }
                      >
                        选择插件
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={BookOpen}
                        disabled={!s.skillSelection}
                        onSelect={() =>
                          mentions.open(
                            "skills",
                            document.getElementById("composer-add"),
                          )
                        }
                      >
                        选择技能
                      </ActionMenuItem>
                    </ActionMenuContent>
                  </Dropdown.Portal>
                </Dropdown.Root>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="选择插件"
                  data-composer-picker
                  title="选择插件"
                  disabled={selectionDisabled || !s.pluginSelection}
                  onClick={(e) => mentions.open("plugins", e.currentTarget)}
                >
                  <Blocks size={18} />
                </button>
                {s.skillSelection && (
                  <button
                    type="button"
                    className="icon-button skill-picker-trigger"
                    title="选择技能"
                    aria-label="选择技能"
                    data-composer-picker
                    disabled={selectionDisabled}
                    onClick={(e) => mentions.open("skills", e.currentTarget)}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
              <RuntimeSelector
                panel={composerPanel}
                setPanel={setComposerPanel}
                disabled={selectionDisabled}
                newApproval={newApproval}
                onApproval={setNewApproval}
              />
              {running ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label="停止回答"
                  title="停止回答"
                  disabled={!activeTurn || !s.connected || stopTask.disabled}
                  onClick={() => void stopTask.stop()}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={
                    !draft.trim() ||
                    !!s.pendingRun ||
                    sending ||
                    uploading ||
                    attachments.some((a) => !!a.state) ||
                    !s.connected ||
                    !s.settings ||
                    s.runtime !== "ready"
                  }
                >
                  {sending ? (
                    <LoaderCircle size={19} className="spin" />
                  ) : (
                    <ArrowUp size={21} />
                  )}
                </button>
              )}
            </div>
          </form>
          <p className="composer-note">
            Minimal Agent 可能会犯错。重要信息请核实。
          </p>
        </div>
      </main>
      <Modal open={search} onOpenChange={setSearch} title="搜索聊天">
        <div className="search-input">
          <Search size={19} />
          <input
            autoFocus
            data-autofocus
            placeholder="搜索你的对话…"
            aria-label="搜索对话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="muted">搜索已保存的对话名称</p>
        {s.threadsLoading && (
          <p role="status" className="muted">
            正在读取对话…
          </p>
        )}
        {s.threadsError && (
          <p role="alert" className="inline-error">
            {s.threadsError}
            <button onClick={() => void loadThreads().catch(() => {})}>
              重试
            </button>
          </p>
        )}
        <div className="search-results">
          {s.threads
            .filter((t) =>
              t.title
                .normalize("NFKC")
                .toLocaleLowerCase()
                .includes(query.trim().normalize("NFKC").toLocaleLowerCase()),
            )
            .map((t) => (
              <button key={t.id} onClick={() => chooseThread(t.id)}>
                <SquarePen size={17} />
                <span>{t.title}</span>
                <ArrowRight size={15} />
              </button>
            ))}
          {!s.threadsLoading &&
            !s.threadsError &&
            !s.threads.some((t) =>
              t.title
                .normalize("NFKC")
                .toLocaleLowerCase()
                .includes(query.trim().normalize("NFKC").toLocaleLowerCase()),
            ) && <p className="muted">没有找到匹配的对话</p>}
        </div>
      </Modal>
      {rename && (
        <RenameDialog
          key={rename.id}
          id={rename.id}
          title={rename.name}
          onClose={() => setRename(null)}
        />
      )}
      {settings && (
        <DeferredPanel
          label="设置"
          onClose={() => {
            setSettings(null);
            textarea.current?.focus();
          }}
        >
          <Settings
            open={!!settings}
            onOpenChange={(v) => {
              if (!v) setSettings(null);
            }}
            initialTab={settings}
          />
        </DeferredPanel>
      )}
    </div>
  );
}
