import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { PublicError } from "../public-error.js";
export function checkedWorkspaceRoot(path: string) {
  if (
    realpathSync(path) !== resolve(path) ||
    !lstatSync(path).isDirectory() ||
    lstatSync(path).isSymbolicLink()
  )
    throw new PublicError("会话工作目录已变化，请检查执行节点存储");
  return resolve(path);
}
/** Node-local roots; the Server keeps logical workspace/thread bindings. */
export class LocalWorkspaceRoots {
  readonly parent: string;
  constructor(parent: string) {
    this.parent = resolve(parent);
    mkdirSync(this.parent, { recursive: true, mode: 0o700 });
    checkedWorkspaceRoot(this.parent);
  }
  allocate() {
    checkedWorkspaceRoot(this.parent);
    const id = randomUUID(),
      root = join(this.parent, id);
    mkdirSync(root, { mode: 0o700 });
    return { id, root };
  }
  resolve(id: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new PublicError("工作区身份无效");
    checkedWorkspaceRoot(this.parent);
    return checkedWorkspaceRoot(join(this.parent, id));
  }
}
