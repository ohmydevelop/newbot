import { AppearanceIcon, BehaviorIcon, DataIcon } from "./SettingsIcons";
import { GatewayIcon } from "./AppIcons";
import { PluginIcon as Blocks, SkillIcon as BookOpen } from "./AppIcons";
import { approvalLabels } from "../../shared/runtime-settings";
import { lazy, Suspense, useState, useId } from "react";
import {
  Check,
  ChevronRight,
  ExternalLink,
  Monitor,
  Moon,
  Sun,
  RefreshCw,
  AtSign,
  SlidersHorizontal,
  Shield,
  LogOut,
  LoaderCircle,
  Cpu,
  HardDrive,
} from "lucide-react";
import type { Json, Model } from "../../shared/types";
import { useApp, loadSettings, request, disconnect, newChat } from "../store";
import { Modal } from "./ui";
const ExtensionsSettings = lazy(() => import("./ExtensionsSettings"));
const ProviderSettings = lazy(() => import("./ProviderSettings"));
const StorageSettings = lazy(() => import("./StorageSettings"));
const SudoSettings = lazy(() => import("./SudoSettings"));
const tabs = [
  { id: "general", label: "外观", icon: AppearanceIcon },
  { id: "behavior", label: "操作", icon: BehaviorIcon },
  { id: "models", label: "模型服务", icon: GatewayIcon },
  { id: "storage", label: "存储", icon: DataIcon },
  { id: "security", label: "安全", icon: Shield },
];
export default function Settings({
  open,
  onOpenChange,
  initialTab = "general",
  onUse,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: string;
  onUse?: (kind: "$" | "@", entry: Json, signal: AbortSignal) => Promise<void>;
}) {
  const s = useApp();
  const contentId = useId();
  const pluginsOnly = [
    "plugins",
    "mcp",
    "skills",
    "experts",
    "connectors",
  ].includes(initialTab);
  const [tab, setTab] = useState(
    ["plugins", "mcp", "skills", "experts", "connectors"].includes(initialTab)
      ? "extensions"
      : initialTab,
  );
  const [pluginLocked, setPluginLocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function action(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      s.notify(e);
    } finally {
      setBusy("");
    }
  }
  const model = s.settings?.models.find((m: Model) => m.model === s.model);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={pluginsOnly ? "插件" : "设置"}
      wide
      dismissible={!pluginLocked}
      className={`settings-modal ${pluginsOnly ? "plugins-modal" : ""}`}
    >
      <div className="settings-layout">
        <nav aria-label="设置分类" hidden={pluginsOnly}>
          {tabs
            .filter((t) => t.id !== "storage" || s.storageManagement)
            .map((t) => (
              <button
                className={tab === t.id ? "selected" : ""}
                key={t.id}
                aria-current={tab === t.id ? "page" : undefined}
                aria-controls={contentId}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={16} strokeWidth={2} aria-hidden="true" />
                {t.label}
              </button>
            ))}
        </nav>
        <section
          className="settings-content"
          id={contentId}
          aria-label={tabs.find((t) => t.id === tab)?.label}
        >
          {tab === "storage" && s.storageManagement && (
            <Suspense fallback={<p role="status">正在加载存储设置…</p>}>
              <StorageSettings />
            </Suspense>
          )}
          {tab === "general" && (
            <>
              <h3>外观</h3>
              <div className="setting-row">
                <div>
                  <strong>主题</strong>
                </div>
                <div className="theme-options" role="group" aria-label="外观">
                  {[
                    { id: "light", label: "浅色", icon: Sun },
                    { id: "dark", label: "深色", icon: Moon },
                    { id: "system", label: "跟随系统", icon: Monitor },
                  ].map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={s.theme === t.id}
                      onClick={() => s.set({ theme: t.id })}
                    >
                      <span
                        className={`theme-preview ${t.id}`}
                        aria-hidden="true"
                      >
                        <span className="mini-window">
                          <span className="mini-nav">
                            <i />
                            <b />
                            <b />
                            <em />
                            <em />
                            <em />
                          </span>
                          <span className="mini-chat">
                            <span className="mini-top" />
                            <span className="mini-user" />
                            <span className="mini-answer">
                              <i />
                              <i />
                              <i />
                            </span>
                            <span className="mini-composer">
                              <b />
                            </span>
                          </span>
                        </span>
                      </span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>语言</strong>
                </div>
                <span className="muted">简体中文</span>
              </div>
            </>
          )}
          {tab === "behavior" && (
            <>
              <h3>操作</h3>{" "}
              <div className="setting-row">
                <div>
                  <strong>消息发送</strong>
                  <p>Enter 发送，Shift + Enter 换行</p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>键盘快捷键</strong>
                  <p>
                    {/Mac|iPhone|iPad/.test(navigator.platform)
                      ? "⌘ K 搜索 · ⌘ Shift O 新聊天"
                      : "Ctrl K 搜索 · Ctrl Shift O 新建聊天"}
                  </p>
                </div>
              </div>
            </>
          )}
          {tab === "models" && (
            <Suspense fallback={<p role="status">正在加载模型服务…</p>}>
              <ProviderSettings />
            </Suspense>
          )}
          {tab === "extensions" && (
            <Suspense fallback={<p role="status">正在加载扩展…</p>}>
              <ExtensionsSettings
                initialTab={initialTab}
                onLocked={setPluginLocked}
                onUse={onUse}
              />
            </Suspense>
          )}

          {tab === "security" && (
            <>
              <h3>安全</h3>
              <div className="setting-row">
                <div>
                  <strong>凭证保护</strong>
                  <p>密钥由服务端加密保存，原值不会回显。</p>
                </div>
              </div>
              <button
                className="settings-logout danger-text"
                onClick={() =>
                  void action("logout", async () => {
                    await fetch("/api/logout", { method: "POST" });
                    disconnect();
                    s.set({
                      authenticated: false,
                      thread: null,
                      threads: [],
                      settings: null,
                    });
                    onOpenChange(false);
                  })
                }
              >
                <LogOut size={16} /> 退出登录
              </button>
            </>
          )}
          {notice && (
            <p className="success-text" role="status">
              <Check size={15} />
              {notice}
            </p>
          )}
          {!!s.settings?.errors?.length && (
            <details className="settings-errors">
              <summary>部分能力读取失败</summary>
              {s.settings.errors.map((e: Json) => (
                <p key={e.section}>
                  {e.section}: {e.message}
                </p>
              ))}
            </details>
          )}
        </section>
      </div>
    </Modal>
  );
}
