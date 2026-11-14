import { SkillIcon, PluginIcon, ConnectionIcon, GatewayIcon } from "./AppIcons";
const icons = {
  skill: SkillIcon,
  plugin: PluginIcon,
  connection: ConnectionIcon,
  gateway: GatewayIcon,
};
export default function CatalogIcon({
  kind = "skill",
}: {
  name: string;
  kind?: keyof typeof icons;
}) {
  const Icon = icons[kind];
  return (
    <span className="catalog-icon" aria-hidden="true">
      <Icon size={22} />
    </span>
  );
}
