import { useEffect, useRef, useState } from "react";
import type { ReactCatalogComponent } from "@a2ui/react/v0_9";
import type { A2uiView } from "../../../shared/a2ui-chat.js";
import type { A2uiRuntime } from "../../../shared/a2ui-runtime.js";
import { useApp } from "../../store.js";

// Drafts contain ordinary form data. Keep them on the authenticated server,
// outside model context; never place field values in browser storage.
export function useA2uiDraft(
  runtime: A2uiRuntime<ReactCatalogComponent> | null,
  view: A2uiView,
  enabled: boolean,
) {
  const [status, setStatus] = useState("");
  const state = useRef({
    version: 0,
    dirty: false,
    paused: false,
    conflict: false,
    signature: "",
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    flight: undefined as Promise<void> | undefined,
  });
  const latest = useRef({ runtime, view, enabled });
  latest.current = { runtime, view, enabled };
  useEffect(() => {
    clearTimeout(state.current.timer);
    state.current = {
      version: view.draftVersion || 0,
      dirty: false,
      paused: false,
      conflict: false,
      signature: runtime ? JSON.stringify(runtime.values()) : "",
      timer: undefined,
      flight: undefined,
    };
    setStatus(
      view.draft
        ? view.state === "waiting"
          ? "已恢复草稿"
          : "已保留草稿（只读）"
        : "",
    );
    return () => {
      clearTimeout(state.current.timer);
    };
  }, [runtime]);
  async function save(clear = false) {
    const s = state.current;
    clearTimeout(s.timer);
    if (s.flight) {
      await s.flight;
      if (!clear) return;
    }
    const { runtime: r, view: v, enabled: allowed } = latest.current;
    if (
      !r ||
      !allowed ||
      !v.token ||
      s.paused ||
      s.conflict ||
      (!s.dirty && !clear)
    )
      return;
    const values = clear ? {} : r.values(),
      signature = JSON.stringify(values);
    setStatus(clear ? "正在清除草稿…" : "正在保存草稿…");
    const body = {
      id: v.id,
      threadId: v.threadId,
      turnId: v.turnId,
      itemId: v.itemId,
      surfaceId: v.surfaceId,
      revision: v.revision,
      token: v.token,
      expectedVersion: s.version,
      values,
    };
    const flight = (async () => {
      try {
        const response = await fetch("/api/a2ui/draft", {
          method: clear ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
        });
        if (!response.ok) {
          if (response.status === 401)
            useApp.setState({ authenticated: false });
          if (response.status === 409) {
            s.conflict = true;
            throw new Error("草稿已变化，请重载表单后继续；当前输入尚未保存。");
          }
          throw new Error("草稿未保存，请检查连接后点击保存草稿。");
        }
        const receipt = await response.json();
        s.version = receipt.version;
        s.signature = clear ? JSON.stringify(r.values()) : signature;
        s.dirty = !clear && JSON.stringify(r.values()) !== signature;
        if (state.current !== s) return;
        setStatus(
          clear
            ? "已清除已保存的草稿；当前输入保持不变"
            : s.dirty
              ? "有修改尚未保存"
              : "草稿已保存",
        );
        if (s.dirty) s.timer = setTimeout(() => void save(), 450);
      } catch {
        if (state.current === s)
          setStatus(
            s.conflict
              ? "草稿已变化，请重载表单后继续；当前输入尚未保存。"
              : "草稿未保存，请检查连接后点击保存草稿。",
          );
      } finally {
        s.flight = undefined;
      }
    })();
    s.flight = flight;
    await flight;
  }
  function change() {
    const { runtime: r, enabled: allowed } = latest.current;
    const s = state.current;
    if (!r || !allowed || s.paused) return;
    s.dirty = JSON.stringify(r.values()) !== s.signature;
    if (!s.dirty || s.conflict) return;
    setStatus("有修改尚未保存");
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void save(), 450);
  }
  useEffect(() => {
    const flush = () => {
      void save();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
    };
  }, []);
  useEffect(() => {
    if (enabled && state.current.dirty) void save();
  }, [enabled]);
  return {
    status,
    change,
    save,
    async pause() {
      const s = state.current;
      s.paused = true;
      clearTimeout(s.timer);
      await s.flight;
    },
    resume() {
      state.current.paused = false;
    },
    get conflict() {
      return state.current.conflict;
    },
  };
}
