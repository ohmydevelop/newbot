import { PublicError } from "./public-error.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { CredentialConsumer } from "./credentials.js";

export const SUDO_IDENTITY_COMMAND =
  "/usr/bin/sudo -k -S -p [private prompt] -u root -- /usr/bin/id -u";
const paths = ["/usr/bin/sudo", "/usr/bin/id"] as const;
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
type Launch = (prompt: string) => ChildProcessWithoutNullStreams;
// Injection is only for trusted in-process tests, never browser parameters.
export function sudoIdentity(
  options: {
    enabled?: boolean;
    inspect?: () => string | null;
    launch?: Launch;
    timeoutMs?: number;
  } = {},
) {
  const inspect =
    options.inspect ||
    (() => {
      if (process.platform !== "linux" || !process.getuid?.()) return null;
      const identities: unknown[] = [process.getuid()];
      for (const path of paths) {
        const actual = realpathSync(path),
          st = statSync(actual);
        if (
          !st.isFile() ||
          st.uid !== 0 ||
          st.mode & 0o022 ||
          !(st.mode & 0o111)
        )
          return null;
        if (path === paths[0] && !(st.mode & 0o4000)) return null;
        let parent = dirname(actual);
        for (;;) {
          const dir = statSync(parent);
          if (dir.uid !== 0 || dir.mode & 0o022) return null;
          if (parent === "/") break;
          parent = dirname(parent);
        }
        identities.push([
          actual,
          st.dev,
          st.ino,
          st.uid,
          st.mode,
          st.size,
          st.mtimeMs,
          st.ctimeMs,
        ]);
      }
      return JSON.stringify(identities);
    });
  function capability() {
    let identity: string | null = null;
    try {
      if (options.enabled) identity = inspect();
    } catch {
      /* fixed disabled state */
    }
    return {
      available: !!identity,
      operation: "sudo.identity" as const,
      command: SUDO_IDENTITY_COMMAND,
      policy: identity
        ? "sudo1." + createHash("sha256").update(identity).digest("hex")
        : null,
      arbitraryCommands: false,
      agentRequests: false,
      persistence: false,
      timeoutSeconds: Math.min(options.timeoutMs || 15_000, 15_000) / 1000,
    };
  }
  const launch: Launch =
    options.launch ||
    ((prompt) =>
      spawn(
        paths[0],
        ["-k", "-S", "-p", prompt, "-u", "root", "--", paths[1], "-u"],
        {
          cwd: "/",
          env: environment,
          shell: false,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ));
  async function prepare(
    policy: string,
    check: () => Promise<void>,
    exclusive: (
      run: () => ReturnType<CredentialConsumer["run"]>,
    ) => ReturnType<CredentialConsumer["run"]>,
  ): Promise<CredentialConsumer> {
    const validate = () => {
      const current = capability();
      if (!current.available || current.policy !== policy)
        throw new PublicError("受控提权检查不可用，请重新读取能力");
    };
    validate();
    await check();
    return {
      receiver: "本机受信 sudo · root · 固定 id -u",
      async run(secret, signal, authorized) {
        return exclusive(async () => {
          validate();
          if (!authorized()) return { state: "failed", reason: "unavailable" };
          // No shell, inherited environment, terminal, Codex process or arbitrary
          // command. -k with a command bypasses and does not update sudo's cache.
          const prompt = `newbot-private-${randomUUID()}:`;
          return new Promise((resolve) => {
            let child: ChildProcessWithoutNullStreams;
            try {
              child = launch(prompt);
            } catch {
              resolve({ state: "failed", reason: "unavailable" });
              return;
            }
            let sent = false,
              settled = false,
              stopped = false,
              output = "",
              stderr = "",
              bytes = 0;
            let pending: Buffer | undefined;
            const clear = () => {
              pending?.fill(0);
              pending = undefined;
            };
            const kill = () => {
              stopped = true;
              child.stdin.destroy();
              try {
                if (child.pid) process.kill(-child.pid, "SIGKILL");
              } catch {
                /* exited or not a group leader in a test */
              }
              try {
                child.kill("SIGKILL");
              } catch {
                /* already exited */
              }
              clear();
            };
            const done = (success: boolean) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              signal.removeEventListener("abort", abort);
              clear();
              // No bytes from either process output channel leave this module.
              output = stderr = "";
              resolve(
                success
                  ? { state: "succeeded", passwordUsed: sent }
                  : { state: "failed", reason: "unavailable" },
              );
            };
            const abort = () => {
              kill();
            };
            const timer = setTimeout(
              kill,
              Math.min(options.timeoutMs || 15_000, 15_000),
            );
            timer.unref();
            signal.addEventListener("abort", abort, { once: true });
            child.on("error", () => {
              kill();
              done(false);
            });
            child.stdin.on("error", () => {
              kill();
            });
            child.stdout.on("data", (data: Buffer) => {
              bytes += data.length;
              if (bytes > 4096) {
                data.fill(0);
                kill();
                return;
              }
              output += data.toString("utf8");
              data.fill(0);
            });
            child.stderr.on("data", (data: Buffer) => {
              bytes += data.length;
              if (bytes > 4096) {
                data.fill(0);
                kill();
                return;
              }
              stderr += data.toString("utf8");
              data.fill(0);
              if (!stderr.includes(prompt)) return;
              // Only a single exact server-generated prompt is accepted. PAM
              // multi-factor/changed prompts fail closed, without guessing.
              if (
                sent ||
                !stderr.endsWith(prompt) ||
                stderr.indexOf(prompt) !== stderr.lastIndexOf(prompt) ||
                stopped ||
                !authorized()
              ) {
                kill();
                return;
              }
              sent = true;
              stderr = "";
              pending = Buffer.concat([secret, Buffer.from("\n")]);
              child.stdin.end(pending, clear);
              secret.fill(0);
            });
            child.on("close", (code) =>
              done(
                !stopped &&
                  authorized() &&
                  code === 0 &&
                  output === "0\n" &&
                  stderr === "",
              ),
            );
            if (signal.aborted || !authorized()) kill();
          });
        });
      },
    };
  }
  return { capability, prepare };
}
