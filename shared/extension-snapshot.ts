import type { Json } from "./types.js";
export type ExtensionSnapshot = {
  revision: string;
  config: Json;
  disabledPluginIds: string[];
  activePlugins?: { id: string; version: string | null }[];
  resources: {
    id: string;
    path: string;
    digest: string;
    projectPath?: string;
    resourceRoot?: string;
    projectRoot?: string;
  }[];
};
