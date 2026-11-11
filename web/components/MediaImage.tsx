import { useState } from "react";
import type { MediaReference } from "../../shared/types";
import AttachmentPreview from "./AttachmentPreview";
export function MediaImage({
  media,
  label = "图片",
}: {
  media?: MediaReference;
  label?: string;
}) {
  const [preview, setPreview] = useState(false),
    [failed, setFailed] = useState(false);
  const url =
    media?.state === "ready" &&
    /^\/api\/artifacts\/[a-f\d-]+\/content$/.test(media.url || "")
      ? media!.url
      : undefined;
  const name = media?.label || label;
  return (
    <span className="answer-image">
      {url && !failed ? (
        <button
          type="button"
          className="answer-image-button"
          aria-label={`放大图片：${name}`}
          onClick={() => setPreview(true)}
        >
          <img
            src={url}
            alt={name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </button>
      ) : (
        <span className="answer-image-placeholder" role="status">
          {media?.state === "pending"
            ? "正在保存图片…"
            : media?.reason ||
              (failed ? "图片无法读取，快照可能已损坏" : "没有可用的图片快照")}
        </span>
      )}
      {preview && url && (
        <AttachmentPreview
          value={{ name, url, mime: "image/png" }}
          onClose={() => setPreview(false)}
        />
      )}
    </span>
  );
}
export function MediaGallery({ items }: { items: MediaReference[] }) {
  return (
    <div className="answer-gallery">
      {items.map((media) => (
        <MediaImage key={media.id} media={media} />
      ))}
    </div>
  );
}
