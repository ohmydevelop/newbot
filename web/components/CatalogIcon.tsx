import { SkillIcon, PluginIcon, ConnectionIcon, GatewayIcon } from "./AppIcons";
import { UsersRound } from "lucide-react";
const icons = {
  skill: SkillIcon,
  plugin: PluginIcon,
  connection: ConnectionIcon,
  gateway: GatewayIcon,
  expert: UsersRound,
};
const tones = {
  skill: "orange",
  plugin: "blue",
  connection: "blue",
  gateway: "orange",
  expert: "green",
};
export default function CatalogIcon({
  kind = "skill",
}: {
  name: string;
  kind?: keyof typeof icons;
}) {
  const Icon = icons[kind];
  return (
    <span
      className="catalog-icon catalog-mark"
      data-identity-tone={tones[kind]}
      aria-hidden="true"
    >
      <Icon size={22} />
    </span>
  );
}
