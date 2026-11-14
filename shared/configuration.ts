import type { CredentialMetadata } from "./credentials.js";
export type ConfigSource = { type: string; profile: boolean };
export type ConfigurationView = {
  revision: string;
  /** Object revisions exclude unrelated settings and discovery status. */
  revisions?: Record<string, string>;
  writable: boolean;
  nativeWritable?: boolean;
  providerStorage?: "sqlite" | "memory" | "native";
  providerSourceStatus?:
    | "manual"
    | "loaded"
    | "unavailable"
    | "migrated"
    | "restored";
  providerSourceConfigured?: boolean;
  reason: string | null;
  defaults: {
    model: string | null;
    effort: string | null;
    provider: string | null;
  };
  sources: { model: ConfigSource | null; effort: ConfigSource | null };
  providers: {
    id: string;
    editable: boolean;
    missing?: boolean;
    managedCredential?: CredentialMetadata;
    privateFields?: import("./credentials.js").PrivateFieldView;
    credentialEditable?: boolean;
    authentication?: import("./credentials.js").AuthenticationView;
    customModels?: string[];
    requiresAccountAuth: boolean;
    temporaryCredentialTest?: boolean;
    name: string;
    endpointOrigin: string | null;
    editableEndpoint?: string | null;
    wireApi: "responses" | "other" | null;
    credentials: "inline" | "environment" | "none";
  }[];
  mcp: {
    id: string;
    name?: string;
    definition?: {
      command?: string;
      args?: string[];
      url?: string;
      caCertificate?: string;
    };
    editable: boolean;
    managedCredential?: CredentialMetadata;
    privateFields?: import("./credentials.js").PrivateFieldView;
    credentialEditable?: boolean;
    authentication?: import("./credentials.js").AuthenticationView;
    hasEnvReferences: boolean;
    startupTimeout: number | null;
    toolTimeout: number | null;
    transport: "stdio" | "http" | "unknown";
    enabled: boolean;
    endpointOrigin: string | null;
    credentials: boolean;
    hasArguments: boolean;
    hasEnvironment: boolean;
  }[];
};
export type DefaultsSaveResult = {
  configurationIssue?: ConfigurationIssue;
  state: "applied" | "overridden";
  configuration: ConfigurationView;
};
export type ConfigurationIssue = {
  code:
    | "conflict"
    | "read_only"
    | "read_failed"
    | "write_failed"
    | "write_unconfirmed"
    | "readback_failed"
    | "reload_failed"
    | "busy"
    | "overridden"
    | "switch_reverted";
  persistence: "unchanged" | "unconfirmed" | "saved";
  recovery: "read" | "reconnect" | "wait";
};
// Public error metadata is an enum-only contract; never pass arbitrary upstream diagnostics.
export function configurationIssue(value: unknown): ConfigurationIssue | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    ![
      "conflict",
      "read_only",
      "read_failed",
      "write_failed",
      "write_unconfirmed",
      "readback_failed",
      "reload_failed",
      "busy",
      "overridden",
      "switch_reverted",
    ].includes(String(v.code)) ||
    !["unchanged", "unconfirmed", "saved"].includes(String(v.persistence)) ||
    !["read", "reconnect", "wait"].includes(String(v.recovery))
  )
    return null;
  return {
    code: v.code,
    persistence: v.persistence,
    recovery: v.recovery,
  } as ConfigurationIssue;
}
