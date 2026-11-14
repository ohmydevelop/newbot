import { useEffect, useRef, useState, type FormEvent } from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { ChatCompose, Moon, Sun } from "@openai/apps-sdk-ui/components/Icon";
import { markdownPlugins } from "../markdown-plugins";

const NoControl = () => null;
const lastMessage = (messages: import("@ag-ui/client").Message[]) =>
  messages.slice(-1);
async function api(path: string, body?: unknown) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "连接失败，请重试");
  return data;
}
export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [threadId, setThreadId] = useState<string>();
  const [connection, setConnection] = useState(0);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("newbot-v1-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("newbot-v1-theme", dark ? "dark" : "light");
  }, [dark]);
  async function openChat(fresh = false) {
    const attempt = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const saved = !fresh && localStorage.getItem("newbot-v1-thread");
      const thread = saved
        ? await api(`/api/threads/${encodeURIComponent(saved)}`)
        : await api("/api/v1/threads", {});
      if (attempt !== generation.current) return;
      localStorage.setItem("newbot-v1-thread", thread.id);
      setThreadId(thread.id);
      setConnection(attempt);
    } catch (e) {
      if (attempt === generation.current) setError((e as Error).message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    void api("/api/session")
      .then((session) => {
        if (cancelled) return;
        setAuthenticated(session.authenticated);
        if (session.authenticated) void openChat();
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticated(false);
          setError("连接失败，请重试");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { password });
      setPassword("");
      setAuthenticated(true);
      await openChat();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="newbot-shell">
      <header className="newbot-header">
        <span className="newbot-wordmark">newbot</span>
        <nav aria-label="聊天操作">
          {authenticated && (
            <Button
              color="secondary"
              variant="ghost"
              size="lg"
              disabled={busy}
              onClick={() => void openChat(true)}
            >
              <ChatCompose aria-hidden="true" />
              新建聊天
            </Button>
          )}
          <Button
            color="secondary"
            variant="ghost"
            size="lg"
            uniform
            aria-label={dark ? "切换浅色" : "切换深色"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </nav>
      </header>
      {authenticated === null ? (
        <div className="newbot-loading" role="status">
          正在连接…
        </div>
      ) : !authenticated ? (
        <form className="newbot-login" onSubmit={login}>
          <h1>登录 newbot</h1>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            size="3xl"
            placeholder="密码"
            aria-label="密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <p className="newbot-error" role="alert">
              {error}
            </p>
          )}
          <Button
            color="primary"
            size="3xl"
            type="submit"
            disabled={busy || !password}
          >
            {busy ? "正在登录…" : "登录"}
          </Button>
        </form>
      ) : (
        <>
          {error && (
            <div className="newbot-notice" role="alert">
              <p>{error}</p>
              <Button
                color="secondary"
                variant="outline"
                onClick={() => void openChat()}
              >
                重试
              </Button>
            </div>
          )}
          {threadId ? (
            <CopilotKitProvider
              key={`${threadId}:${connection}`}
              runtimeUrl="/api/copilot"
              agentId="newbot"
              credentials="same-origin"
              enableInspector={false}
              showIntelligenceIndicator={false}
              learning={false}
              messageFilter={lastMessage}
            >
              <CopilotChat
                key={threadId}
                threadId={threadId}
                className="newbot-chat"
                messageView={{
                  assistantMessage: {
                    markdownRenderer: { rehypePlugins: markdownPlugins },
                  },
                }}
                input={{
                  textArea: { "aria-label": "消息" },
                  showDisclaimer: false,
                  disclaimer: NoControl,
                  addMenuButton: NoControl,
                  toolsMenu: [],
                  startTranscribeButton: NoControl,
                }}
                labels={{
                  chatInputPlaceholder: "询问任何问题",
                  welcomeMessageText: "有什么可以帮你？",
                  chatDisclaimerText: "",
                  chatInputToolbarSendButtonLabel: "发送",
                  chatInputToolbarStopButtonLabel: "停止生成",
                  chatConnectingLabel: "正在恢复对话…",
                  chatScrollToBottomLabel: "回到最新消息",
                  assistantMessageToolbarCopyMessageLabel: "复制",
                  userMessageToolbarCopyMessageLabel: "复制",
                  assistantMessageToolbarCopyCodeLabel: "复制代码",
                  assistantMessageToolbarCopyCodeCopiedLabel: "已复制",
                }}
                onError={() => {
                  if (connection === generation.current)
                    setError(
                      "对话连接失败，请重试。已提交的任务不会自动重发。",
                    );
                }}
              />
            </CopilotKitProvider>
          ) : (
            !error && (
              <div className="newbot-loading" role="status">
                正在打开聊天…
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}
