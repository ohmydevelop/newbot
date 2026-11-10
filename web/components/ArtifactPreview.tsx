import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";
import { FileText, LoaderCircle, RotateCw } from "lucide-react";
import type { Artifact } from "../../shared/types";
import {
  artifactLanguage,
  csvPreview,
  formatFileSize,
  jsonPreview,
  previewText,
} from "../../shared/artifact-preview";
import { artifactEndpoint, artifactFetch } from "../artifacts";
import { useApp } from "../store";
import { Modal } from "./ui";
import { ArtifactDownload } from "./ArtifactDownload";
import { useArtifactVersions } from "./useArtifactVersions";
import { Code, Renderer } from "./Renderer";
const PdfPreview = lazy(() => import("./PdfPreview"));
const HtmlPreview = lazy(() => import("./HtmlPreview"));
function DocumentContent({
  artifact,
  text,
  mode,
}: {
  artifact: Artifact;
  text: string;
  mode: string;
}) {
  const clipped = useMemo(() => previewText(text), [text]);
  const json = useMemo(
    () => (artifact.kind === "json" ? jsonPreview(text) : null),
    [artifact.kind, text],
  );
  const csv = useMemo(
    () =>
      artifact.kind === "csv" && mode === "preview" ? csvPreview(text) : null,
    [artifact.kind, text, mode],
  );
  const notice = (
    <p className="artifact-preview-note">
      仅显示部分内容，下载可查看完整文件。
    </p>
  );
  if (mode === "preview" && artifact.kind === "markdown")
    return (
      <>
        {clipped.truncated && notice}
        <Renderer text={clipped.text} document />
      </>
    );
  if (csv) {
    if (csv.error)
      return (
        <>
          <p className="artifact-preview-note" role="status">
            {csv.error}
          </p>
          <Code code={clipped.text} language="text" />
          {clipped.truncated && notice}
        </>
      );
    if (!csv.rows.length) return <p className="muted">文件为空。</p>;
    const columns = Math.max(...csv.rows.map((r) => r.length));
    return (
      <>
        {csv.truncated && (
          <p className="artifact-preview-note">
            表格预览最多显示 100 行数据、30
            列及部分单元格内容。下载可查看完整文件。
          </p>
        )}
        <div
          className="artifact-table"
          role="region"
          aria-label={`${artifact.name} 表格预览`}
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">
              {artifact.name}，首行用作列标题
            </caption>
            <thead>
              <tr>
                {Array.from({ length: columns }, (_, i) => (
                  <th scope="col" key={i}>
                    {csv.rows[0][i] || `列 ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.rows.slice(1).map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: columns }, (_, i) => (
                    <td key={i}>{row[i] || ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="artifact-preview-note">首行用作列标题。</p>
      </>
    );
  }
  const value = mode === "preview" && json ? json : clipped;
  return (
    <>
      {artifact.kind === "html" && (
        <p className="artifact-preview-note">当前以源码方式查看 HTML。</p>
      )}
      {mode === "preview" && json?.error && (
        <p className="artifact-preview-note" role="status">
          {json.error}
        </p>
      )}
      {value.truncated && notice}
      {!value.text ? (
        <p className="muted">文件为空。</p>
      ) : artifact.kind === "text" || artifact.kind === "csv" ? (
        <pre className="artifact-plain">{value.text}</pre>
      ) : (
        <Code language={artifactLanguage(artifact.path)} code={value.text} />
      )}
    </>
  );
}
export default function ArtifactPreview({
  artifact: original,
  onClose,
  onCloseAutoFocus,
}: {
  artifact: Artifact;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [artifact, setArtifact] = useState(original);
  const versionEnabled = useApp((s) => s.artifactVersions);
  const history = useArtifactVersions(original, versionEnabled);
  const [text, setText] = useState("");
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [revision, setRevision] = useState(0);
  const pdfEnabled = useApp((s) => s.pdfPreview);
  const htmlEnabled = useApp((s) => s.htmlPreview);
  const [mode, setMode] = useState(
    artifact.kind === "html" && !htmlEnabled ? "source" : "preview",
  );
  const htmlActive = artifact.kind === "html" && mode === "preview";
  const panelId = useId();
  useEffect(() => {
    if (artifact.kind === "pdf" || htmlActive) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let url = "";
    setLoading(true);
    setError("");
    setImage("");
    setText("");
    void artifactFetch(artifactEndpoint(artifact.id), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (artifact.kind === "image") {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          url = URL.createObjectURL(blob);
          setImage(url);
        } else {
          const value = await response.text();
          if (!controller.signal.aborted) setText(value);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifact.id, artifact.kind, revision, htmlActive]);
  const toggle = ["markdown", "json", "csv", "html"].includes(artifact.kind);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={artifact.name}
      wide
      className={`artifact-modal ${artifact.kind === "pdf" && pdfEnabled ? "pdf-modal" : ""}`}
    >
      <div className="artifact-toolbar">
        <div className="artifact-path" title={artifact.path}>
          {artifact.path}
          <span>
            v{artifact.version} · {formatFileSize(artifact.size)}
          </span>
        </div>
        <div className="artifact-preview-actions">
          {toggle && (
            <div className="artifact-modes" role="group" aria-label="查看方式">
              {["preview", "source"].map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={
                    artifact.kind === "html" &&
                    value === "preview" &&
                    !htmlEnabled
                  }
                  aria-pressed={mode === value}
                  aria-controls={panelId}
                  onClick={() => setMode(value)}
                >
                  {value === "source"
                    ? "源码"
                    : artifact.kind === "json"
                      ? "格式化"
                      : artifact.kind === "csv"
                        ? "表格"
                        : "预览"}
                </button>
              ))}
            </div>
          )}
          {htmlActive && (
            <button
              type="button"
              className="secondary artifact-download-button"
              aria-label="重新加载预览"
              title="重新加载预览"
              onClick={() => setRevision((n) => n + 1)}
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>
          )}
          <ArtifactDownload artifact={artifact} onError={setDownloadError} />
        </div>
      </div>
      {versionEnabled && (
        <div className="artifact-version-bar">
          <label htmlFor={`${panelId}-version`}>版本</label>
          <select
            id={`${panelId}-version`}
            aria-label="文件版本"
            value={artifact.id}
            disabled={history.busy}
            onChange={(event) => {
              const selected = history.versions.find(
                (a) => a.id === event.target.value,
              );
              if (!selected) return;
              setArtifact(selected);
              setText("");
              setImage("");
              setError("");
              setDownloadError("");
              setLoading(true);
              setRevision(0);
              setMode(
                selected.kind === "html" && !htmlEnabled ? "source" : "preview",
              );
            }}
          >
            {[
              ...new Map(
                [artifact, ...history.versions].map((a) => [a.id, a]),
              ).values(),
            ]
              .sort((a, b) => b.version - a.version)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  v{a.version}
                  {a.id === original.id ? " · 此回复" : ""}
                  {a.version === history.latest ? " · 最新" : ""}
                </option>
              ))}
          </select>
          {history.next && (
            <button
              type="button"
              className="version-more"
              disabled={history.busy}
              onClick={history.more}
            >
              更早版本
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="刷新文件版本"
            disabled={history.busy}
            onClick={history.refresh}
          >
            <RotateCw size={15} aria-hidden="true" />
          </button>
          {history.error && (
            <span className="inline-error" role="alert">
              版本列表读取失败，可重试刷新。
            </span>
          )}
        </div>
      )}
      {htmlActive && (
        <p className="artifact-preview-note html-preview-note">
          仅支持自包含页面，外部资源不可用。
        </p>
      )}
      {downloadError && (
        <p className="inline-error artifact-inline-error" role="alert">
          {downloadError}
        </p>
      )}
      <div
        className={`artifact-preview-body ${artifact.kind === "image" ? "is-image" : ""} ${htmlActive ? "is-html" : ""} ${artifact.kind === "pdf" && pdfEnabled ? "is-pdf" : ""}`}
        id={panelId}
        aria-busy={loading}
      >
        {htmlActive ? (
          <Suspense
            fallback={
              <p className="muted" role="status">
                正在加载预览…
              </p>
            }
          >
            <HtmlPreview
              key={`${artifact.id}:${revision}`}
              artifact={artifact}
              onClose={onClose}
              onReload={() => setRevision((n) => n + 1)}
            />
          </Suspense>
        ) : loading ? (
          <div className="artifact-state" role="status">
            <LoaderCircle size={22} className="spin" aria-hidden="true" />
            <p>正在读取文件…</p>
          </div>
        ) : error ? (
          <div className="artifact-state">
            <p className="inline-error" role="alert">
              {error}
            </p>
            <button
              type="button"
              className="secondary artifact-download-button"
              onClick={() => setRevision((n) => n + 1)}
            >
              <RotateCw size={16} aria-hidden="true" />
              重新读取
            </button>
          </div>
        ) : artifact.kind === "image" ? (
          <img
            className="artifact-image"
            src={image}
            alt={artifact.name}
            onError={() => setError("图片无法显示，请下载后查看或重新读取")}
          />
        ) : artifact.kind === "pdf" && pdfEnabled ? (
          <Suspense
            fallback={
              <p className="muted" role="status">
                正在加载 PDF 阅读器…
              </p>
            }
          >
            <PdfPreview key={artifact.id} artifact={artifact} />
          </Suspense>
        ) : artifact.kind === "pdf" ? (
          <div className="artifact-state">
            <FileText size={28} aria-hidden="true" />
            <p>此文件暂不支持预览，可下载后查看。</p>
          </div>
        ) : (
          <>
            {artifact.kind === "html" && !htmlEnabled && (
              <p className="artifact-preview-note">
                此实例尚未启用页面运行预览，可查看源码或下载。
              </p>
            )}
            <DocumentContent artifact={artifact} text={text} mode={mode} />
          </>
        )}
      </div>
    </Modal>
  );
}
