import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalRunnerTransport } from "../server/runner/local-transport.js";

test("runner transport rejects unreviewed methods before sending any bytes", () => {
  const transport = new LocalRunnerTransport(),
    writes: string[] = [];
  transport.child = {
    stdin: { writable: true, write: (line: string) => writes.push(line) },
  } as any;
  assert.throws(
    () => transport.send({ id: 1, method: "arbitrary/execute", params: {} }),
    /不支持/,
  );
  assert.equal(writes.length, 0);
  transport.send({
    id: 2,
    method: "turn/start",
    params: { threadId: "fixture" },
  });
  assert.equal(JSON.parse(writes[0]).method, "turn/start");
});
test("native responses, requests and events traverse local runner; diagnostics never become UI events", async () => {
  const transport = new LocalRunnerTransport(),
    messages: any[] = [],
    reasons: string[] = [];
  const source = `const rl=require('node:readline').createInterface({input:process.stdin}); process.stderr.write('PRIVATE_DIAGNOSTIC');console.log('not-json-private');rl.on('line',line=>{const v=JSON.parse(line);console.log(JSON.stringify({id:v.id,result:{ok:true}}));console.log(JSON.stringify({method:'turn/completed',params:{turn:{id:'one'}}}));});`;
  transport.start(
    {
      binary: process.execPath,
      args: ["-e", source],
      cwd: process.cwd(),
      env: {},
    },
    {
      message: (v) => messages.push(v),
      offline: (r) => reasons.push(r),
      closed: () => {},
    },
  );
  try {
    transport.send({ id: 1, method: "initialize", params: {} });
    const deadline = Date.now() + 5000;
    while (messages.length < 2) {
      if (Date.now() > deadline) throw Error("runner transport timeout");
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.deepEqual(messages[0], { id: 1, result: { ok: true } });
    assert.equal(messages[1].method, "turn/completed");
    assert.ok(!JSON.stringify(messages).includes("PRIVATE"));
    await transport.stopAndWait();
    assert.equal(reasons.length, 1);
    assert.throws(
      () => transport.send({ id: 2, method: "thread/list", params: {} }),
      /未连接/,
    );
  } finally {
    await transport.stopAndWait();
  }
});
