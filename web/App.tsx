import { usePanelLayout } from "./panels";
import UserMessage from "./components/chat/UserMessage";
import { SearchIcon as Search } from "./components/ReferenceIcons";
import {
  PluginIcon as Blocks,
  ExpertIcon as UsersRound,
  SkillIcon as BookOpen,
} from "./components/AppIcons";
import SessionPrivateAccess from "./components/SessionPrivateAccess";
import { privateApi } from "./private-input";
import { responseJson } from "./http";
import ChatPrivateInputs from "./components/ChatPrivateInputs";
import WorkbenchRail from "./components/WorkbenchRail";
import { CapabilityRow } from "./components/CapabilityRow";
import {
  submissionPreviewVisible,
  type SubmissionPreview,
} from "./submission-preview";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ActionMenuContent, ActionMenuItem } from "./components/ActionMenu";
import {
  ArrowUp,
  Square,
  SlidersHorizontal,
  Plus,
  MessageSquare,
  ChevronDown,
  Check,
  X,
  MoreHorizontal,
  CheckCheck,
  ArrowDown,
  LoaderCircle,
  ShieldCheck,
  ArrowRight,
  Paperclip,
  FolderOpen,
  AlertCircle,
  WifiOff,
} from "lucide-react";
import type {
  Json,
  Model,
  Thread,
  SkillReference,
  PluginReference,
  SessionInputs,
  Artifact,
} from "../shared/types";
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
  updatePendingRun,
} from "./store";
import { useComposerMentions } from "./components/ComposerMentions";
import type { ComposerPanel } from "./components/Picker";
import { removeMention, type MentionToken } from "./composer-selection";
import { useChatDrop } from "./chat-drop";
import { readSkill } from "./skills";
import RuntimeSelector from "./components/RuntimeSelector";
import type { ExpertReference, SessionExtensions } from "../shared/experts";
const ExpertDetails = lazy(() => import("./components/ExpertDetails"));
import type { ApprovalPreset } from "../shared/runtime-settings";
import AttachmentPreview, {
  AttachmentImage,
  type AttachmentSource,
} from "./components/AttachmentPreview";
import { Mark, Modal } from "./components/ui";
import { ConversationNavigation } from "./components/ConversationNavigation";
import { SidebarIcon } from "./components/SidebarIcon";
import { DeferredPanel } from "./components/DeferredPanel";
import { publishAppearance } from "./appearance";
import { chatShortcut, composerEnter, resolveTheme } from "./interaction";
import { useComposerDrafts, type DraftSnapshot } from "./composer-drafts";
import { HistoryPager } from "./components/chat/HistoryPager";
import { RenameDialog } from "./components/chat/RenameDialog";
import { useTaskStop } from "./components/chat/StopTask";
import { ChatTurn } from "./components/chat/Turn";
import { ReadIndicator } from "./components/ReadIndicator";
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
        <span>newbot</span>
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
const ArtifactPreview = lazy(() => import("./components/ArtifactPreview"));
export default function App() {
  const s = useApp();
  const composer = useComposerDrafts(s.selectedId, s.newDraftKey);
  const draft = composer.value.text,
    setDraft = composer.setText;
  const attachments = composer.value.files,
    setAttachments = composer.setFiles;
  const selectedPlugins = composer.value.plugins;
  const [inputsBusy, setInputsBusy] = useState(false),
    [runtimeBusy, setRuntimeBusy] = useState(false);
  const inputsRequest = useRef(false);
  useEffect(() => {
    if (s.thread?.id === s.selectedId && s.thread?.nextInput) {
      composer.store.hydrateInputs(s.thread.id, s.thread.nextInput);
      composer.refresh();
    }
  }, [s.thread?.id, s.thread?.nextInput?.revision, s.selectedId]);
  async function saveInputs(
    key: string,
    skills: SkillReference[],
    plugins: PluginReference[],
  ) {
    if (inputsRequest.current) throw new Error("正在保存扩展，请稍候");
    if (key.startsWith("$new")) {
      composer.store.setSkills(key, skills);
      composer.store.setPlugins(key, plugins);
      composer.refresh();
      return;
    }
    const before = composer.store.get(key);
    inputsRequest.current = true;
    setInputsBusy(true);
    try {
      const value = await request<SessionInputs>("session/inputs", {
        threadId: key,
        expectedRevision: before.inputRevision || 0,
        skills: skills.map(({ id, sha256 }) => ({ id, sha256 })),
        plugins: plugins.map((p) => p.id),
      });
      useApp.setState((state) =>
        state.thread?.id === key &&
        value.revision >= (state.thread.nextInput?.revision || 0)
          ? { thread: { ...state.thread, nextInput: value } }
          : {},
      );
      if (composer.store.get(key).generation === before.generation)
        composer.store.hydrateInputs(key, value);
      composer.refresh();
    } catch (error) {
      if (useApp.getState().selectedId === key)
        void loadThread(key, false).catch(() => {});
      throw error;
    } finally {
      inputsRequest.current = false;
      setInputsBusy(false);
    }
  }
  const selectedExpert = s.selectedId
    ? s.thread?.extensions?.expert ||
      (s.thread?.extensions?.expertId
        ? {
            id: s.thread.extensions.expertId,
            name: "已移除的专家",
            revision: 0,
          }
        : null)
    : composer.value.expert;
  const [expertDetail, setExpertDetail] = useState<ExpertReference | null>(
      null,
    ),
    [expertBusy, setExpertBusy] = useState(false);
  const expertRequest = useRef(false);
  async function chooseExpert(expert: ExpertReference | null) {
    if (expertRequest.current) throw new Error("正在更新专家，请稍候");
    const state = useApp.getState(),
      scope = composer.store.get(composer.key);
    if (!state.selectedId) {
      composer.store.setExpert(scope.key, expert);
      composer.refresh();
      return;
    }
    const threadId = state.selectedId;
    expertRequest.current = true;
    setExpertBusy(true);
    try {
      const extensions = await request<SessionExtensions>(
        "session/extensions",
        {
          threadId,
          expertId: expert?.id || null,
          expectedRevision: state.thread?.extensions?.revision || 0,
        },
      );
      useApp.setState((s) =>
        s.thread?.id === threadId &&
        extensions.revision >= (s.thread.extensions?.revision || 0)
          ? { thread: { ...s.thread, extensions } }
          : {},
      );
    } finally {
      expertRequest.current = false;
      setExpertBusy(false);
    }
  }
  const selectedSkills = composer.value.skills;
  const sendingOrigin = useRef<object | null>(null);
  const submissionError = useRef<string | null>(null);
  const navigation = useRef(0),
    lastSubmission = useRef<{
      draft: DraftSnapshot;
      navigation: number;
      threadId: string | null;
    } | null>(null);
  const origins = useRef(
    new Map<string, NonNullable<typeof lastSubmission.current>>(),
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const sending = sendingKey === composer.key;
  const setSending = (value: boolean) =>
    setSendingKey(value ? composer.key : null);
  const pendingSubmission = s.pendingRun
    ? s.pendingRuns[s.pendingRun]
    : undefined;
  const [localSubmission, setLocalSubmission] = useState<
    | (SubmissionPreview & {
        key: string;
        localId: string;
        requestId?: string;
        turnId?: string;
      })
    | null
  >(null);
  const submission =
    localSubmission?.key === composer.key
      ? localSubmission
      : pendingSubmission?.preview;
  const showSubmission =
    !!submission && submissionPreviewVisible(submission, s.thread?.turns || []);
  const [privateAccess, setPrivateAccess] = useState<string | null>(null);
  const threadTitle = (() => {
    const summary = s.threads.find((t) => t.id === s.selectedId);
    const title = summary?.title || s.thread?.name || "";
    return title && title !== "新对话" ? title : "";
  })();
  const railToggle = useRef<HTMLButtonElement>(null);
  const afterRailClose = useRef<(() => void) | null>(null);
  const workbenchReturnFocus = useRef<HTMLElement | null>(null);
  function rememberWorkbenchFocus() {
    const active = document.activeElement;
    workbenchReturnFocus.current =
      active instanceof HTMLElement && active.closest(".rail") ? active : null;
  }
  function restoreWorkbenchFocus(event: Event) {
    event.preventDefault();
    const target = workbenchReturnFocus.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else textarea.current?.focus({ preventScroll: true });
  }
  function openWorkspaceFiles() {
    rememberWorkbenchFocus();
    setWorkspacePicker(true);
  }
  const [railCapabilityFocus, setRailCapabilityFocus] = useState<{
    kind: "plugins" | "skills";
    version: number;
  } | null>(null);
  const capabilityReturnFocus = useRef<HTMLElement | null>(null);
  function openComposerCapability(
    kind: "plugins" | "skills",
    trigger: HTMLElement | null,
  ) {
    if (!s.selectedId) {
      mentions.open(kind, trigger);
      return;
    }
    capabilityReturnFocus.current = trigger;
    setRailCapabilityFocus((prior) => ({
      kind,
      version: (prior?.version || 0) + 1,
    }));
    setRailOpen(true);
  }
  const [railArtifact, setRailArtifact] = useState<Artifact | null>(null);
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem("newbot:rail") === "1",
  );
  useEffect(() => {
    if (!railOpen) setRailCapabilityFocus(null);
  }, [railOpen]);
  const panelLayout = usePanelLayout(s.sidebar, railOpen && !!s.selectedId);
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
      useApp.setState({
        sidebar: media.matches ? false : useApp.getState().desktopSidebar,
      });
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
        ?.setAttribute("content", theme === "dark" ? "#131211" : "#ffffff");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [s.theme]);
  useEffect(() => {
    localStorage.setItem("newbot:rail", railOpen ? "1" : "0");
  }, [railOpen]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        setRailOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
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
  }, [draft, sending, !!pendingSubmission]);
  useEffect(() => {
    if (pinned.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [s.thread, s.approvals, showSubmission]);
  useEffect(() => {
    pinned.current = true;
    setShowDown(false);
  }, [s.selectedId]);
  const activeTurn = s.thread?.turns.find((t) => t.status === "inProgress");
  const running = !!activeTurn || s.thread?.status?.type === "active";
  const selectionContextDisabled =
    !!expertDetail ||
    sending ||
    !!s.pendingRun ||
    !s.authenticated ||
    !s.settings ||
    !s.connected ||
    s.runtime !== "ready" ||
    s.loading ||
    !!s.threadError ||
    !!(
      settings ||
      search ||
      rename ||
      archiving ||
      attachmentPreview ||
      workspacePicker
    );
  const selectionDisabled =
    selectionContextDisabled || expertBusy || inputsBusy;
  async function selectCapability(
    kind: "$" | "@",
    entry: Json,
    token: MentionToken | null,
    signal: AbortSignal,
  ) {
    const scope = composer.store.get(composer.key);
    let selection: SkillReference | undefined;
    if (kind === "$" && !scope.skills.some((x) => x.id === entry.id)) {
      const document = await readSkill(
        entry.id,
        AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      );
      if (!document.skill.enabled) throw new Error("技能已停用，请刷新后重试");
      selection = {
        id: document.skill.id,
        name: document.skill.name,
        displayName: entry.displayName,
        scope: document.skill.scope,
        sha256: document.sha256,
      };
    }
    if (entry.kind === "expert") {
      if (signal.aborted) return;
      await chooseExpert({
        id: entry.id,
        name: entry.name,
        revision: entry.revision,
      });
    }
    const current = composer.store.get(scope.key);
    if (signal.aborted || current.generation !== scope.generation) return;
    if (kind === "$") {
      if (!current.skills.some((x) => x.id === entry.id)) {
        if (current.skills.length >= 8)
          throw new Error("每条消息最多选择 8 个技能");
        await saveInputs(
          scope.key,
          [...current.skills, selection!],
          current.plugins,
        );
      }
    } else if (
      entry.kind !== "expert" &&
      !current.plugins.some((x) => x.id === entry.id)
    ) {
      if (current.plugins.length >= 8)
        throw new Error("每条消息最多选择 8 个插件");
      await saveInputs(scope.key, current.skills, [
        ...current.plugins,
        { id: entry.id, name: entry.name, displayName: entry.displayName },
      ]);
    }
    const latest = composer.store.get(scope.key);
    if (
      !signal.aborted &&
      latest.generation === scope.generation &&
      token &&
      latest.text === scope.text
    )
      composer.store.setText(scope.key, removeMention(latest.text, token));
    composer.refresh();
  }
  const mentions = useComposerMentions({
    value: draft,
    scope: `${composer.key}:${composer.value.generation}`,
    disabled: selectionContextDisabled,
    panel: composerPanel,
    setPanel: setComposerPanel,
    textarea,
    selectedSkills: selectedSkills.map((x) => x.id),
    selectedPlugins: selectedPlugins.map((x) => x.id),
    selectedExpert: selectedExpert?.id,
    onSelect: selectCapability,
  });
  useEffect(() => {
    if (
      railOpen ||
      !afterRailClose.current ||
      window.matchMedia("(max-width: 1080px)").matches
    )
      return;
    const action = afterRailClose.current;
    const frame = requestAnimationFrame(() => {
      afterRailClose.current = null;
      action();
    });
    return () => cancelAnimationFrame(frame);
  }, [railOpen]);
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
    disabled: uploading || sending || !!s.pendingRun,
    scope: `${composer.key}:${s.authenticated}`,
    upload: (files) => {
      void upload(files);
    },
    begin: () => setComposerPanel(null),
    blocked: () => {
      setUploadNotice(
        uploading
          ? "请等待当前上传完成后再添加附件"
          : sending || s.pendingRun
            ? "请等待本次发送确认后再添加附件"
            : "没有可上传的文件，文件夹暂不支持",
      );
      setUploadOwner(composer.key);
    },
  });
  const stopTask = useTaskStop(s.selectedId, activeTurn?.id);
  const model = s.settings?.models.find((m: Model) => m.model === s.model);
  const pending = s.approvals.filter((a) => a.params.threadId === s.selectedId);
  async function send(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const text = (override ?? composer.store.get(composer.key).text).trim();
    if (
      (!text && !attachments.length) ||
      expertRequest.current ||
      inputsRequest.current ||
      runtimeBusy ||
      sending ||
      !!s.pendingRun ||
      uploading ||
      attachments.some((a) => !!a.state) ||
      running ||
      !s.connected ||
      !s.settings ||
      s.runtime !== "ready" ||
      s.loading ||
      !!s.threadError
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
    const files = [...attachments];
    const skills = selectedSkills.map(({ id, sha256 }) => ({ id, sha256 }));
    const localId = crypto.randomUUID();
    const preview = {
      text,
      files: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime })),
      beforeTurns: s.thread?.turns.map((t) => t.id) || [],
    };
    setLocalSubmission({ key: composer.key, localId, ...preview });
    setSending(true);
    if (uploadOwner === snapshot.key) setUploadNotice("");
    s.set({ error: "" });
    pinned.current = true;
    try {
      const result = await submitRun(
        {
          threadId: s.selectedId || undefined,
          text,
          attachments: files.map((a) => a.id),
          expertId: selectedExpert?.id || null,
          extensionRevision: s.selectedId
            ? s.thread?.extensions?.revision || 0
            : undefined,
          inputRevision: s.selectedId
            ? (snapshot.inputRevision ?? s.thread?.nextInput?.revision ?? 0)
            : undefined,
          ...(skills.length ? { skills } : {}),
          ...(selectedPlugins.length
            ? { plugins: selectedPlugins.map((p) => p.id) }
            : {}),
          provider: s.provider || undefined,
          ...(s.selectedId
            ? { runtimeRevision: s.thread?.runtime?.revision || 0 }
            : { approval: newApproval }),
          ...(s.model ? { model: s.model, effort: s.effort || undefined } : {}),
        },
        (id) => {
          origins.current.set(id, origin);
          setLocalSubmission((value) =>
            value?.localId === localId ? { ...value, requestId: id } : value,
          );
        },
        preview,
      );
      if (result.state === "awaiting_credentials") return;
      setLocalSubmission((value) =>
        value?.localId === localId
          ? { ...value, turnId: result.turn?.id }
          : value,
      );
      if (!origins.current.has(result.requestId)) return;
      origins.current.delete(result.requestId);
      const follow =
        navigation.current === origin.navigation &&
        useApp.getState().selectedId === origin.threadId &&
        (origin.threadId !== null ||
          useApp.getState().newDraftKey === origin.draft.key);
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
      if (
        navigation.current === origin.navigation &&
        useApp.getState().selectedId === origin.threadId
      ) {
        const message = useApp.getState().pendingRun
          ? "发送结果未确认，请检查发送状态。"
          : e instanceof Error
            ? e.message
            : "发送未完成";
        submissionError.current = message;
        s.notify(message);
      }
    } finally {
      setLocalSubmission((value) =>
        value?.localId === localId ? null : value,
      );
      if (sendingOrigin.current === origin) {
        sendingOrigin.current = null;
        setSending(false);
        if (navigation.current === origin.navigation) textarea.current?.focus();
      }
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length || uploading || sending || s.pendingRun) return;
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
          const data = await responseJson(response);
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
  const inspections = useRef(new Set<string>());
  async function inspectSubmission(requestId?: string, automatic = false) {
    const id = requestId || useApp.getState().pendingRun;
    if (!id || inspections.current.has(id)) return;
    const entry = useApp.getState().pendingRuns[id];
    if (!entry || entry.state === "submitting") return;
    inspections.current.add(id);
    if (!automatic) {
      setCheckingRun(true);
      setCanAbandon(null);
    }
    try {
      const response = await fetch(`/api/agent/runs/${id}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        s.set({ authenticated: false });
        return;
      }
      if (response.status === 404) {
        if (useApp.getState().pendingRun === id) {
          setCanAbandon(id);
          if (!automatic)
            setRecoveryNotice(
              "暂未找到提交记录，可稍后核对或放弃尚未登记的发送。",
            );
        }
        return;
      }
      if (!response.ok) throw new Error("无法读取请求状态");
      const status = await responseJson<Json>(response);
      if (!useApp.getState().pendingRuns[id]) return;
      if (status.turn?.id) {
        const origin = origins.current.get(id);
        const follow = origin
          ? origin.navigation === navigation.current &&
            useApp.getState().selectedId === origin.threadId &&
            (origin.threadId !== null ||
              useApp.getState().newDraftKey === origin.draft.key)
          : entry.origin ===
              (useApp.getState().selectedId || useApp.getState().newDraftKey) &&
            !composer.store.get(entry.origin).text &&
            !composer.store.get(entry.origin).files.length;
        if (origin)
          composer.store.acknowledge(
            origin.draft,
            follow && origin.threadId === null ? status.threadId : undefined,
          );
        composer.refresh();
        origins.current.delete(id);
        clearPendingRun(id);
        clearSubmissionError();
        if (origin && sendingOrigin.current === origin) {
          sendingOrigin.current = null;
          setSending(false);
        }
        if (origin === lastSubmission.current) lastSubmission.current = null;
        if (follow) await loadThread(status.threadId);
        if (!automatic) {
          setRecoveredThread(status.threadId);
          setRecoveryNotice("消息已确认提交。");
        }
        void loadThreads().catch(() => {});
      } else if (["rejected", "abandoned"].includes(status.state)) {
        const visible = useApp.getState().pendingRun === id;
        if (entry.preview && !origins.current.has(id)) {
          composer.store.recoverSubmission(entry.origin, entry.preview);
          composer.refresh();
        }
        clearPendingRun(id);
        origins.current.delete(id);
        clearSubmissionError();
        if (visible)
          setRecoveryNotice(
            status.error || "此次发送未进入执行阶段，草稿已保留。",
          );
      } else {
        updatePendingRun(id, status);
        if (!automatic && status.state !== "awaiting_credentials")
          setRecoveryNotice("提交结果仍未确认，不会自动重复执行。");
      }
    } catch {
      if (!automatic) setRecoveryNotice("发送状态暂不可读，请恢复连接后重试。");
    } finally {
      inspections.current.delete(id);
      if (!automatic) setCheckingRun(false);
    }
  }
  const inspectRef = useRef(inspectSubmission);
  inspectRef.current = inspectSubmission;
  useEffect(() => {
    if (!s.authenticated || !s.connected) return;
    const check = () => {
      for (const entry of Object.values(useApp.getState().pendingRuns))
        if (entry.state !== "submitting")
          void inspectRef.current(entry.id, true);
    };
    check();
    const timer = setInterval(check, 2000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [
    s.authenticated,
    s.connected,
    Object.values(s.pendingRuns)
      .map((r) => r.id + ":" + r.state)
      .join(","),
  ]);
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
      const result = await responseJson(response);
      if (!response.ok || !["abandoned", "rejected"].includes(result.state)) {
        setCanAbandon(null);
        setRecoveryNotice("已有提交记录，无法直接放弃；请读取任务状态。");
        return;
      }
      if (useApp.getState().pendingRun === id) {
        const entry = useApp.getState().pendingRuns[id];
        if (entry?.preview && !origins.current.has(id)) {
          composer.store.recoverSubmission(entry.origin, entry.preview);
          composer.refresh();
        }
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
        <span>newbot</span>
      </div>
    );
  if (!s.authenticated) return <Login />;
  return (
    <div className={`workspace ${s.sidebar ? "sidebar-open" : ""}`}>
      {privateAccess && (
        <SessionPrivateAccess
          threadId={privateAccess}
          onClose={() => setPrivateAccess(null)}
        />
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
      <ConversationNavigation
        width={panelLayout.left}
        open={s.sidebar}
        onOpenChange={(sidebar) => s.set({ sidebar })}
        restoreFocus={() =>
          (sidebarToggle.current || textarea.current)?.focus({
            preventScroll: true,
          })
        }
        threads={s.threads}
        selectedId={s.selectedId}
        loading={s.threadsLoading}
        error={s.threadsError}
        archiving={archiving}
        appleKeys={appleKeys}
        onNewChat={fresh}
        onSearch={() => setSearch(true)}
        onReload={() => void loadThreads().catch(() => {})}
        onSettings={setSettings}
        onSelect={chooseThread}
        onRename={setRename}
        onArchive={(id) => void archive(id)}
      />
      <main
        className={`main ${!s.thread && !s.selectedId && !s.loading && !pendingSubmission && !showSubmission ? "is-home" : ""}`}
        aria-label="聊天工作区"
        {...drop.handlers}
      >
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
                className="icon-button expand-sidebar"
                ref={sidebarToggle}
                aria-expanded={false}
                aria-label="展开侧栏"
                title="展开侧栏"
                onClick={() => s.set({ sidebar: true })}
              >
                <SidebarIcon size={18} />
              </button>
            )}
            <strong className="workspace-title" title={threadTitle || "newbot"}>
              {threadTitle || "newbot"}
            </strong>
          </div>
          <div className="topbar-right">
            <ReadIndicator
              busy={s.loading}
              error={s.threadError}
              label="正在更新对话"
              onRetry={() => {
                if (s.selectedId) void loadThread(s.selectedId);
              }}
            />
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
            {s.selectedId && (
              <button
                className="icon-button"
                aria-label="会话私密授权"
                title="会话私密授权"
                onClick={() => setPrivateAccess(s.selectedId)}
              >
                <ShieldCheck size={17} />
              </button>
            )}
            {s.selectedId && (
              <button
                type="button"
                ref={railToggle}
                className={`icon-button rail-toggle ${railOpen ? "open" : ""}`}
                aria-label={railOpen ? "关闭右侧栏" : "打开右侧栏"}
                aria-expanded={railOpen}
                aria-pressed={railOpen}
                title={
                  railOpen
                    ? "关闭右侧栏（Ctrl Shift A）"
                    : "打开右侧栏（Ctrl Shift A）"
                }
                onClick={() => setRailOpen((v) => !v)}
              >
                <SidebarIcon size={18} side="right" />
                {(s.thread?.nextInput?.skills.length || 0) +
                  (s.thread?.nextInput?.plugins.length || 0) +
                  (selectedExpert ? 1 : 0) >
                  0 && (
                  <span className="association-count" aria-hidden="true">
                    {(s.thread?.nextInput?.skills.length || 0) +
                      (s.thread?.nextInput?.plugins.length || 0) +
                      (selectedExpert ? 1 : 0)}
                  </span>
                )}
              </button>
            )}
          </div>
        </header>
        <div className="submission-notices" aria-label="发送状态">
          {pendingSubmission?.state === "unknown" && (
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
          <div className="pending-navigation-list">
            {Object.values(s.pendingRuns)
              .filter((r) => r.id !== s.pendingRun && r.state !== "submitting")
              .map((r) => (
                <button
                  key={r.id}
                  className="pending-navigation"
                  onClick={() => {
                    navigation.current++;
                    if (r.status?.threadId) void loadThread(r.status.threadId);
                    else if (r.origin.startsWith("$new")) newChat(r.origin);
                    else void loadThread(r.origin);
                  }}
                >
                  {r.state === "awaiting_credentials"
                    ? "待授权的任务"
                    : "待确认的发送"}
                </button>
              ))}
          </div>
        </div>
        <div className="chat-notifications">
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
        </div>
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
          onClickCapture={(event) => {
            if (
              (event.target as Element).closest(
                ".process-toggle, .tool-item > summary",
              )
            ) {
              pinned.current = false;
              setShowDown(true);
            }
          }}
        >
          {!s.thread &&
          !s.loading &&
          !s.selectedId &&
          !showSubmission &&
          pendingSubmission?.state !== "awaiting_credentials" ? (
            <div className="welcome">
              <h1>今天想探索什么？</h1>
            </div>
          ) : (
            <div
              className="message-column"
              aria-busy={s.loading}
              inert={!!s.thread && (s.loading || !!s.threadError)}
            >
              <HistoryPager scroll={scroll} pinned={pinned} />
              {s.loading && !s.thread && (
                <div className="loading-history" role="status">
                  <LoaderCircle size={20} className="spin" aria-hidden="true" />
                  <span className="sr-only">正在读取对话</span>
                </div>
              )}
              {s.threadError && !s.thread && (
                <div className="history-read-error" role="alert">
                  <p>{s.threadError}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadThread(s.selectedId!)}
                  >
                    重新读取对话
                  </button>
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
                  isLast={turnIndex === s.thread!.turns.length - 1}
                  onSuggest={(value) => void send(undefined, value)}
                />
              ))}
              {showSubmission && submission && (
                <div
                  className="turn pending-message"
                  aria-label="正在提交的消息"
                >
                  <UserMessage
                    content={[
                      { type: "text", text: submission.text },
                      ...submission.files.map((file) => ({
                        type: file.mime?.startsWith("image/")
                          ? "image"
                          : "attachment",
                        id: file.id,
                        name: file.name,
                        mime: file.mime,
                        url: `/api/files/${file.id}`,
                      })),
                    ]}
                  />
                  <div className="submission-status" role="status">
                    <LoaderCircle
                      size={15}
                      className="spin"
                      aria-hidden="true"
                    />
                    {pendingSubmission?.state === "unknown"
                      ? "正在确认发送状态…"
                      : pendingSubmission?.state === "awaiting_credentials"
                        ? "等待你提供授权"
                        : "正在发送…"}
                  </div>
                </div>
              )}
              {pendingSubmission?.state === "awaiting_credentials" && (
                <ChatPrivateInputs
                  runId={pendingSubmission.id}
                  status={pendingSubmission.status || {}}
                  onChanged={() =>
                    void inspectSubmission(pendingSubmission.id, true)
                  }
                />
              )}
              {pending.map((a) => (
                <ApprovalCard
                  key={a.params.elicitation?.token || a.id}
                  approval={a}
                />
              ))}
              {s.thread &&
                !s.thread.turns.length &&
                !s.loading &&
                !showSubmission && (
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
                onCloseAutoFocus={restoreWorkbenchFocus}
              />
            </DeferredPanel>
          )}
          <form className="composer" onSubmit={(e) => void send(e)}>
            {attachments.length > 0 && !sending && !pendingSubmission && (
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
                          disabled={uploading || sending || !!s.pendingRun}
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
            {!s.selectedId && !sending && !pendingSubmission && (
              <CapabilityRow
                items={[
                  ...(selectedExpert
                    ? [
                        {
                          id: `expert:${selectedExpert.id}`,
                          content: (
                            <>
                              <button
                                type="button"
                                className="capability-label"
                                onClick={() => setExpertDetail(selectedExpert)}
                              >
                                <UsersRound size={15} />
                                {selectedExpert.name}
                              </button>
                              <button
                                type="button"
                                aria-label="移除会话专家"
                                disabled={selectionDisabled}
                                onClick={() =>
                                  void chooseExpert(null).catch(s.notify)
                                }
                              >
                                <X size={14} />
                              </button>
                            </>
                          ),
                        },
                      ]
                    : []),
                  ...selectedPlugins.map((p) => ({
                    id: `plugin:${p.id}`,
                    content: (
                      <>
                        <span className="capability-label">
                          <Blocks size={15} />
                          {p.displayName || p.name}
                        </span>
                        <button
                          type="button"
                          aria-label={`移除插件 ${p.displayName || p.name}`}
                          disabled={selectionDisabled}
                          onClick={() =>
                            void saveInputs(
                              composer.key,
                              selectedSkills,
                              selectedPlugins.filter((v) => v.id !== p.id),
                            ).catch(s.notify)
                          }
                        >
                          <X size={14} />
                        </button>
                      </>
                    ),
                  })),
                  ...selectedSkills.map((skill) => ({
                    id: `skill:${skill.id}`,
                    content: (
                      <>
                        <span className="capability-label">
                          <BookOpen size={15} />
                          {skill.displayName || skill.name || "名称暂不可用"}
                        </span>
                        <button
                          type="button"
                          aria-label={`移除技能 ${skill.displayName || skill.name || "名称暂不可用"}`}
                          disabled={selectionDisabled}
                          onClick={() =>
                            void saveInputs(
                              composer.key,
                              selectedSkills.filter((v) => v.id !== skill.id),
                              selectedPlugins,
                            ).catch(s.notify)
                          }
                        >
                          <X size={14} />
                        </button>
                      </>
                    ),
                  })),
                ]}
              />
            )}
            {expertDetail && (
              <DeferredPanel
                label="专家详情"
                onClose={() => setExpertDetail(null)}
              >
                <ExpertDetails
                  value={expertDetail}
                  onClose={() => setExpertDetail(null)}
                />
              </DeferredPanel>
            )}
            {mentions.menu}
            <textarea
              ref={textarea}
              id="message-input"
              aria-label="消息"
              placeholder="询问任何问题"
              rows={1}
              value={sending || pendingSubmission ? "" : draft}
              readOnly={sending || !!pendingSubmission}
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
                    disabled={uploading || sending || !!s.pendingRun}
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
                        onSelect={openWorkspaceFiles}
                      >
                        添加工作区文件
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={Blocks}
                        separated
                        disabled={
                          selectionDisabled ||
                          (!s.pluginSelection && !s.expertSelection)
                        }
                        onSelect={() =>
                          openComposerCapability(
                            "plugins",
                            document.getElementById("composer-add"),
                          )
                        }
                      >
                        选择专家或插件
                      </ActionMenuItem>
                      <ActionMenuItem
                        icon={BookOpen}
                        disabled={selectionDisabled || !s.skillSelection}
                        onSelect={() =>
                          openComposerCapability(
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
                <>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="选择专家或插件"
                    data-composer-picker
                    title="选择专家或插件"
                    disabled={
                      selectionDisabled ||
                      (!s.pluginSelection && !s.expertSelection)
                    }
                    onClick={(e) =>
                      openComposerCapability("plugins", e.currentTarget)
                    }
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
                      onClick={(e) =>
                        openComposerCapability("skills", e.currentTarget)
                      }
                    >
                      <BookOpen size={17} aria-hidden="true" />
                    </button>
                  )}
                </>
              </div>
              <RuntimeSelector
                onBusy={setRuntimeBusy}
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
                  disabled={
                    !activeTurn ||
                    !s.connected ||
                    stopTask.disabled ||
                    s.loading ||
                    !!s.threadError
                  }
                  onClick={() => void stopTask.stop()}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : sending || pendingSubmission ? (
                <button
                  type="button"
                  className="send-button is-submitting"
                  disabled
                  aria-label="正在发送，等待确认"
                  title="正在发送，确认后可停止回答"
                >
                  <span className="submission-stop">
                    <Square size={13} fill="currentColor" />
                    <LoaderCircle size={27} className="spin" />
                  </span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={
                    (!draft.trim() && !attachments.length) ||
                    expertBusy ||
                    inputsBusy ||
                    runtimeBusy ||
                    !!s.pendingRun ||
                    sending ||
                    uploading ||
                    attachments.some((a) => !!a.state) ||
                    !s.connected ||
                    !s.settings ||
                    s.runtime !== "ready" ||
                    s.loading ||
                    !!s.threadError
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
        </div>
      </main>
      {railOpen &&
        s.selectedId &&
        !(
          panelLayout.overlay &&
          (settings ||
            search ||
            rename ||
            attachmentPreview ||
            workspacePicker ||
            expertDetail ||
            privateAccess)
        ) && (
          <>
            <WorkbenchRail
              width={panelLayout.right}
              narrow={panelLayout.overlay}
              capabilityFocus={railCapabilityFocus}
              onClose={() => setRailOpen(false)}
              restoreFocus={() => {
                const action = afterRailClose.current;
                afterRailClose.current = null;
                const trigger = capabilityReturnFocus.current;
                capabilityReturnFocus.current = null;
                if (action) requestAnimationFrame(action);
                else
                  (trigger?.isConnected
                    ? trigger
                    : railToggle.current
                  )?.focus();
              }}
              thread={s.thread || undefined}
              busy={selectionDisabled}
              expert={selectedExpert || undefined}
              onExpert={() => {
                afterRailClose.current = () => setExpertDetail(selectedExpert);
                setRailOpen(false);
              }}
              onRemoveExpert={() => void chooseExpert(null).catch(s.notify)}
              canPickPlugins={s.pluginSelection || s.expertSelection}
              canPickSkills={s.skillSelection}
              onAdd={(kind) => {
                afterRailClose.current = () =>
                  mentions.open(kind, railToggle.current);
                setRailOpen(false);
              }}
              onPickFiles={openWorkspaceFiles}
              onOpenArtifact={(artifact) => {
                rememberWorkbenchFocus();
                setRailArtifact(artifact);
              }}
              onRemove={(kind, id) => {
                const current = s.thread?.nextInput;
                if (!current || !s.selectedId) return;
                const skills =
                  kind === "skills"
                    ? current.skills.filter((x) => x.id !== id)
                    : current.skills;
                const plugins =
                  kind === "plugins"
                    ? current.plugins.filter((x) => x.id !== id)
                    : current.plugins;
                void saveInputs(s.selectedId, skills, plugins).catch(s.notify);
              }}
            />
          </>
        )}
      {railArtifact && (
        <Suspense fallback={null}>
          <ArtifactPreview
            artifact={railArtifact}
            onClose={() => setRailArtifact(null)}
            onCloseAutoFocus={restoreWorkbenchFocus}
          />
        </Suspense>
      )}
      <Modal
        open={search}
        onOpenChange={setSearch}
        title="搜索聊天"
        className="chat-search-modal"
      >
        <div className="search-input">
          <Search size={19} />
          <input
            autoFocus
            data-autofocus
            placeholder="搜索对话名称…"
            aria-label="搜索对话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ReadIndicator busy={s.threadsLoading} label="正在读取对话" />
        </div>
        <div className="search-results" aria-busy={s.threadsLoading}>
          {s.threads
            .filter((t) =>
              t.title
                .normalize("NFKC")
                .toLocaleLowerCase()
                .includes(query.trim().normalize("NFKC").toLocaleLowerCase()),
            )
            .map((t) => (
              <button key={t.id} onClick={() => chooseThread(t.id)}>
                <MessageSquare size={17} aria-hidden="true" />
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
            ) && (
              <p className="muted">
                {query.trim() ? "没有找到匹配的对话" : "还没有对话"}
              </p>
            )}
        </div>
        <div className="search-feedback" aria-live="polite">
          {s.threadsError && (
            <p role="alert" className="inline-error">
              {s.threadsError}
              <button onClick={() => void loadThreads().catch(() => {})}>
                重试
              </button>
            </p>
          )}
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
            onUse={async (kind, entry, signal) => {
              const current = useApp.getState();
              if (
                !current.connected ||
                current.loading ||
                current.runtime !== "ready" ||
                sending ||
                inputsRequest.current ||
                expertRequest.current
              )
                throw new Error("当前会话暂不可修改，请稍后重试");
              await selectCapability(kind, entry, null, signal);
              if (!signal.aborted) {
                setSettings(null);
                requestAnimationFrame(() => textarea.current?.focus());
              }
            }}
          />
        </DeferredPanel>
      )}
    </div>
  );
}
