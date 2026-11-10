import { lazy, Suspense, useEffect, useState } from "react";
import { ContentBoundary } from "./chat/ContentBoundary";
import { Modal } from "./ui";
const Renderer = lazy(() =>
  import("./Renderer").then((m) => ({ default: m.Renderer })),
);
export type AttachmentSource = {
  name: string;
  url?: string;
  mime?: string;
  file?: File;
};
function useSource(value: AttachmentSource) {
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (!value.file) return;
    const url = URL.createObjectURL(value.file);
    setLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);
  return value.file ? local : value.url || "";
}
export function AttachmentImage({ value }: { value: AttachmentSource }) {
  const url = useSource(value);
  return url ? <img src={url} alt={value.name} /> : null;
}
export default function AttachmentPreview({
  value,
  onClose,
}: {
  value: AttachmentSource;
  onClose: () => void;
}) {
  const url = useSource(value),
    [text, setText] = useState<string | null>(null),
    [error, setError] = useState("");
  const image =
    value.mime?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(value.name);
  useEffect(() => {
    if (image || !url) return;
    const abort = new AbortController();
    setText(null);
    setError("");
    void fetch(url, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("文件读取失败");
        const blob = await r.blob();
        if (blob.size > 200000) throw Error("此文件请下载后查看");
        return blob.text();
      })
      .then((v) => {
        if (!abort.signal.aborted) setText(v);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [url, image]);
  return (
    <Modal
      open
      title={value.name}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      wide
      className="attachment-preview"
    >
      <div className="attachment-preview-body">
        {image ? (
          url && <img src={url} alt={value.name} />
        ) : error ? (
          <p role="alert">{error}</p>
        ) : text === null ? (
          <p role="status">正在打开文件…</p>
        ) : /\.md$/i.test(value.name) ? (
          <ContentBoundary>
            <Suspense fallback={<pre>{text}</pre>}>
              <Renderer text={text} />
            </Suspense>
          </ContentBoundary>
        ) : (
          <pre>{text}</pre>
        )}
      </div>
      {url && (
        <a className="secondary" href={url} download={value.name}>
          下载文件
        </a>
      )}
    </Modal>
  );
}
