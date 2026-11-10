// Samples only aggregate runtime counters. Optional provider prompts are not enabled automatically.
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { client } from "./ops-common.mjs";
const hours = Number(process.env.SOAK_HOURS || 24);
const interval = Number(process.env.SOAK_INTERVAL_SECONDS || 30);
if (
  !Number.isFinite(hours) ||
  hours <= 0 ||
  hours > 168 ||
  !Number.isFinite(interval) ||
  interval < 1
)
  throw new Error("Invalid soak duration/interval");
const api = await client();
const started = Date.now(),
  duration = hours * 3600000;
let stop = false,
  failed = 0,
  samples = 0,
  peakRss = 0,
  peakHeap = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stop = true;
  });
mkdirSync(".data", { recursive: true, mode: 0o700 });
const path = ".data/soak-" + new Date().toISOString().replaceAll(":", "-");
while (!stop && Date.now() - started < duration) {
  try {
    const sample = await api("/api/runtime/metrics");
    const readiness = await api("/api/ready");
    samples++;
    peakRss = Math.max(peakRss, sample.memory.rss);
    peakHeap = Math.max(peakHeap, sample.memory.heapUsed);
    appendFileSync(
      path + ".jsonl",
      JSON.stringify({
        at: new Date().toISOString(),
        ...sample,
        ready: readiness.ready,
      }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    failed++;
    appendFileSync(
      path + ".jsonl",
      JSON.stringify({ at: new Date().toISOString(), error: "probe-failed" }) +
        "\n",
      { mode: 0o600 },
    );
  }
  await new Promise((r) =>
    setTimeout(
      r,
      Math.min(interval * 1000, Math.max(0, duration - (Date.now() - started))),
    ),
  );
}
const report = {
  started: new Date(started).toISOString(),
  ended: new Date().toISOString(),
  targetHours: hours,
  completed: !stop && Date.now() - started >= duration,
  samples,
  failed,
  peakBridgeRssMiB: Math.round(peakRss / 1048576),
  peakBridgeHeapMiB: Math.round(peakHeap / 1048576),
  scope:
    "Node Bridge only; collect docker stats separately for Codex and MCP processes",
};
writeFileSync(path + ".json", JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.completed || failed) process.exitCode = 1;
