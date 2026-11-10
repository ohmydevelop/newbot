import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { sudoIdentity } from "../server/credential-sudo.js";
export const sudoTestSecret = "test sudo 私密 password";
export function testSudo(
  options: {
    mode?: string;
    marker?: string;
    timeoutMs?: number;
    inspect?: () => string | null;
    launched?: () => void;
  } = {},
) {
  return sudoIdentity({
    enabled: true,
    inspect: options.inspect || (() => "synthetic-trusted-policy"),
    timeoutMs: options.timeoutMs || 1000,
    launch: (prompt) => {
      options.launched?.();
      return spawn(
        process.execPath,
        [
          resolve("tests/sudo-process-fixture.mjs"),
          prompt,
          options.mode || "success",
          ...(options.marker ? [options.marker] : []),
        ],
        { detached: true, stdio: ["pipe", "pipe", "pipe"], env: {} },
      );
    },
  });
}
