import { ConfigCodex } from "./config-fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";
export class ProviderCodex extends ConfigCodex {
  restarts = 0;
  failRestart = false;
  nativeReferences: { provider: string; archived: boolean }[] = [];
  constructor(endpoint = "http://127.0.0.1:9/v1") {
    super();
    this.config.model_providers.secondary = {
      name: "备用 Provider",
      base_url: endpoint,
      wire_api: "responses",
      requires_openai_auth: false,
      http_headers: { "X-Test": "preserved-private-header" },
      request_max_retries: 2,
    };
  }
  override async restart() {
    this.restarts++;
    if (this.failRestart) {
      this.failRestart = false;
      throw new Error("synthetic restart failure");
    }
    this.state = "ready";
    if (this.credentialSource)
      this.credentialRefs = new Set(Object.keys(await this.credentialSource()));
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    if (method === "thread/list") {
      this.calls.push({ method, params });
      const p = params as any;
      return {
        data: this.nativeReferences
          .filter(
            (r) =>
              p.modelProviders.includes(r.provider) &&
              r.archived === p.archived,
          )
          .map(() => ({ id: "native-history" })),
        nextCursor: null,
      } as unknown as Result<M>;
    }
    const result = (await super.call(method, params)) as any;
    if (method === "model/list" && this.config.model_provider === "secondary") {
      result.data = [
        {
          ...result.data[0],
          id: "secondary-model",
          model: "secondary-model",
          displayName: "备用模型",
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "low" },
          ],
        },
      ];
    }
    if (method === "thread/start") {
      result.thread.modelProvider = this.config.model_provider;
      this.threads.get(result.thread.id)!.modelProvider =
        this.config.model_provider;
    }
    return result;
  }
}
