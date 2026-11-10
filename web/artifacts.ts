import type { Artifact } from "../shared/types";
import { useApp } from "./store";
export async function artifactFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  if (response.status === 401) {
    useApp.setState({ authenticated: false });
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new Error(value?.error || "文件读取失败，请重试");
  }
  return response;
}
export const artifactEndpoint = (id: string, action = "content") =>
  `/api/artifacts/${encodeURIComponent(id)}/${action}`;
export async function downloadArtifact(artifact: Artifact) {
  const response = await artifactFetch(
    artifactEndpoint(artifact.id, "download"),
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function attachArtifact(artifact: Artifact) {
  useApp.setState((state) => {
    if (state.thread?.id !== artifact.threadId) return state;
    return {
      thread: {
        ...state.thread,
        turns: state.thread.turns.map((turn) =>
          turn.id === artifact.turnId
            ? {
                ...turn,
                artifacts: [
                  ...(turn.artifacts || []).filter((a) => a.id !== artifact.id),
                  artifact,
                ],
              }
            : turn,
        ),
      },
    };
  });
}
