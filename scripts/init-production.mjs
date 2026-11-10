import {
  mkdirSync,
  readdirSync,
  chmodSync,
  chownSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
if (![0, 1000].includes(process.getuid?.()))
  throw new Error("Run initialization as root or UID 1000");
const path = resolve(process.argv[2] || "/srv/newbot/data");
mkdirSync(path, { recursive: true, mode: 0o700 });
if (readdirSync(path).length)
  throw new Error(
    "Production initialization requires an EMPTY directory; existing data was not changed",
  );
for (const dir of [path, join(path, "codex"), join(path, "workspace")]) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (process.getuid?.() === 0) chownSync(dir, 1000, 1000);
  else if (statSync(dir).uid !== 1000)
    throw new Error(
      "Run as UID 1000 or root so the non-root container can access its dedicated volume",
    );
}
console.log(
  "Fresh production data directories initialized. No credentials or test data copied.",
);
