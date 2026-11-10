import { randomUUID } from "node:crypto";
import { FakeCodex } from "./fixture.js";
import type { ToolRequest } from "../server/codex.js";
import type { DynamicToolCallResponse } from "../generated/codex/v2/DynamicToolCallResponse.js";
import { A2UI_TOOL } from "../shared/a2ui-chat.js";
import { demoMessages } from "../examples/a2ui/catalog-fixture.js";
export function formMessages() {
  return JSON.parse(
    JSON.stringify(demoMessages())
      .replaceAll("monitor.submit", "submit")
      .replaceAll("monitor.cancel", "cancel"),
  );
}
export class A2uiFixtureCodex extends FakeCodex {
  toolResponses: { request: ToolRequest; response: DynamicToolCallResponse }[] =
    [];
  tool(threadId: string, turnId: string, args: unknown, tool = A2UI_TOOL) {
    const request: ToolRequest = {
      id: randomUUID(),
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId: randomUUID(),
        namespace: null,
        tool,
        arguments: args as never,
      },
    };
    this.item(threadId, turnId, {
      id: request.params.callId,
      type: "dynamicToolCall",
      namespace: null,
      tool,
      arguments: args,
      status: "inProgress",
      contentItems: null,
      success: null,
    });
    this.toolRequests.set(request.id, request);
    this.emit("tool", request);
    return request;
  }
  override respondTool(id: string | number, response: DynamicToolCallResponse) {
    const request = this.toolRequests.get(id);
    if (!request) throw new Error("Tool already resolved");
    this.toolRequests.delete(id);
    this.toolResponses.push({ request, response });
    this.item(
      request.params.threadId,
      request.params.turnId,
      {
        id: request.params.callId,
        type: "dynamicToolCall",
        namespace: null,
        tool: request.params.tool,
        arguments: request.params.arguments,
        status: response.success ? "completed" : "failed",
        contentItems: response.contentItems,
        success: response.success,
      },
      true,
    );
  }
}
