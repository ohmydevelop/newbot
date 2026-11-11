export const IMPORT_LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  packageBytes: 32 * 1024 * 1024,
  archiveBytes: 40 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  files: 4096,
  depth: 16,
  skills: 1024,
  staging: 4,
  retainedBytes: 256 * 1024 * 1024,
} as const;
export type ImportSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
};
export type ImportEntry = {
  id: string;
  kind: "skills" | "plugin";
  name: string;
  description: string;
  root: string;
  version?: string;
  previousVersion?: string;
  previousDigest?: string | null;
  previousSettings?: string;
  previousEnabled?: boolean;
  digest: string;
  skills: ImportSkill[];
  mcp: string[];
  hooks: string[];
  blocked?: string;
  selectedSkills?: string[];
  conflict?: {
    kind: "same" | "changed";
    added: number;
    removed: number;
    changed: number;
  };
  state: "available" | "installed" | "skipped" | "failed";
  error?: string;
};
export type ImportSession = {
  id: string;
  update?: { pluginId: string; name: string; digest: string };
  source: {
    kind: "files" | "zip" | "github";
    name: string;
    url?: string;
    ref?: string;
    path?: string;
    commit?: string;
  };
  state:
    | "uploading"
    | "scanning"
    | "ready"
    | "installing"
    | "complete"
    | "failed";
  digest?: string;
  entries: ImportEntry[];
  error?: string;
  bytes: number;
  files: number;
  created: number;
  retained?: boolean;
};
export type ImportChoice = {
  id: string;
  skills: string[];
  replace: boolean;
  confirmPackage: boolean;
};
