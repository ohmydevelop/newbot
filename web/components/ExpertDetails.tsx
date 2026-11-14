import { useEffect, useState } from "react";
import type {
  Expert,
  ExpertReference,
  ExpertMembers,
} from "../../shared/experts";
import { request } from "../store";
import { Modal } from "./ui";
import { CatalogDetail, CatalogUse } from "./CatalogNavigation";
export type ExpertCatalog = {
  entries: Expert[];
  catalog: Record<
    "skills" | "plugins" | "connectors",
    { id: string; name: string; enabled: boolean }[]
  >;
};
export const memberGroups = [
  { key: "skillIds", catalog: "skills", label: "技能", max: 8 },
  { key: "pluginIds", catalog: "plugins", label: "插件", max: 8 },
  { key: "connectorIds", catalog: "connectors", label: "连接器", max: 16 },
] as const;
export function ExpertMembersView({
  expert,
  catalog,
}: {
  expert: ExpertMembers;
  catalog: ExpertCatalog["catalog"];
}) {
  return (
    <div className="expert-member-summary">
      {memberGroups
        .filter((g) => expert[g.key].length)
        .map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h4>{g.label}</h4>
            <ul>
              {expert[g.key].map((id) => {
                const member = catalog[g.catalog].find((x) => x.id === id);
                return (
                  <li key={id}>
                    <span>{member?.name || "已移除的扩展"}</span>
                    {!member ? (
                      <small className="danger-text">已移除</small>
                    ) : !member.enabled ? (
                      <small className="danger-text">已停用</small>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
export default function ExpertDetails({
  value,
  onClose,
}: {
  value: ExpertReference;
  onClose: () => void;
}) {
  const [data, setData] = useState<ExpertCatalog | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    void request<ExpertCatalog>("expert/list")
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [value.id, reload]);
  const expert = data?.entries.find((e) => e.id === value.id);
  return (
    <CatalogDetail
      open
      title={value.name}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="expert-detail-modal"
    >
      <div className="expert-detail-body">
        {error ? (
          <p className="inline-error" role="alert">
            {error}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => setReload((v) => v + 1)}
            >
              重试
            </button>
          </p>
        ) : !data ? (
          <p role="status">正在读取专家…</p>
        ) : !expert ? (
          <p role="status">专家已移除，请从会话中移除或重新选择。</p>
        ) : (
          <>
            {expert.description && (
              <p className="expert-description">{expert.description}</p>
            )}
            {expert.instructions && (
              <section className="expert-instructions">
                <h3>提示词</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{expert.instructions}</p>
              </section>
            )}
            {!!expert.problems.length && (
              <p className="inline-error" role="status">
                {expert.problems.join("；")}
              </p>
            )}
            {expert.revision !== value.revision && (
              <p className="muted">专家已更新，下一轮使用当前配置。</p>
            )}
            <ExpertMembersView expert={expert} catalog={data.catalog} />
            <CatalogUse
              kind="@"
              entry={{ ...expert, kind: "expert" }}
              disabled={!expert.available}
            />
          </>
        )}
      </div>
    </CatalogDetail>
  );
}
