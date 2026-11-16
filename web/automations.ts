import { useEffect, useState } from "react";
import { responseJson } from "./http";
import { useApp } from "./store";
import type { Automation, AutomationRun } from "../shared/automations";
export async function automationRequest<T = any>(
  path = "",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/automations" + path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal,
  });
  if (response.status === 401) useApp.setState({ authenticated: false });
  const data = await responseJson(response);
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  return data;
}
export function useAutomations(active: boolean) {
  const [tasks, setTasks] = useState<Automation[]>([]),
    [notices, setNotices] = useState<AutomationRun[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const data = await automationRequest("", undefined, controller.signal);
        if (controller.signal.aborted) return;
        setTasks((previous) =>
          previous.length === data.tasks.length &&
          previous.every((v, i) => {
            const n = data.tasks[i];
            return (
              v.id === n.id &&
              v.revision === n.revision &&
              v.threadId === n.threadId &&
              v.nextRun === n.nextRun &&
              v.activeRuns === n.activeRuns &&
              v.unread === n.unread
            );
          })
            ? previous
            : data.tasks,
        );
        setNotices((previous) =>
          JSON.stringify(previous) === JSON.stringify(data.notices)
            ? previous
            : data.notices,
        );
        setError("");
        setLoaded(true);
        if (
          localStorage.getItem("newbot:automation-browser-notifications") ===
            "1" &&
          "Notification" in window &&
          Notification.permission === "granted"
        )
          for (const n of data.notices as AutomationRun[]) {
            const key = "newbot:automation-notified:" + n.id;
            if (
              !localStorage.getItem(key) &&
              (n.completed || 0) >=
                Number(
                  localStorage.getItem("newbot:automation-browser-since") ||
                    Date.now(),
                )
            ) {
              localStorage.setItem(key, "1");
              try {
                const notification = new Notification(n.name, {
                  body:
                    n.state === "succeeded"
                      ? "自动任务已完成"
                      : "自动任务需要你查看",
                  tag: n.id,
                });
                notification.onclick = () => window.focus();
              } catch {
                localStorage.setItem(
                  "newbot:automation-browser-notifications",
                  "0",
                );
              }
            }
          }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "自动任务读取失败");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 5000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, version]);
  return {
    tasks,
    notices,
    error,
    loaded,
    refresh: () => setVersion((v) => v + 1),
  };
}
