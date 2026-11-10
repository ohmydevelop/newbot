import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { credentialBroker } from "../server/credentials.js";
import { sudoIdentity } from "../server/credential-sudo.js";
const secret = "sudo-native-fixture-password-ONLY-TEST";
const sudo = sudoIdentity({ enabled: true });
const cap = sudo.capability();
assert.equal(process.getuid!(), 1000);
assert.equal(cap.available, true);
const broker = credentialBroker({
  validOwner: (owner) => owner === "owner",
  audit: () => {},
  prepare: (input) => {
    if (input.operation !== "sudo.identity") throw new Error();
    return sudo.prepare(
      input.expectedPolicy,
      async () => {},
      (run) => run(),
    );
  },
});
const create = () =>
  broker.create("owner", {
    requestId: randomUUID(),
    operation: "sudo.identity",
    expectedPolicy: cap.policy!,
  });
try {
  const ticket = await create(),
    bytes = Buffer.from(secret);
  const good = await broker.fulfill(ticket.id, "owner", bytes);
  assert.equal(good.state, "succeeded");
  assert.equal(good.passwordUsed, true);
  assert.ok(bytes.every((v) => !v));
  await assert.rejects(() =>
    broker.fulfill(ticket.id, "owner", Buffer.from(secret)),
  );
  // Neither existing cache nor a new persistent authorization may replace a
  // fresh password challenge after this operation.
  assert.throws(() =>
    execFileSync("/usr/bin/sudo", ["-n", "--", "/usr/bin/id", "-u"], {
      stdio: "ignore",
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    }),
  );
  const wrong = await create();
  const rejected = await broker.fulfill(
    wrong.id,
    "owner",
    Buffer.from("wrong-fixture-password"),
  );
  assert.equal(rejected.state, "failed");
  const cancelled = await create();
  broker.cancel(cancelled.id, "owner");
  await assert.rejects(() =>
    broker.fulfill(cancelled.id, "owner", Buffer.from(secret)),
  );
  assert.equal(broker.pending, 0);
  console.log(
    JSON.stringify({
      realSudo: true,
      realPam: true,
      isolatedUserNamespace: true,
      identity: "root",
      passwordUsed: true,
      wrongPasswordRejected: true,
      replayRejected: true,
      cancelRejected: true,
      cacheNotCreated: true,
      hostAccountsChanged: false,
      modelTurns: 0,
    }),
  );
} finally {
  broker.close();
}
