import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRpc } from "../server/protocol.js";

test("generated native integers reach JSON-RPC as numbers without silent rounding", () => {
  assert.deepEqual(
    JSON.parse(
      encodeRpc({ params: { modelRoute: { revision: 23n }, optional: null } }),
    ),
    { params: { modelRoute: { revision: 23 }, optional: null } },
  );
  assert.equal(
    JSON.parse(encodeRpc(BigInt(Number.MAX_SAFE_INTEGER))),
    Number.MAX_SAFE_INTEGER,
  );
  assert.throws(
    () => encodeRpc({ revision: 9007199254740992n }),
    /supported JSON range/,
  );
  assert.throws(() => encodeRpc(-9007199254740992n), /supported JSON range/);
});
