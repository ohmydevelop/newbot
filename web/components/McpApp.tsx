import { useEffect, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  McpUiHostContextSchema,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { LockKeyhole, LoaderCircle, RefreshCw, X } from "lucide-react";
import { request, useApp } from "../store";
import type { Json } from "../../shared/types";
import { appIssue } from "../../shared/mcp-apps";
import { appHostCapabilities } from "../../shared/mcp-app-host";
import { restrictAppHost } from "./mcp-app-host";
import { acquireAppConsent, hasAppConsent } from "./app-consent";
import { Modal } from "./ui";
type Phase =
  | "loading"
  | "initializing"
  | "ready"
  | "failed"
  | "expired"
  | "closed";
type Approval = {
  grant: string;
  server: string;
  tool: string;
  args: Json;
  resolve: (allow: boolean) => void;
  deadline: number;
  timedOut?: boolean;
};
type Session = {
  active: boolean;
  id: string;
  token?: string;
  abort: AbortController;
  bridge?: AppBridge;
  approval: Approval | null;
  calling: boolean;
  cleanups: (() => void)[];
  dispose: () => void;
  fail: (phase: "failed" | "expired", message: string) => void;
};
export default function McpApp({
  threadId,
  itemId,
  turnId,
  server,
  tool,
}: {
  threadId: string;
  itemId: string;
  turnId?: string;
  server?: string;
  tool?: string;
}) {
  const lifecycle = useApp((s) => s.appLifecycle),
    runtime = useApp((s) => s.runtime),
    frame = useRef<HTMLIFrameElement>(null),
    container = useRef<HTMLElement>(null),
    reopenButton = useRef<HTMLButtonElement>(null),
    focusNext = useRef(false),
    session = useRef<Session | null>(null);
  const [attempt, setAttempt] = useState(0),
    [opened, setOpened] = useState(true),
    [phase, setPhase] = useState<Phase>("loading"),
    [data, setData] = useState<Json | null>(null),
    [message, setMessage] = useState(""),
    [notice, setNotice] = useState(""),
    [approval, setApproval] = useState<Approval | null>(null);
  function issueMessage(error: unknown) {
    const issue = appIssue((error as { appIssue?: unknown })?.appIssue);
    return issue?.code === "expired"
      ? "应用已关闭或过期，请重新打开。"
      : issue?.code === "limit"
        ? "打开的应用过多，请关闭一些应用后重试。"
        : issue?.code === "busy"
          ? "配置正在更新或应用仍在加载，请稍后重新打开。"
          : issue?.code === "history"
            ? "原始工具结果暂不可读，请重新加载对应历史后打开。"
            : issue?.code === "permission"
              ? "当前连接不再允许此应用操作，请检查 MCP 配置后重新打开。"
              : issue?.code === "runtime"
                ? "Codex 暂不可用，恢复连接后可重新打开。"
                : issue?.code === "resource"
                  ? "应用资源读取失败，请检查 MCP 连接后重试。"
                  : "应用连接失败，请检查网络或 MCP 连接后重新打开。";
  }
  useEffect(() => {
    if (!opened) return;
    setData(null);
    setMessage("");
    setNotice("");
    setApproval(null);
    setPhase("loading");
    const s: Session = {
      active: true,
      id: crypto.randomUUID(),
      abort: new AbortController(),
      approval: null,
      calling: false,
      cleanups: [],
      dispose: () => {},
      fail: () => {},
    };
    session.current = s;
    s.dispose = () => {
      if (!s.active) return;
      s.active = false;
      s.abort.abort();
      s.approval?.resolve(false);
      s.approval = null;
      for (const cleanup of s.cleanups) cleanup();
      void s.bridge?.close().catch(() => {});
      if (lifecycle)
        void request(
          "app/close",
          { requestId: s.id, ...(s.token ? { token: s.token } : {}) },
          { keepalive: true },
        ).catch(() => {});
    };
    s.fail = (next, text) => {
      if (!s.active) return;
      const shouldFocus =
        document.activeElement === frame.current ||
        !!s.approval ||
        (focusNext.current && document.activeElement === document.body);
      s.dispose();
      setData(null);
      setApproval(null);
      setMessage(text);
      setPhase(next);
      if (shouldFocus)
        requestAnimationFrame(() => reopenButton.current?.focus());
    };
    const timeout = setTimeout(
      () => s.fail("failed", "应用资源加载超时，可以重新打开。"),
      15000,
    );
    s.cleanups.push(() => clearTimeout(timeout));
    const pagehide = () => s.dispose();
    window.addEventListener("pagehide", pagehide);
    s.cleanups.push(() => window.removeEventListener("pagehide", pagehide));
    void request<Json>(
      "app/open",
      {
        threadId,
        itemId,
        ...(lifecycle
          ? { requestId: s.id, ...(turnId ? { turnId } : {}) }
          : {}),
      },
      { signal: s.abort.signal },
    )
      .then((result) => {
        if (!s.active) {
          if (lifecycle)
            void request(
              "app/close",
              {
                requestId: s.id,
                ...(result.token ? { token: result.token } : {}),
              },
              { keepalive: true },
            ).catch(() => {});
          return;
        }
        clearTimeout(timeout);
        if (
          lifecycle &&
          (!result.source ||
            result.source.threadId !== threadId ||
            result.source.itemId !== itemId ||
            (turnId && result.source.turnId !== turnId))
        ) {
          s.fail("failed", "应用结果关联未确认，请重新打开。");
          return;
        }
        s.token = result.token;
        setData({ ...result, attemptId: s.id });
        setPhase("initializing");
        const deadline =
          typeof result.expiresAt === "number"
            ? result.expiresAt
            : Date.now() + 900000;
        const expire = setTimeout(
          () => s.fail("expired", "应用已过期，重新打开会重新校验权限。"),
          Math.max(0, deadline - Date.now()),
        );
        s.cleanups.push(() => clearTimeout(expire));
        if (lifecycle) {
          let checking = false;
          const check = async () => {
            if (!s.active || checking || document.visibilityState === "hidden")
              return;
            checking = true;
            try {
              await request(
                "app/status",
                { token: s.token },
                { signal: s.abort.signal },
              );
            } catch (error) {
              if (s.active)
                s.fail(
                  appIssue((error as any)?.appIssue)?.code === "expired"
                    ? "expired"
                    : "failed",
                  issueMessage(error),
                );
            } finally {
              checking = false;
            }
          };
          const interval = setInterval(() => void check(), 15000),
            focus = () => void check();
          window.addEventListener("focus", focus);
          window.addEventListener("online", focus);
          s.cleanups.push(() => {
            clearInterval(interval);
            window.removeEventListener("focus", focus);
            window.removeEventListener("online", focus);
          });
        }
      })
      .catch((error) => {
        if (s.active)
          s.fail(
            appIssue((error as any)?.appIssue)?.code === "expired"
              ? "expired"
              : "failed",
            issueMessage(error),
          );
      });
    return () => s.dispose();
  }, [threadId, itemId, turnId, attempt, opened, lifecycle]);
  useEffect(() => {
    const show = (event: PageTransitionEvent) => {
      if (
        event.persisted &&
        opened &&
        session.current &&
        !session.current.active
      ) {
        setData(null);
        setApproval(null);
        setPhase("expired");
        setMessage("页面已恢复，请重新打开应用以校验连接。");
      }
    };
    window.addEventListener("pageshow", show);
    return () => window.removeEventListener("pageshow", show);
  }, [opened]);
  useEffect(() => {
    const s = session.current;
    if (s?.active && s.token && runtime === "offline")
      s.fail("expired", "Codex 连接已重置，恢复连接后请重新打开应用。");
  }, [runtime]);
  useEffect(() => {
    const s = session.current;
    if (!data || !frame.current || !s?.active || data.attemptId !== s.id)
      return;
    const iframe = frame.current,
      bridge = new AppBridge(
        null,
        { name: "Minimal Agent", version: "0.2.0" },
        appHostCapabilities(Array.isArray(data.tools) && data.tools.length > 0),
        { hostContext: appHostContext() },
      );
    s.bridge = bridge;
    const fail = () =>
      s.fail(
        "failed",
        "应用未完成初始化，请检查是否使用标准 MCP Apps 协议并内联全部依赖。",
      );
    const timeout = setTimeout(fail, 15000);
    s.cleanups.push(() => clearTimeout(timeout));
    const theme = new MutationObserver(() => {
      if (s.active) bridge.setHostContext(appHostContext());
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    s.cleanups.push(() => theme.disconnect());
    bridge.oninitialized = () => {
      void (async () => {
        await bridge.sendToolInput({ arguments: data.input });
        await bridge.sendToolResult(data.result);
        if (s.active) {
          clearTimeout(timeout);
          setPhase("ready");
          if (
            focusNext.current &&
            (document.activeElement === document.body ||
              container.current?.contains(document.activeElement))
          ) {
            frame.current?.focus();
          }
          focusNext.current = false;
        }
      })().catch(() => {
        if (s.active) fail();
      });
    };
    bridge.onsizechange = ({ height }) => {
      if (s.active && height && frame.current)
        frame.current.style.height = `${Math.max(120, Math.min(height, 650))}px`;
    };
    bridge.oncalltool = async (params, extra) => {
      if (!s.active) throw Error("应用已关闭");
      if (s.calling) throw Error("请先完成当前应用操作");
      if (extra.mcpReq.signal.aborted) throw Error("应用请求已取消");
      const release = acquireAppConsent();
      if (!release) {
        setNotice("另一个应用正在等待授权，请先处理当前授权后再试。");
        throw Error("另一个应用正在等待授权");
      }
      s.calling = true;
      setNotice("");
      let grant: string | undefined;
      let approved = false;
      const cancel = () => {
        release();
        if (s.approval?.grant === grant && s.approval) {
          s.approval.resolve(false);
          s.approval = null;
          setApproval(null);
        }
        if (s.active)
          setNotice(
            approved
              ? "应用已取消等待；已批准的工具调用可能继续执行。"
              : "本次应用请求已取消，未执行工具。",
          );
      };
      extra.mcpReq.signal.addEventListener("abort", cancel, { once: true });
      s.cleanups.push(release);
      try {
        const result = await request<Json>(
          "app/call/request",
          {
            token: data.token,
            tool: params.name,
            arguments: params.arguments || {},
          },
          { signal: s.abort.signal },
        );
        grant = result.grant;
        if (!s.active || extra.mcpReq.signal.aborted) {
          if (lifecycle)
            void request(
              "app/call/cancel",
              { grant },
              { keepalive: true },
            ).catch(() => {});
          throw Error("应用已关闭");
        }
        let decision: Approval | undefined;
        const allow = await new Promise<boolean>((resolve) => {
          const pending = {
            grant: grant!,
            server: result.server,
            tool: result.tool,
            args: params.arguments || {},
            resolve,
            deadline:
              typeof result.expiresAt === "number"
                ? result.expiresAt
                : Date.now() + 120000,
          };
          decision = pending;
          s.approval = pending;
          setApproval(pending);
        });
        if (!s.active || extra.mcpReq.signal.aborted)
          throw Error("应用请求已关闭或取消");
        if (decision?.timedOut)
          throw Object.assign(new Error("授权已过期"), {
            appIssue: { code: "approval_expired" },
          });
        s.approval = null;
        setApproval(null);
        release();
        approved = allow;
        return await request(
          "app/call/approve",
          { grant, allow },
          { signal: s.abort.signal },
        );
      } catch (error) {
        const code = appIssue((error as any)?.appIssue)?.code;
        if (s.active && !extra.mcpReq.signal.aborted) {
          if (code === "expired") s.fail("expired", issueMessage(error));
          else
            setNotice(
              code === "approval_expired"
                ? "授权已过期，请在应用中重新发起操作。"
                : code === "permission"
                  ? "本次工具调用未获允许。"
                  : "应用工具调用失败，可检查连接后重试。",
            );
        }
        throw Error("应用工具调用未完成");
      } finally {
        extra.mcpReq.signal.removeEventListener("abort", cancel);
        release();
        s.cleanups = s.cleanups.filter((cleanup) => cleanup !== release);
        if (grant && lifecycle)
          void request("app/call/cancel", { grant }, { keepalive: true }).catch(
            () => {},
          );
        s.calling = false;
      }
    };
    restrictAppHost(bridge, () => s.active, setNotice);
    bridge.onerror = () => {
      if (s.active) fail();
    };
    void bridge
      .connect(
        new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
      )
      .then(() => {
        if (s.active) iframe.src = data.url;
      })
      .catch(() => {
        if (s.active) fail();
      });
    return () => {
      clearTimeout(timeout);
      theme.disconnect();
      void bridge.close().catch(() => {});
    };
  }, [data]);
  useEffect(() => {
    if (!approval) return;
    const timer = setTimeout(
      () => {
        const s = session.current;
        if (s?.approval === approval) {
          s.approval = null;
          approval.timedOut = true;
          approval.resolve(false);
          setApproval(null);
          setNotice("授权等待已超时，请在应用中重新发起操作。");
        }
      },
      Math.max(0, approval.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [approval]);
  function answer(allow: boolean) {
    const s = session.current,
      pending = s?.approval;
    if (pending) {
      s!.approval = null;
      setApproval(null);
      pending.resolve(allow);
    }
  }
  function close() {
    session.current?.dispose();
    setApproval(null);
    setData(null);
    setOpened(false);
    setMessage("");
    setPhase("closed");
    focusNext.current = false;
    requestAnimationFrame(() => reopenButton.current?.focus());
  }
  function reopen() {
    focusNext.current = true;
    setOpened(true);
    setAttempt((value) => value + 1);
  }
  const labels: Record<Phase, string> = {
    loading: "正在读取应用资源",
    initializing: "正在初始化应用",
    ready: "已连接 · 隔离运行",
    failed: "应用加载失败",
    expired: "应用已失效",
    closed: "应用已关闭",
  };
  return (
    <section
      ref={container}
      className="mcp-app"
      aria-label={`MCP 应用 ${server || data?.source?.server || ""} / ${tool || data?.source?.tool || ""}`}
      aria-busy={phase === "loading" || phase === "initializing"}
    >
      <div className="app-bar">
        <span>
          <LockKeyhole size={14} aria-hidden="true" />
          MCP App
        </span>
        <span role="status">{labels[phase]}</span>
        {opened && (
          <button
            className="app-close"
            onClick={close}
            aria-label="关闭应用"
            title="关闭应用；已经批准的调用可能继续执行"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {(server || data?.source?.server) && (
        <p className="app-source">
          {server || data?.source?.server} / {tool || data?.source?.tool} ·
          原始工具结果
        </p>
      )}
      <details className="app-capabilities">
        <summary>权限与能力</summary>
        <div>
          <p>每次工具操作都需要你的单次批准，执行前会再次检查权限。</p>
          <dl>
            <dt>工具范围</dt>
            <dd>
              {data ? (
                data.tools?.length ? (
                  <>
                    仅限当前 MCP 服务中与此应用关联的工具：
                    {data.tools.slice(0, 12).join("、")}
                    {data.tools.length > 12
                      ? ` 等 ${data.tools.length} 项`
                      : ""}
                    。此列表对应本次打开时的权限。
                  </>
                ) : (
                  "本次打开时没有可申请的工具。"
                )
              ) : (
                "打开应用后可查看可申请的工具。"
              )}
            </dd>
            <dt>显示</dt>
            <dd>聊天内嵌、主题同步与高度调整；暂不支持全屏或画中画。</dd>
            <dt>未开放</dt>
            <dd>
              外链、应用下载、发送聊天消息、更新模型上下文、调用模型、查询工具目录、提示模板或读取额外
              MCP 资源。
            </dd>
            <dt>隔离</dt>
            <dd>
              不允许页面联网、加载外部依赖或使用摄像头、麦克风和定位；不采集应用日志。
            </dd>
          </dl>
        </div>
      </details>
      {(phase === "loading" || phase === "initializing") && (
        <div className="app-loading" role="status">
          <LoaderCircle size={17} className="spin" aria-hidden="true" />
          {labels[phase]}…
        </div>
      )}
      {data && opened && (phase === "ready" || phase === "initializing") && (
        <iframe
          ref={frame}
          title="MCP 应用"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: 280 }}
          onError={() =>
            session.current?.fail("failed", "应用页面未能加载，请重新打开。")
          }
        />
      )}
      {(phase === "failed" || phase === "expired") && (
        <div className="app-recovery">
          <p className="inline-error" role="alert">
            {message}
          </p>
          <button ref={reopenButton} className="secondary" onClick={reopen}>
            <RefreshCw size={15} aria-hidden="true" />
            重新打开应用
          </button>
        </div>
      )}
      {phase === "closed" && (
        <div className="app-recovery">
          <p className="muted">重新打开会读取原工具结果，并重新校验权限。</p>
          <button ref={reopenButton} className="secondary" onClick={reopen}>
            打开交互应用
          </button>
        </div>
      )}
      {notice && opened && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      <Modal
        open={!!approval}
        onOpenChange={(value) => {
          if (!value) answer(false);
        }}
        className="mcp-approval-modal"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const active = document.activeElement;
          if (
            !hasAppConsent() &&
            (!active ||
              active === document.body ||
              active.closest(".mcp-approval-modal"))
          )
            (session.current?.active
              ? frame.current
              : reopenButton.current
            )?.focus();
        }}
        title="允许应用调用工具？"
        description="这次操作由应用发起，不会再次调用模型。"
      >
        <p>
          {approval?.server} / {approval?.tool}
        </p>
        <pre className="approval-detail">
          {JSON.stringify(approval?.args, null, 2)}
        </pre>
        <div className="modal-actions">
          <button onClick={close}>关闭应用并取消授权</button>
          <button onClick={() => answer(false)}>拒绝</button>
          <button className="primary" onClick={() => answer(true)}>
            仅允许这一次
          </button>
        </div>
      </Modal>
    </section>
  );
}
function appHostContext(): McpUiHostContext {
  const style = getComputedStyle(document.documentElement);
  return McpUiHostContextSchema.parse({
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    locale: "zh-CN",
    platform: "web",
    styles: {
      variables: {
        "--color-background-primary": style.getPropertyValue("--bg").trim(),
        "--color-background-secondary": style
          .getPropertyValue("--surface")
          .trim(),
        "--color-text-primary": style.getPropertyValue("--text").trim(),
        "--color-text-secondary": style.getPropertyValue("--muted").trim(),
        "--font-sans": style.fontFamily,
      },
    },
  });
}
