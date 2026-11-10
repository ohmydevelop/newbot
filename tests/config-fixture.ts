import { FakeCodex } from "./fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";
export const configSecret = "SYNTHETIC_CONFIG_SECRET_DO_NOT_EXPOSE";
export class ConfigCodex extends FakeCodex {
  version = 1;
  contextVersion = 1;
  failRead = false;
  failWrite = false;
  raceWrite = false;
  loseResponse = false;
  failReadAfterWrite = false;
  changeContextAfterWrite = false;
  overridden = false;
  noWritableLayer = false;
  config: Record<string, any> = {
    model: "fixture-model",
    model_provider: "fixture",
    model_reasoning_effort: "medium",
    model_providers: {
      fixture: {
        name: "测试 Provider",
        base_url: `https://user:${configSecret}@api.example.com/private/${configSecret}?key=${configSecret}#${configSecret}`,
        wire_api: "responses",
        env_key: "PROVIDER_KEY_REFERENCE",
        api_key: configSecret,
        http_headers: { Authorization: `Bearer ${configSecret}` },
      },
    },
    mcp_servers: {
      remote: {
        url: `https://mcp.example.com/path/${configSecret}?token=${configSecret}`,
        enabled: false,
        bearer_token_env_var: "MCP_TOKEN_REFERENCE",
        http_headers: { Authorization: `Bearer ${configSecret}` },
        oauth: { access_token: configSecret },
      },
      local: {
        command: `/private/${configSecret}`,
        args: ["--token", configSecret],
        env: { PASSWORD: configSecret },
      },
    },
    instructions: configSecret,
    unknown_private_field: { credential: configSecret },
  };
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    if (method === "config/read") {
      this.calls.push({ method, params });
      if (this.failRead) throw new Error(`native diagnostic ${configSecret}`);
      const user = {
        type: "user",
        file: "/private/config.toml",
        profile: null,
      };
      const project = { type: "project", dotCodexFolder: "/private/project" };
      const config = structuredClone(this.config);
      if (this.overridden) {
        config.model = "fixture-model";
        config.model_reasoning_effort = "medium";
      }
      return {
        config,
        origins: {
          model: {
            name: this.overridden ? project : user,
            version: String(this.version),
          },
          model_reasoning_effort: {
            name: this.overridden ? project : user,
            version: String(this.version),
          },
        },
        layers: this.noWritableLayer
          ? []
          : [
              {
                name: user,
                version: String(this.version),
                config: structuredClone(this.config),
                disabledReason: null,
              },
              {
                name: project,
                version: String(this.contextVersion),
                config: { private_value: configSecret },
                disabledReason: null,
              },
            ],
      } as unknown as Result<M>;
    }
    if (method === "config/batchWrite") {
      this.calls.push({ method, params });
      const p = params as any;
      if (this.raceWrite) {
        this.raceWrite = false;
        this.config.external_write = true;
        this.version++;
      }
      if (p.expectedVersion && p.expectedVersion !== String(this.version))
        throw new Error(`native version conflict ${configSecret}`);
      if (this.failWrite)
        throw new Error(`native write failed ${configSecret}`);
      for (const edit of p.edits) {
        const parts = edit.keyPath.split(".");
        let parent = this.config;
        for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
        if (edit.value === null) delete parent[parts.at(-1)!];
        else parent[parts.at(-1)!] = structuredClone(edit.value);
      }
      this.version++;
      if (this.changeContextAfterWrite) {
        this.contextVersion++;
        this.changeContextAfterWrite = false;
      }
      if (this.failReadAfterWrite) {
        this.failRead = true;
        this.failReadAfterWrite = false;
      }
      if (this.loseResponse) {
        this.loseResponse = false;
        throw new Error(`lost response ${configSecret}`);
      }
      return {
        status: this.overridden ? "okOverridden" : "ok",
        version: String(this.version),
        filePath: "/private/config.toml",
        overriddenMetadata: this.overridden
          ? {
              message: configSecret,
              effectiveValue: configSecret,
              overridingLayer: {
                name: { type: "project", dotCodexFolder: "/private/project" },
                version: "1",
              },
            }
          : null,
      } as unknown as Result<M>;
    }
    const result = (await super.call(method, params)) as any;
    if (method === "model/list") {
      result.data[0].supportedReasoningEfforts = ["low", "medium", "high"].map(
        (reasoningEffort) => ({
          reasoningEffort,
          description: reasoningEffort,
        }),
      );
      result.data.push({
        ...result.data[0],
        id: "second-model",
        model: "second-model",
        displayName: "测试模型二",
        isDefault: false,
      });
    }
    return result;
  }
}
