export function verifyA2uiFixtures(): {
  package: string;
  version: string;
  integrity: string;
  files: Record<string, { source: string; sha256: string }>;
};
