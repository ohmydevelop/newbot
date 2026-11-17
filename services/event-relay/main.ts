import { relayServer } from "./server.js";
const { app } = relayServer({
  directory: process.env.RELAY_DATA || ".data/event-relay",
  adminToken: process.env.RELAY_ADMIN_TOKEN || "",
});
await app.listen({
  host: process.env.RELAY_HOST || "127.0.0.1",
  port: Number(process.env.RELAY_PORT || 3180),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close());
