import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
const target = resolve("dist/server/node_modules"),
  copied = new Map();
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
function copy(name, from = resolve("node_modules")) {
  const source = join(from, name),
    manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (copied.has(name)) {
    if (copied.get(name) !== manifest.version)
      throw Error("Conflicting staged dependency: " + name);
    return;
  }
  copied.set(name, manifest.version);
  const destination = join(target, name);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      !path.includes("/node_modules/" + name + "/node_modules/"),
  });
  for (const dep of Object.keys(manifest.dependencies || {}))
    copy(
      dep,
      existsSync(join(source, "node_modules", dep))
        ? join(source, "node_modules")
        : resolve("node_modules"),
    );
}
for (const name of ["nodemailer", "@js-temporal/polyfill", "yaml"]) copy(name);
writeFileSync(
  resolve("dist/server/runtime-dependencies.json"),
  JSON.stringify(Object.fromEntries(copied), null, 2) + "\n",
);
console.log(
  "Staged runtime dependencies: " +
    [...copied].map(([n, v]) => n + "@" + v).join(", "),
);
