// Only hide a complete frontmatter block in the formatted view; source stays intact.
export function skillMarkdown(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

export const skillScopes: Record<string, string> = {
  user: "个人技能",
  repo: "项目技能",
  system: "系统技能",
  admin: "管理员技能",
};
export function skillLabel(skill: {
  name: string;
  interface?: { displayName?: string };
  displayName?: string;
}) {
  return skill.interface?.displayName || skill.displayName || skill.name;
}
