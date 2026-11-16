import { create } from "zustand";
export const settingsSections = [
  "general",
  "behavior",
  "connectors",
  "skills",
  "experts",
  "models",
  "storage",
  "security",
] as const;
export type SettingsSection = (typeof settingsSections)[number];
export type CatalogSection = "connectors" | "skills" | "experts";
export function settingsSection(value: string): SettingsSection {
  if (value === "plugins" || value === "mcp") return "connectors";
  return settingsSections.includes(value as SettingsSection)
    ? (value as SettingsSection)
    : "general";
}
export type CatalogViewState = {
  query: string;
  filter: string;
  scroll: number;
  focus: string;
};
const empty = (): CatalogViewState => ({
  query: "",
  filter: "",
  scroll: 0,
  focus: "",
});
export const catalogViews = create<{
  views: Record<CatalogSection, CatalogViewState>;
  update: (section: CatalogSection, patch: Partial<CatalogViewState>) => void;
}>((set) => ({
  views: { connectors: empty(), skills: empty(), experts: empty() },
  update: (section, patch) =>
    set((state) => ({
      views: {
        ...state.views,
        [section]: { ...state.views[section], ...patch },
      },
    })),
}));
export function useCatalogField(
  section: CatalogSection,
  field: "query" | "filter",
) {
  const value = catalogViews((state) => state.views[section][field]);
  return [
    value,
    (value: string) =>
      catalogViews.getState().update(section, { [field]: value, scroll: 0 }),
  ] as const;
}

export const settingsNavigation = create(() => ({
  section: "general" as SettingsSection,
}));
