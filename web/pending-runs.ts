export type PendingSubmission = {
  id: string;
  origin: string;
  fingerprint: string;
  state: "submitting" | "unknown" | "awaiting_credentials";
  status?: Record<string, any>;
};
export function pendingFor(
  records: Record<string, PendingSubmission>,
  threadId: string | null,
  newDraft: string,
) {
  return Object.values(records).find(
    (r) =>
      r.origin === (threadId || newDraft) ||
      (!!threadId && r.status?.threadId === threadId),
  );
}
export function restorePending(
  value: string | null,
): Record<string, PendingSubmission> {
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(value || "{}"))
        .filter(
          ([id, r]: [string, any]) =>
            typeof r?.origin === "string" &&
            r.id === id &&
            typeof r.fingerprint === "string",
        )
        .slice(0, 20)
        .map(([id, r]: [string, any]) => [
          id,
          {
            ...r,
            state:
              r.state === "awaiting_credentials"
                ? "awaiting_credentials"
                : "unknown",
          },
        ]),
    );
  } catch {
    return {};
  }
}
