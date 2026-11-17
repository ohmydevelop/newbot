import manifest from "./plugin.json";
import { ProviderRegistry } from "../../server/event-subscriptions/contracts.js";
import { SubscriptionEngine } from "../../server/event-subscriptions/engine.js";
import { loopbackPullAdapter } from "./loopback-pull.js";

const [directory, endpoint, clock] = process.argv.slice(2);
if (!directory || !endpoint || !clock)
  throw new Error("Expected experiment directory, loopback endpoint and clock");
const adapter = loopbackPullAdapter(endpoint, () => "local-experiment-only");
adapter.acknowledge = async () => {
  process.exit(73);
};
const registry = new ProviderRegistry(new Map([["loopback-pull-v1", adapter]]));
registry.install(manifest);
const engine = new SubscriptionEngine({
  directory,
  registry,
  now: () => Number(clock),
  leaseMs: 100,
  deliver: async () => {
    throw new Error("Must exit before delivery");
  },
});
await engine.tick();
await engine.close();
throw new Error("Crash point was not reached");
