import { lazy, Suspense, memo, useRef, useState } from "react";
import { FileCode2, FileText, Image, Plus, ChevronRight } from "lucide-react";
import type { Artifact, Turn } from "../../shared/types";
import { formatFileSize } from "../../shared/artifact-preview";
import { ArtifactDownload } from "./ArtifactDownload";
const Preview = lazy(() => import("./ArtifactPreview"));
const kindLabel: Record<Artifact["kind"], string> = {
  text: "文本",
  code: "代码",
  markdown: "Markdown",
  json: "JSON",
  csv: "CSV",
  html: "HTML",
  image: "图片",
  pdf: "PDF",
};
const reasons: Record<string, string> = {
  capture_interrupted: "保存时服务已中断，可从工作区重新添加",
  capture_busy: "保存队列已满，可从工作区重新添加",
  change_limit: "本次修改文件较多，请从工作区添加其余文件",
  storage_limit: "文件存储空间不足",
  file_changed: "读取时文件发生变化，请重新添加",
  unsupported_type: "文件类型或文本大小不受支持",
  invalid_text: "文本编码不受支持",
  sensitive_content: "文件包含受限的凭证内容",
  file_too_large: "文件超过 8 MiB 保存上限，请先拆分或压缩",
  unsafe_file: "文件大小或类型不符合读取要求",
  unsafe_link: "链接文件不能读取",
  snapshot_corrupt: "文件快照校验失败",
  file_missing: "工作区文件不存在，可重新生成后添加",
};
export const Artifacts = memo(function Artifacts({
  threadId,
  turn,
  canAdd,
}: {
  threadId: string;
  turn: Turn;
  canAdd: boolean;
}) {
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [error, setError] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const allRecords = (turn.artifacts || []).filter((a) => a.source !== "media");
  const records = [
    ...new Map(
      [...allRecords]
        .sort((a, b) => a.version - b.version)
        .map((a) => [a.path, a]),
    ).values(),
  ];
  const notices = turn.artifactNotices || [];
  function restoreFocus(event: Event) {
    event.preventDefault();
    opener.current?.focus();
  }
  if (!records.length && !notices.length) return null;
  return (
    <section className="turn-artifacts" aria-label="本轮文件">
      {!!records.length && (
        <div className="artifact-cards">
          {records.map((artifact) => {
            const Icon =
              artifact.kind === "image"
                ? Image
                : ["code", "html", "json"].includes(artifact.kind)
                  ? FileCode2
                  : FileText;
            return (
              <div className="artifact-card" key={artifact.path}>
                <button
                  type="button"
                  className="artifact-open"
                  aria-label={`查看 ${artifact.name}，版本 ${artifact.version}`}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setPreview(artifact);
                    setError("");
                  }}
                >
                  <span className="artifact-icon">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span className="artifact-info">
                    <strong title={artifact.path}>{artifact.name}</strong>
                    <span>
                      {kindLabel[artifact.kind]} ·{" "}
                      {formatFileSize(artifact.size)} · v{artifact.version}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="artifact-chevron"
                    aria-hidden="true"
                  />
                </button>
                <ArtifactDownload
                  artifact={artifact}
                  compact
                  onError={setError}
                />
              </div>
            );
          })}
        </div>
      )}
      {!!notices.length && (
        <details className="artifact-notices">
          <summary>
            {notices.some((n) => n.state === "pending")
              ? "正在保存文件"
              : `${notices.length} 个文件未能保存`}
          </summary>
          <ul>
            {notices.map((n) => (
              <li key={`${n.itemId}:${n.path}`}>
                <span>{n.path || "文件修改"}</span>：
                {n.state === "pending"
                  ? "等待保存"
                  : reasons[n.reason || ""] ||
                    "文件保存失败，可从工作区重新添加"}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Suspense
        fallback={
          <p className="muted" role="status">
            正在打开文件…
          </p>
        }
      >
        {preview && (
          <Preview
            key={preview.id}
            artifact={preview}
            onClose={() => setPreview(null)}
            onCloseAutoFocus={restoreFocus}
          />
        )}
      </Suspense>
    </section>
  );
});
