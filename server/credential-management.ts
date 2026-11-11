import { PublicError } from "./public-error.js";
import type { credentialVault, CredentialScope } from "./credential-vault.js";
import { credentialBinding, managedCredential } from "./credential-vault.js";
import type {
  credentialSave,
  credentialClear,
  gatewayCredentialSave,
} from "../shared/credentials.js";
import { newGatewayId } from "../shared/gateways.js";
import type { z } from "zod";
import { providerEditable } from "./provider-policy.js";
import { mcpEditable } from "./mcp-policy.js";
import type { CredentialConsumer } from "./credentials.js";
import type { configuration } from "./configuration.js";
import type { bridge } from "./bridge.js";
export function credentialManagement(
  service: ReturnType<typeof bridge>,
  vault: ReturnType<typeof credentialVault>,
) {
  async function validate(
    core: ReturnType<typeof configuration>,
    data: {
      scope: CredentialScope;
      targetId: string;
      expectedRevision: string;
      expectedVaultVersion: string;
    },
    eligible = true,
  ) {
    const snapshot = await core.read();
    if (!core.matches(snapshot, data.expectedRevision, `${data.scope}:${data.targetId}`))
      throw new PublicError("配置已变化，请重新读取");
    const editable =
      data.scope === "provider"
        ? providerEditable(snapshot.response, data.targetId)
        : mcpEditable(snapshot.response, data.targetId);
    if (!editable) throw new PublicError("此配置不属于可编辑用户配置");
    const info = vault.info(
      data.scope,
      data.targetId,
      snapshot.response.config,
    );
    if (info.version !== data.expectedVaultVersion)
      throw new PublicError("凭证已变化，请重新读取");
    const binding = credentialBinding(
      data.scope,
      data.targetId,
      snapshot.response.config,
    );
    if (eligible && !binding) throw new PublicError("此接收方不支持托管凭证");
    return { snapshot, binding, info };
  }
  const keyPath = (scope: CredentialScope, id: string) =>
    scope === "provider"
      ? `model_providers.${id}.env_key`
      : `mcp_servers.${id}.bearer_token_env_var`;
  async function prepare(
    data: z.infer<typeof credentialSave>,
  ): Promise<CredentialConsumer> {
    const before = await service.inspectPrivateConfiguration((core) =>
      validate(core, data),
    );
    if (data.retention === "encrypted" && !vault.encryptionAvailable)
      throw new PublicError("加密凭证存储已锁定");
    return {
      receiver: before.binding!.origin,
      run: async (secret, _signal, authorized, commit) =>
        service.privateConfiguration(true, async (core) => {
          let ref: string | undefined,
            saved = false;
          try {
            const { binding } = await validate(core, data);
            if (!authorized()) throw new PublicError("私密请求已失效");
            ref = vault.stage(
              data.scope,
              data.targetId,
              binding!.binding,
              data.retention,
              secret,
            );
            commit();
            const result = await core.mutate(
              (await core.read()).publicView.revision,
              async () => ({
                edits: [
                  {
                    keyPath: keyPath(data.scope, data.targetId),
                    value: ref!,
                    mergeStrategy: "replace",
                  },
                ],
                effective: (after) =>
                  credentialBinding(
                    data.scope,
                    data.targetId,
                    after.response.config,
                  )?.ref === ref,
              }),
            );
            if (result.state !== "applied")
              throw new PublicError("凭证配置未生效");
            saved = true;
            vault.prune(data.scope, data.targetId, ref);
            try {
              const actual = await service.reloadPrivateRuntime();
              const rows =
                data.scope === "provider"
                  ? actual.configuration?.providers
                  : actual.configuration?.mcp;
              return {
                state: "succeeded",
                applied:
                  rows?.find((row: { id: string }) => row.id === data.targetId)
                    ?.managedCredential?.applied === true,
              };
            } catch {
              return { state: "succeeded", applied: false };
            }
          } catch {
            if (!saved && ref) {
              // Read authoritative config before dropping a staged secret. An
              // uncertain write may already point to it; never destroy it blindly.
              try {
                const actual = await core.read();
                const field =
                  data.scope === "provider"
                    ? actual.response.config.model_providers
                    : (actual.response.config as any).mcp_servers;
                const definition = (field as any)?.[data.targetId];
                if (
                  definition?.[
                    data.scope === "provider"
                      ? "env_key"
                      : "bearer_token_env_var"
                  ] === ref
                )
                  return { state: "succeeded", applied: false };
                vault.drop(ref);
              } catch {
                /* Keep a bounded orphan until the outcome can be inspected. */
              }
            }
            return { state: "failed", reason: "save_unconfirmed" };
          }
        }),
    };
  }
  async function clear(data: z.infer<typeof credentialClear>) {
    return service.privateConfiguration(false, async (core) => {
      const { snapshot } = await validate(core, data, false);
      const definitions = (snapshot.response.config as any)[
        data.scope === "provider" ? "model_providers" : "mcp_servers"
      ];
      const ref =
        definitions?.[data.targetId]?.[
          data.scope === "provider" ? "env_key" : "bearer_token_env_var"
        ];
      if (!managedCredential(ref)) {
        if (
          !vault.info(data.scope, data.targetId, snapshot.response.config)
            .stored
        )
          throw new PublicError("此凭证不是工作台管理的引用");
      } else {
        const result = await core.mutate((await core.read()).publicView.revision, async () => ({
          edits: [
            {
              keyPath: keyPath(data.scope, data.targetId),
              value: null,
              mergeStrategy: "replace",
            },
          ],
          effective: (after) =>
            !(after.response.config as any)[
              data.scope === "provider" ? "model_providers" : "mcp_servers"
            ]?.[data.targetId]?.[
              data.scope === "provider" ? "env_key" : "bearer_token_env_var"
            ],
        }));
        if (result.state !== "applied")
          throw new PublicError("清除结果未确认，请重新读取");
      }
      vault.prune(data.scope, data.targetId);
      try {
        await service.reloadPrivateRuntime();
        return { state: "cleared", applied: true };
      } catch {
        return { state: "cleared", applied: false };
      }
    });
  }
  async function prepareGateway(
    data: z.infer<typeof gatewayCredentialSave>,
  ): Promise<CredentialConsumer> {
    const id = data.targetId || newGatewayId(data.requestId);
    async function checked(core: ReturnType<typeof configuration>) {
      const snapshot = await core.read();
      if (!core.matches(snapshot, data.expectedRevision, data.targetId ? `provider:${data.targetId}` : undefined))
        throw new PublicError("配置已变化，请重新读取");
      const previous = (snapshot.response.config.model_providers as any)?.[id];
      if (data.targetId) {
        if (
          !providerEditable(snapshot.response, id) &&
          !service.isMissingProvider(id)
        )
          throw new PublicError("此网关由其他来源管理");
        if (
          vault.info("provider", id, snapshot.response.config).version !==
          data.expectedVaultVersion
        )
          throw new PublicError("凭证已变化，请重新读取");
      } else if (previous || snapshot.publicView.defaults.provider === id) {
        throw new PublicError("此保存请求已使用，请重新读取配置确认结果");
      }
      const definition = {
        ...(previous || { wire_api: "responses", requires_openai_auth: false }),
        name: data.name,
        ...(data.baseUrl ? { base_url: data.baseUrl.replace(/\/+$/, "") } : {}),
      };
      const binding = credentialBinding("provider", id, {
        model_providers: { [id]: definition },
      });
      if (!binding)
        throw new PublicError("此网关不支持密钥托管，请使用 HTTPS 连接地址");
      return { definition, binding };
    }
    const before = await service.inspectPrivateConfiguration(checked);
    if (data.retention === "encrypted" && !vault.encryptionAvailable)
      throw new PublicError("加密凭证存储已锁定");
    return {
      receiver: before.binding.origin,
      targetId: id,
      run: async (secret, _signal, authorized, commit) =>
        service.privateConfiguration(true, async (core) => {
          let ref: string | undefined;
          try {
            const { definition, binding } = await checked(core);
            if (!authorized()) throw new PublicError("私密请求已失效");
            ref = vault.stage(
              "provider",
              id,
              binding.binding,
              data.retention,
              secret,
            );
            const value = { ...definition, env_key: ref };
            commit();
            const result = await core.mutate(
              (await core.read()).publicView.revision,
              async () => ({
                edits: [
                  ...(data.customModels !== undefined && core.runtime
                    ? [
                        {
                          keyPath: `newbot_models.${id}`,
                          value: data.customModels,
                          mergeStrategy: "replace" as const,
                        },
                      ]
                    : []),
                  {
                    keyPath: `model_providers.${id}`,
                    value,
                    mergeStrategy: "replace",
                  },
                ],
                effective: (after) => {
                  const p = (after.response.config.model_providers as any)?.[
                    id
                  ];
                  return (
                    p?.env_key === ref &&
                    p?.name === definition.name &&
                    credentialBinding("provider", id, after.response.config)
                      ?.binding === binding.binding
                  );
                },
              }),
            );
            if (result.state !== "applied")
              throw new PublicError("配置未完全生效");
            vault.prune("provider", id, ref);
            try {
              const actual = await service.reloadPrivateRuntime();
              return {
                state: "succeeded",
                applied:
                  actual.configuration?.providers.find(
                    (p: { id: string }) => p.id === id,
                  )?.managedCredential?.applied === true,
              };
            } catch {
              return { state: "succeeded", applied: false };
            }
          } catch {
            if (ref) {
              try {
                const actual = await core.read();
                if (
                  (actual.response.config.model_providers as any)?.[id]
                    ?.env_key === ref
                )
                  return { state: "succeeded", applied: false };
                vault.drop(ref);
              } catch {
                /* Unconfirmed writes retain their staged credential for reconciliation. */
              }
            }
            return { state: "failed", reason: "save_unconfirmed" };
          }
        }),
    };
  }
  return { prepare, prepareGateway, clear };
}
