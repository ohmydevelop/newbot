// Linux-only real PAM/sudo proof in a disposable user/mount/PID/network namespace.
// Host accounts, sudoers and daemon permissions are never changed.
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
const output = resolve(".data/sudo");
mkdirSync(output, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(tmpdir(), "newbot-sudo-native-")),
  root = join(directory, "root");
try {
  for (const dir of [
    "usr/bin",
    "usr/lib",
    "etc/pam.d",
    "etc/security",
    "run",
    "tmp",
    "dev",
    "proc",
    "proof",
  ])
    mkdirSync(join(root, dir), { recursive: true, mode: 0o755 });
  for (const name of ["sudo", "id", "setpriv", "unix_chkpwd"])
    copyFileSync(`/usr/bin/${name}`, join(root, "usr/bin", name));
  copyFileSync(process.execPath, join(root, "usr/bin/node"));
  for (const dir of ["bin", "sbin", "lib", "lib64"])
    symlinkSync(
      dir === "bin" || dir === "sbin" ? "usr/bin" : "usr/lib",
      join(root, dir),
    );
  cpSync("/usr/lib/sudo", join(directory, "sudo-lib"), {
    recursive: true,
    dereference: true,
  });
  const hash = execFileSync("openssl", ["passwd", "-6", "-stdin"], {
    input: "sudo-native-fixture-password-ONLY-TEST",
    encoding: "utf8",
  }).trim();
  const files = {
    "etc/passwd":
      "root:x:0:0:root:/:/bin/sh\nprobe:x:1000:1000:probe:/tmp:/bin/sh\n",
    "etc/group": "root:x:0:\nprobe:x:1000:\n",
    "etc/shadow": `root:!:20000:0:99999:7:::\nprobe:${hash}:20000:0:99999:7:::\n`,
    "etc/nsswitch.conf":
      "passwd: files\ngroup: files\nshadow: files\nhosts: files\n",
    "etc/hosts": "127.0.0.1 localhost\n",
    "etc/sudo.conf":
      "Plugin sudoers_policy sudoers.so\nPlugin sudoers_io sudoers.so\n",
    "etc/sudoers":
      "Defaults lecture=never,passwd_tries=1,timestamp_timeout=5,!use_pty\nprobe ALL=(root) PASSWD: /usr/bin/id -u\n",
    "etc/pam.d/sudo":
      "auth required pam_unix.so\naccount required pam_permit.so\nsession required pam_permit.so\n",
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(root, name), content, {
      mode: name.endsWith("shadow")
        ? 0o600
        : name.endsWith("sudoers")
          ? 0o440
          : 0o644,
    });
  for (const dev of ["null", "urandom", "random", "tty"])
    writeFileSync(join(root, "dev", dev), "");
  await build({
    entryPoints: ["tests/sudo-native-probe.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "proof/probe.mjs"),
    logLevel: "silent",
  });
  // Every mount below exists only in the child's private mount namespace.
  const setup = `set -eu
root=$1
libs=$2
mkdir "$root/proof/bin"
cp "$root/usr/bin/"* "$root/proof/bin/"
mount -t tmpfs -o mode=755 tmpfs "$root/usr/bin"
cp "$root/proof/bin/"* "$root/usr/bin/"
mount --bind /usr/lib "$root/usr/lib"
mount -o remount,bind,ro "$root/usr/lib"
mount --bind "$libs" "$root/usr/lib/sudo"
mount -o remount,bind,ro "$root/usr/lib/sudo"
for dev in null urandom random tty; do mount --bind "/dev/$dev" "$root/dev/$dev"; done
mount -t proc proc "$root/proc"
chmod 755 "$root" "$root/usr/bin/"*
chmod 4755 "$root/usr/bin/sudo"
chmod 4755 "$root/usr/bin/unix_chkpwd"
chmod 1777 "$root/tmp"
exec chroot "$root" /usr/bin/setpriv --reuid 1000 --regid 1000 --clear-groups /usr/bin/node /proof/probe.mjs
`;
  const child = spawn(
    "unshare",
    [
      "--user",
      "--map-auto",
      "--map-root-user",
      "--mount",
      "--pid",
      "--net",
      "--fork",
      "bash",
      "-c",
      setup,
      "newbot-sudo-proof",
      root,
      join(directory, "sudo-lib"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const code = await new Promise((res, rej) => {
    child.on("error", rej);
    child.on("close", res);
  });
  clearTimeout(timer);
  if (code !== 0) {
    writeFileSync(join(output, "native-failure.log"), stderr, { mode: 0o600 });
    throw new Error(
      "Isolated sudo proof failed; see private native-failure.log",
    );
  }
  const result = JSON.parse(stdout.trim());
  writeFileSync(
    join(output, "native-result.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  rmSync(join(output, "native-failure.log"), { force: true });
  console.log(JSON.stringify(result));
} finally {
  // Clear the temporary setuid bit even when namespace startup fails.
  try {
    chmodSync(join(root, "usr/bin/sudo"), 0o700);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
