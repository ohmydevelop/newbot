import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import type { Skill, SkillDocument, SkillReference } from "../../shared/types";
import { readSkill } from "../skills";
import { skillMarkdown, skillScopes, skillLabel } from "../../shared/skills";
import { Renderer } from "./Renderer";
import { request } from "../store";
export default function SkillReader({
  skill,
  reference,
  onBack,
  backLabel = "返回技能列表",
  pluginId,
}: {
  skill: Pick<Skill, "id" | "name" | "scope"> &
    Partial<Skill> & { displayName?: string };
  reference?: SkillReference;
  onBack: () => void;
  backLabel?: string;
  pluginId?: string;
}) {
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("preview");
  const [revision, setRevision] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [skill.id]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setDocument(null);
    body.current?.scrollTo(0, 0);
    const timer = setTimeout(() => {
      if (!active) return;
      setError("技能说明读取超时，请重试");
      setBusy(false);
      controller.abort();
    }, 20000);
    void (
      pluginId
        ? request<SkillDocument>("plugin/skill/read", {
            pluginId,
            id: skill.id,
          })
        : readSkill(skill.id, controller.signal)
    )
      .then((value) => {
        if (active && !controller.signal.aborted) setDocument(value);
      })
      .catch((reason) => {
        if (active && !controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "技能说明读取失败，请重试",
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (active && !controller.signal.aborted) setBusy(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [skill.id, revision, pluginId]);
  const current = document?.skill || skill;
  const markdown = document ? skillMarkdown(document.content) : "";
  return (
    <div className="skill-reader">
      <div className="skill-reader-toolbar">
        <button className="skill-back" onClick={onBack}>
          <ArrowLeft size={17} aria-hidden="true" />
          {backLabel}
        </button>
        <div className="artifact-modes" role="group" aria-label="技能查看方式">
          <button
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            说明
          </button>
          <button
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            源码
          </button>
        </div>
        <button
          className="icon-button"
          aria-label="重新读取技能说明"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="skill-document-body" ref={body} aria-busy={busy}>
        <h3 ref={title} tabIndex={-1}>
          {skillLabel(current)}
        </h3>
        <p className="skill-description">{current.description}</p>
        {current.removalReason && !pluginId && (
          <p className="skill-origin-note muted">{current.removalReason}</p>
        )}
        <p className="skill-metadata">
          {pluginId ? "插件技能" : skillScopes[current.scope] || "已发现技能"} ·{" "}
          {typeof current.enabled === "boolean"
            ? current.enabled
              ? "已启用"
              : "已停用"
            : "历史指定"}{" "}
          · SKILL.md
        </p>
        {reference && document && document.sha256 !== reference.sha256 && (
          <p className="skill-reference-notice" role="status">
            说明已变化，以下显示当前版本。
          </p>
        )}
        {reference &&
          document &&
          (document.skill.name !== reference.name ||
            skillLabel(document.skill) !== reference.displayName) && (
            <p className="skill-reference-notice" role="status">
              此消息指定时的名称：{reference.displayName}
            </p>
          )}
        {busy ? (
          <p className="skill-load" role="status">
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            正在读取技能说明…
          </p>
        ) : error ? (
          <div className="skill-read-error">
            <p className="inline-error" role="alert">
              {error}
            </p>
            <button
              className="secondary"
              onClick={() => setRevision((n) => n + 1)}
            >
              重试读取
            </button>
          </div>
        ) : (
          document && (
            <div className="skill-document-content">
              {!document.content ? (
                <p className="muted">说明文件为空。</p>
              ) : mode === "source" ? (
                <pre className="skill-source" aria-label="SKILL.md 源码">
                  {document.content}
                </pre>
              ) : markdown.trim() ? (
                <Renderer text={markdown} document />
              ) : (
                <p className="muted">
                  此文件仅包含技能元数据，可切换源码查看。
                </p>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
