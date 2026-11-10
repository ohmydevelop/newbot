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
  Blocks,
  BookOpen,
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
const McpSettings = lazy(() => import("./ToolsSettings"));
const ProviderSettings = lazy(() => import("./ProviderSettings"));
const SkillsSettings = lazy(() => import("./SkillsSettings"));
const StorageSettings = lazy(() => import("./StorageSettings"));
const SudoSettings = lazy(() => import("./SudoSettings"));
const tabs = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "models", label: "模型网关", icon: Cpu },
  { id: "mcp", label: "工具连接", icon: Blocks },
  { id: "skills", label: "技能", icon: BookOpen },
  { id: "storage", label: "文件存储", icon: HardDrive },
  { id: "security", label: "安全与运行", icon: Shield },
];
export default function Settings({
  open,
  onOpenChange,
  initialTab = "general",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: string;
}) {
  const s = useApp();
  const contentId = useId();
  const [tab, setTab] = useState(initialTab === "plugins" ? "mcp" : initialTab);
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
      title="设置"
      wide
      className="settings-modal"
    >
      <div className="settings-layout">
        <nav aria-label="设置分类">
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
                <t.icon size={20} strokeWidth={1.8} aria-hidden="true" />
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
              <h3>通用</h3>
              <div className="setting-row">
                <div>
                  <strong>外观</strong>
                </div>
                <select
                  aria-label="外观"
                  value={s.theme}
                  onChange={(e) => s.set({ theme: e.target.value })}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>语言</strong>
                </div>
                <span className="muted">简体中文</span>
              </div>
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
                      : "Ctrl K 搜索 · Ctrl Shift O 新聊天"}
                  </p>
                  <p>
                    弹窗内使用 Tab 切换、Escape 返回；输入法选字时不会发送。
                  </p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>私有工作台</strong>
                  <p>对话由你的 Codex 实例持久化保存</p>
                </div>
                <span className="small-mark">Minimal Agent</span>
              </div>
            </>
          )}
          {tab === "models" && (
            <Suspense fallback={<p role="status">正在加载模型网关…</p>}>
              <ProviderSettings />
            </Suspense>
          )}
          {tab === "mcp" &&
            (s.mcpManagement ? (
              <Suspense fallback={<p role="status">正在加载 MCP…</p>}>
                <McpSettings />
              </Suspense>
            ) : (
              <>
                <div className="section-heading">
                  <h3>工具连接</h3>
                  <button
                    className="icon-button"
                    aria-label="刷新 MCP"
                    disabled={!!busy}
                    onClick={() =>
                      void action("mcp", async () => {
                        await request("mcp/reload");
                        await loadSettings();
                      })
                    }
                  >
                    <RefreshCw
                      size={17}
                      className={busy === "mcp" ? "spin" : ""}
                    />
                  </button>
                </div>
                <p className="muted">
                  复用 Codex 管理的连接、工具和 OAuth 授权。
                </p>
                {s.settings?.mcp.length === 0 && (
                  <div className="empty-settings">
                    <Blocks size={28} />
                    <strong>尚未添加工具连接</strong>
                    <p>
                      在 Codex config.toml 的 mcp_servers 中添加连接，然后刷新。
                    </p>
                  </div>
                )}
                {s.settings?.mcp.map((server: Json) => (
                  <div className="inventory-row" key={server.name}>
                    <div className="inventory-icon">
                      <Blocks size={18} />
                    </div>
                    <div>
                      <strong>{server.name}</strong>
                      <p>
                        {server.toolCount ??
                          Object.keys(server.tools || {}).length}{" "}
                        个工具 · {server.authStatus}
                      </p>
                      {server.toolsError && (
                        <p className="inline-error">{server.toolsError}</p>
                      )}
                    </div>
                    {server.authStatus === "notLoggedIn" ? (
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void action(server.name, async () => {
                            const r = await request("mcp/oauth", {
                              name: server.name,
                            });
                            if (r.authorizationUrl) {
                              const u = new URL(r.authorizationUrl);
                              if (
                                u.protocol === "https:" ||
                                u.protocol === "http:"
                              )
                                window.open(
                                  u.href,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                            }
                            setNotice("完成授权后点击刷新");
                          })
                        }
                      >
                        连接
                      </button>
                    ) : (
                      <span className="badge">
                        {server.runtimeStatus || "已发现"}
                      </span>
                    )}
                  </div>
                ))}
                <p className="footnote">
                  MCP Apps 在工具调用返回 UI
                  资源后显示在对话中。当前仅允许内联依赖，应用网络默认关闭。
                </p>
              </>
            ))}
          {tab === "skills" && (
            <Suspense fallback={<p role="status">正在加载技能设置…</p>}>
              <SkillsSettings />
            </Suspense>
          )}
          {tab === "security" && (
            <>
              <h3>安全与运行</h3>
              <div className="setting-row">
                <div>
                  <strong>运行内核</strong>
                  <p>Codex</p>
                </div>
                <span className="badge">
                  {s.runtime === "ready" ? "已连接" : s.runtime}
                </span>
              </div>
              <div className="setting-row">
                <div>
                  <strong>执行策略</strong>
                  <p>{approvalLabels[s.thread?.runtime?.approval || "ask"]}</p>
                </div>
                <Shield size={17} />
              </div>
              <div className="setting-row">
                <div>
                  <strong>断线恢复</strong>
                  <p>关闭浏览器不会中断后台任务；进程重启后需重新确认状态。</p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>工作目录</strong>
                  <p className="path">{s.settings?.cwd || "—"}</p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>私密输入</strong>
                  <p>
                    {s.credentialManagement
                      ? "凭证由服务端保存，原值不可回读。"
                      : s.credentialProbe
                        ? "可临时验证 API Key，用后丢弃，不保存。"
                        : "凭证请在服务端配置，私密输入暂不可用。"}
                  </p>
                </div>
              </div>
              {s.sudoIdentity?.available && (
                <Suspense fallback={<p role="status">正在加载受控检查…</p>}>
                  <SudoSettings />
                </Suspense>
              )}
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
