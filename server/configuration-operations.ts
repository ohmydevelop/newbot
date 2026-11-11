import { z } from "zod";
import { hash, type Store } from "./db.js";
import { PublicError } from "./public-error.js";
import { configFail, publicConfigurationIssue } from "./configuration-error.js";

export function configurationOperations(db: Store) {
  const active = new Map<string, Promise<any>>();
  const get = (id: string, owner: string) =>
    db.raw
      .prepare("SELECT * FROM configuration_operations WHERE id=? AND owner=?")
      .get(id, owner) as
      | { fingerprint: string; state: string; result: string | null }
      | undefined;
  return {
    read(id: string, owner: string) {
      z.string().uuid().parse(id);
      const row = get(id, owner);
      return row
        ? {
            state: row.state,
            ...(row.result ? { result: JSON.parse(row.result) } : {}),
          }
        : { state: "unseen" };
    },
    async run(
      id: unknown,
      owner: string,
      payload: unknown,
      execute: () => Promise<any>,
    ) {
      if (id === undefined) return execute(); // Existing clients remain compatible.
      const operationId = z.string().uuid().parse(id);
      const fingerprint = hash(JSON.stringify(payload));
      const old = get(operationId, owner);
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new PublicError("操作编号不能用于不同的修改");
        if (active.has(operationId)) return active.get(operationId);
        if (old.state === "saved" && old.result) return JSON.parse(old.result);
        configFail(
          "保存结果需要重新核对，请刷新当前对象。",
          409,
          "write_unconfirmed",
          "unconfirmed",
        );
      }
      db.raw
        .prepare(
          "INSERT INTO configuration_operations VALUES(?,?,?,'pending',NULL,?)",
        )
        .run(operationId, owner, fingerprint, Date.now());
      const operation = (async () => {
        try {
          const result = await execute();
          // Only the public receipt is retained; no native configuration or credentials.
          const receipt = {
            state: result.state,
            id: result.id,
            configuration: result.configuration,
          };
          db.raw
            .prepare(
              "UPDATE configuration_operations SET state='saved',result=?,updated=? WHERE id=?",
            )
            .run(JSON.stringify(receipt), Date.now(), operationId);
          return result;
        } catch (error) {
          const state =
            publicConfigurationIssue(error)?.persistence === "unchanged" ||
            error instanceof z.ZodError
              ? "unchanged"
              : "unconfirmed";
          db.raw
            .prepare(
              "UPDATE configuration_operations SET state=?,updated=? WHERE id=?",
            )
            .run(state, Date.now(), operationId);
          throw error;
        } finally {
          active.delete(operationId);
        }
      })();
      active.set(operationId, operation);
      return operation;
    },
  };
}
