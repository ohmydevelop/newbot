import type { SkillMetadata } from "../generated/codex/v2/SkillMetadata";
export type Json = Record<string, any>;
export type Item = Json & {
  id: string;
  type: string;
  display?: import("./tool-display.js").ToolDisplay;
  text?: string;
  content?: Json[];
  media?: MediaReference[];
  skillRefs?: SkillReference[];
  pluginRefs?: PluginReference[];
  expert?: import("./experts.js").ExpertReference;
  a2ui?: import("./a2ui-chat.js").A2uiView;
};
export type Turn = {
  id: string;
  status: string;
  items: Item[];
  error?: { message: string } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  artifacts?: Artifact[];
  artifactNotices?: ArtifactNotice[];
};
export type Thread = {
  uiCatalog?: string;
  nextInput?: SessionInputs;
  extensions?: import("./experts.js").SessionExtensions;
  id: string;
  name?: string;
  preview?: string;
  modelProvider?: string;
  updatedAt?: number;
  status?: { type: string };
  turns: Turn[];
  runtime?: import("./runtime-settings").SessionRuntime;
  revision?: number;
  historyCursor?: string | null;
};
export type ThreadSummary = {
  activity?: import("./thread-activity.js").ThreadActivity;
  id: string;
  title: string;
  provider: string;
  updated: number;
  archived: number;
};
export type Model = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
export type Approval = {
  id: string | number;
  method: string;
  params: Json;
  display?: import("./tool-display.js").ToolDisplay;
};
export type Rpc = {
  id?: string | number;
  method?: string;
  params?: Json;
  result?: any;
  error?: { code: number; message: string };
};

export type Artifact = {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string | null;
  path: string;
  name: string;
  kind:
    | "text"
    | "code"
    | "markdown"
    | "json"
    | "csv"
    | "html"
    | "image"
    | "pdf";
  mime: string;
  size: number;
  sha256: string;
  version: number;
  source: "fileChange" | "user" | "media";
  createdAt: number;
  contentUrl: string;
  downloadUrl: string;
};
export type ArtifactNotice = {
  turnId: string;
  itemId: string;
  path: string;
  state: string;
  reason: string | null;
};

export type ArtifactVersions = {
  versions: Artifact[];
  nextBefore: number | null;
  latestVersion: number;
};
export type StorageUsage = {
  usedBytes: number;
  limitBytes: number;
  uploadsBytes: number;
  snapshotBytes: number;
  untrackedBytes: number;
  legacyUploadBytes: number;
  versions: number;
  snapshots: number;
  reclaimableBytes: number;
  reclaimableFiles: number;
  scannedAt: number;
  limits: { artifactBytes: number; textBytes: number; retentionHours: number };
};
export type StorageCleanup = {
  usage: StorageUsage;
  removedFiles: number;
  releasedBytes: number;
  failedFiles: number;
};

export type Skill = SkillMetadata & {
  id: string;
  removable?: boolean;
  removalReason?: string | null;
};
export type SkillDocument = {
  skill: Skill;
  content: string;
  size: number;
  sha256: string;
};

export type SkillSelection = { id: string; sha256: string };
export type SkillReference = SkillSelection & {
  name: string;
  displayName: string;
  scope: Skill["scope"];
};

export type PluginReference = { id: string; name: string; displayName: string };
export type SessionInputs = {
  revision: number;
  skills: SkillReference[];
  plugins: PluginReference[];
};

export type MediaReference = {
  id: string;
  reference?: string;
  label: string;
  state: "pending" | "ready" | "failed";
  reason?: string;
  url?: string;
  artifactId?: string;
};
