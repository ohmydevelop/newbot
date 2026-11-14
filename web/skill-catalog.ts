import type { Skill } from "../shared/types";
import { skillLabel } from "../shared/skills";
/** The standalone catalog and its empty state must describe the same set. */
export function visibleCatalogSkills(
  skills: Skill[],
  query = "",
  scope = "",
): Skill[] {
  const search = query.trim().toLocaleLowerCase();
  return skills.filter(
    (skill) =>
      !skill.pluginId &&
      (!scope || skill.scope === scope) &&
      `${skillLabel(skill)} ${skill.name} ${skill.description}`
        .toLocaleLowerCase()
        .includes(search),
  );
}
