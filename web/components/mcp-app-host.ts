import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { METHOD_NOT_FOUND, ProtocolError } from "@modelcontextprotocol/client";
import { APP_HOST_RESTRICTIONS } from "../../shared/mcp-app-host";

// No request parameters, method names or application logs enter product notices.
export function restrictAppHost(
  bridge: AppBridge,
  active: () => boolean,
  notice: (text: string) => void,
) {
  function denied(capability: keyof typeof APP_HOST_RESTRICTIONS) {
    const message = APP_HOST_RESTRICTIONS[capability];
    if (active()) notice(message);
    return { reason: "unsupported", capability, message };
  }
  function unavailable(capability: keyof typeof APP_HOST_RESTRICTIONS): never {
    const data = denied(capability);
    throw new ProtocolError(METHOD_NOT_FOUND, data.message, data);
  }
  bridge.onmessage = async () => ({ isError: true, ...denied("messages") });
  bridge.onopenlink = async () => ({ isError: true, ...denied("openLinks") });
  bridge.ondownloadfile = async () => ({
    isError: true,
    ...denied("downloads"),
  });
  bridge.onupdatemodelcontext = async () => unavailable("modelContext");
  bridge.onreadresource = async () => unavailable("serverResources");
  bridge.onlistresources = async () => unavailable("serverResources");
  bridge.onlistresourcetemplates = async () => unavailable("serverResources");
  bridge.onlistprompts = async () => unavailable("prompts");
  bridge.oncreatesamplingmessage = async () => unavailable("sampling");
  bridge.setRequestHandler("tools/list", async () =>
    unavailable("toolDiscovery"),
  );
  bridge.onrequestdisplaymode = async ({ mode }) => {
    if (mode !== "inline") denied("displayMode");
    return { mode: "inline" };
  };
  bridge.fallbackRequestHandler = async () => unavailable("unknown");
  bridge.onloggingmessage = () => {};
  bridge.fallbackNotificationHandler = async () => {};
}
