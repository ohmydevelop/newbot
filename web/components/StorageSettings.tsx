import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import type { StorageCleanup, StorageUsage } from "../../shared/types";
import { artifactFetch } from "../artifacts";
import { formatFileSize } from "../../shared/artifact-preview";
export default function StorageSettings() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy("read");
    setError("");
    void artifactFetch("/api/storage", { signal: controller.signal })
      .then((r) => r.json())
      .then((value) => {
        if (!controller.signal.aborted) setUsage(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy("");
      });
    return () => controller.abort();
  }, [revision]);
  async function clean() {
    setBusy("clean");
    setError("");
    setNotice("");
    try {
      const response = await artifactFetch("/api/storage/cleanup", {
        method: "POST",
      });
      const result = (await response.json()) as StorageCleanup;
      setUsage(result.usage);
      setNotice(
        `已清理 ${result.removedFiles} 项，释放 ${formatFileSize(result.releasedBytes)} 配额。`,
      );
      if (result.failedFiles) setError("部分文件未能清理，请稍后重试。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="storage-heading">
        <h3>文件存储</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新存储用量"
          disabled={!!busy}
          onClick={() => {
            setNotice("");
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>
      <p className="muted">上传附件与已保存的文件版本共用存储配额。</p>
      {busy === "read" && !usage && (
        <p className="storage-feedback" role="status">
          <LoaderCircle size={17} className="spin" aria-hidden="true" />
          正在读取存储用量…
        </p>
      )}
      {usage && (
        <>
          <div className="storage-total">
            <strong>{formatFileSize(usage.usedBytes)}</strong>
            <span> / {formatFileSize(usage.limitBytes)}</span>
          </div>
          <progress
            className="storage-progress"
            aria-label="文件存储使用量"
            value={Math.min(usage.usedBytes, usage.limitBytes)}
            max={usage.limitBytes}
          />
          {usage.usedBytes >= usage.limitBytes && (
            <p className="inline-error">存储配额已满，新的文件暂时无法保存。</p>
          )}
          <dl className="storage-breakdown">
            <div>
              <dt>已保存的快照</dt>
              <dd>{formatFileSize(usage.snapshotBytes)}</dd>
            </div>
            <div>
              <dt>上传附件</dt>
              <dd>{formatFileSize(usage.uploadsBytes)}</dd>
            </div>
            <div>
              <dt>未登记的文件</dt>
              <dd>{formatFileSize(usage.untrackedBytes)}</dd>
            </div>
            <div>
              <dt>历史版本</dt>
              <dd>
                {usage.versions} 个 · {usage.snapshots} 份独立快照
              </dd>
            </div>
          </dl>
          <div className="storage-cleanup">
            <div>
              <strong>可清理 {formatFileSize(usage.reclaimableBytes)}</strong>
              <p>
                清理超过 24
                小时、未被对话引用的临时附件和快照。历史版本与归档文件保留。
              </p>
            </div>
            <button
              type="button"
              className="secondary artifact-download-button"
              disabled={!!busy || !usage.reclaimableFiles}
              onClick={() => void clean()}
            >
              {busy === "clean" ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
              清理未使用文件
            </button>
          </div>
          {usage.legacyUploadBytes > 0 && (
            <p className="muted">
              保留的未登记旧附件占用 {formatFileSize(usage.legacyUploadBytes)}
              ，不会自动清理。
            </p>
          )}
          <p className="muted storage-limits">
            单份产物最多 {formatFileSize(usage.limits.artifactBytes)}，文本最多{" "}
            {formatFileSize(usage.limits.textBytes)}。
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="storage-feedback">
          {notice}
        </p>
      )}
    </>
  );
}
