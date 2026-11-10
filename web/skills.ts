import type { SkillDocument } from "../shared/types";
import { useApp } from "./store";
export async function readSkill(
  id: string,
  signal: AbortSignal,
): Promise<SkillDocument> {
  const response = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) {
    useApp.setState({ authenticated: false });
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new Error(value?.error || "技能说明读取失败，请重试");
  }
  return response.json();
}
