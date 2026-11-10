import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import type { Artifact } from "../../shared/types";
import { artifactEndpoint, artifactFetch } from "../artifacts";
type Grant = { previewId: string; url: string; expiresAt: number };
export default function HtmlPreview({
  artifact,
  onReload,
  onClose,
}: {
  artifact: Artifact;
  onReload: () => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const failHandler = useRef<(message: string) => void>(() => {});
  const [grant, setGrant] = useState<Grant | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let terminal = false;
    let current: Grant | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function revoke(value: Grant) {
      // Finish issuance even if the viewer closes mid-request, then revoke the grant.
      void fetch(
        artifactEndpoint(
          artifact.id,
          `preview/${encodeURIComponent(value.previewId)}`,
        ),
        { method: "DELETE", credentials: "same-origin", keepalive: true },
      ).catch(() => {});
    }
    function fail(message: string) {
      if (!active || terminal) return;
      terminal = true;
      setState("error");
      setError(message);
      clearTimeout(timeout);
      if (current) revoke(current);
    }
    failHandler.current = fail;
    const receive = (event: MessageEvent) => {
      // Only the controlled outer frame can report lifecycle. Inner content messages
      // have a different WindowProxy; arbitrary RPC, chat and MCP messages are ignored.
      if (
        !active ||
        terminal ||
        !current ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "newbot.html-preview" ||
        event.data.previewId !== current.previewId
      )
        return;
      if (event.data.state === "close") {
        closeHandler.current();
      } else if (event.data.state === "loading") {
        setState("loading");
        clearTimeout(timeout);
        timeout = setTimeout(
          () => fail("预览未能完成加载，请重新加载或查看源码"),
          15_000,
        );
      } else if (event.data.state === "ready") {
        setState("ready");
        clearTimeout(timeout);
      } else if (event.data.state === "error")
        fail("预览加载失败或已失效，请重新加载");
    };
    window.addEventListener("message", receive);
    void artifactFetch(artifactEndpoint(artifact.id, "preview"), {
      method: "POST",
    })
      .then((r) => r.json())
      .then((value: Grant) => {
        if (!active) {
          revoke(value);
          return;
        }
        current = value;
        setGrant(value);
        timeout = setTimeout(
          () => fail("预览未能完成加载，请重新加载或查看源码"),
          15_000,
        );
        expiry = setTimeout(
          () => fail("预览已过期，请重新加载"),
          Math.max(0, value.expiresAt - Date.now()),
        );
      })
      .catch((e) => fail((e as Error).message));
    return () => {
      active = false;
      failHandler.current = () => {};
      window.removeEventListener("message", receive);
      clearTimeout(timeout);
      clearTimeout(expiry);
      if (current) revoke(current);
    };
  }, [artifact.id]);
  return (
    <div
      className="html-preview"
      aria-label={`${artifact.name} 运行预览`}
      aria-busy={state === "loading"}
    >
      {grant && state !== "error" && (
        <iframe
          ref={frame}
          src={grant.url}
          title={`${artifact.name} 隔离预览`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'"
          onError={() => failHandler.current("预览无法加载，请重新加载")}
        />
      )}
      {state !== "ready" && (
        <div className="artifact-state html-preview-state">
          {state === "loading" ? (
            <>
              <LoaderCircle size={22} className="spin" aria-hidden="true" />
              <p role="status">正在启动页面预览…</p>
            </>
          ) : (
            <>
              <p role="alert" className="inline-error">
                {error}
              </p>
              <button
                type="button"
                className="secondary artifact-download-button"
                onClick={onReload}
              >
                <RotateCw size={16} aria-hidden="true" />
                重试预览
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
