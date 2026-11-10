import { PublicError } from "./public-error.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// Native Codex config overrides, scoped to this app-server process only.
export function testMcpArgs() {
  const official: string[] = [];
  if (process.env.ENABLE_OFFICIAL_MCP === "true") {
    const entry = resolve(".data/official-mcp-app/dist/index.js");
    if (!existsSync(entry))
      throw new PublicError(
        "官方 MCP 测试应用尚未准备，请先运行 npm run test:official",
      );
    official.push(
      "-c",
      `mcp_servers.official_basic.command=${JSON.stringify(process.execPath)}`,
      "-c",
      `mcp_servers.official_basic.args=${JSON.stringify([entry, "--stdio"])}`,
      "-c",
      "mcp_servers.official_basic.enabled=true",
    );
  }
  if (process.env.ENABLE_TEST_MCP !== "true") return official;
  const entry = resolve("dist/mcp-test/server.js");
  if (!existsSync(entry))
    throw new PublicError("测试 MCP 尚未构建，请先运行 npm run build:mcp-test");
  return [
    ...official,
    "-c",
    `mcp_servers.newbot_test.command=${JSON.stringify(process.execPath)}`,
    "-c",
    `mcp_servers.newbot_test.args=${JSON.stringify([entry])}`,
    "-c",
    "mcp_servers.newbot_test.enabled=true",
  ];
}
