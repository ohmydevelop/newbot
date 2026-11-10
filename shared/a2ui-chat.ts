import { z } from "zod";
import type { A2uiMessage } from "./a2ui-policy.js";
export const A2UI_TOOL = "newbot_ui";
export const A2UI_ACTIONS = ["submit", "cancel"] as const;
export type A2uiView = {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  surfaceId: string;
  revision: number;
  state: "display" | "waiting" | "submitted" | "cancelled" | "unavailable";
  messages: A2uiMessage[];
  token?: string;
  expiresAt?: number;
  reason?:
    | "expired"
    | "runtime_restarted"
    | "runtime_stopped"
    | "interrupted"
    | "request_resolved"
    | "incomplete"
    | "invalid"
    | "submission_unconfirmed";
  draft?: {
    values: Record<string, string | string[]>;
    version: number;
    updatedAt: number;
  };
  draftVersion?: number;
};
export const a2uiIdentity = {
  id: z.string().uuid(),
  threadId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  surfaceId: z.string().min(1).max(64),
  revision: z.number().int().positive(),
  token: z.string().uuid(),
};
export const a2uiAction = z.strictObject({
  ...a2uiIdentity,
  requestId: z.string().uuid(),
  sourceComponentId: z.string().min(1).max(64),
  values: z.record(z.string(), z.unknown()),
});
export type A2uiActionInput = z.infer<typeof a2uiAction>;
export const a2uiDraftInput = z.strictObject({
  ...a2uiIdentity,
  expectedVersion: z.number().int().min(0),
  values: z.record(z.string(), z.unknown()),
});
export type A2uiDraftInput = z.infer<typeof a2uiDraftInput>;
