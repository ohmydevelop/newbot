import type { CertificateObservation } from "../shared/certificates";
import type { PluginConnection } from "../shared/plugin-configuration";
export type CertificateSelection = {
  sourceId: string;
  address: string;
  targetId: string;
  observation: CertificateObservation;
};
export function certificateSources(
  c: PluginConnection,
  values: Record<string, unknown>,
) {
  return c.fields.filter(
    (f) =>
      f.type === "string" &&
      !f.sensitive &&
      typeof values[f.id] === "string" &&
      /^https?:\/\//i.test(String(values[f.id])),
  );
}
export function certificateSelectionValid(
  c: PluginConnection,
  values: Record<string, unknown>,
  s: CertificateSelection,
) {
  return (
    s.observation.canUse &&
    s.observation.expiresAt > Date.now() &&
    values[s.sourceId] === s.address &&
    s.sourceId !== s.targetId &&
    [s.sourceId, s.targetId].every((id) =>
      c.fields.some((f) => f.id === id && f.type === "string" && !f.sensitive),
    )
  );
}
export function clearStaleCertificate(
  values: Record<string, string | number | boolean>,
  s: CertificateSelection | null,
) {
  if (
    s &&
    values[s.sourceId] !== s.address &&
    values[s.targetId] === s.observation.fingerprint
  ) {
    const next = { ...values };
    delete next[s.targetId];
    return next;
  }
  return values;
}
