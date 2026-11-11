import { z } from "zod";

export const certificateRequest = z.strictObject({
  pluginId: z.string().min(1).max(300),
  connectionId: z.string().regex(/^plugin_[a-f0-9]{32}$/),
  expectedRevision: z.string().min(1).max(100),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
  fieldId: z.string().min(1).max(80),
  address: z.string().min(1).max(4096),
});
export type CertificateRequest = z.infer<typeof certificateRequest>;
export type CertificateObservation = {
  origin: string;
  subject: string;
  issuer: string;
  validFrom: number;
  validTo: number;
  fingerprint: string;
  systemTrusted: boolean;
  hostnameMatches: boolean;
  canUse: boolean;
  observedAt: number;
  expiresAt: number;
};
