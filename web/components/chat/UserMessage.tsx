import { useState } from "react";
import { FileText } from "lucide-react";
import type { Json } from "../../../shared/types";
import AttachmentPreview, { type AttachmentSource } from "../AttachmentPreview";
/** Shared by the optimistic submission and the persisted native echo. */
export default function UserMessage({ content }: { content: Json[] }) {
  const [preview, setPreview] = useState<AttachmentSource | null>(null);
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .filter(Boolean)
    .join("\n");
  const media = content.filter(
    (c) => c.type === "image" || c.type === "attachment",
  );
  return (
    <div className="user-message" data-content-kind="user">
      <div className="user-message-stack">
        {text && <div className="user-bubble">{text}</div>}
        {media.map((c, i) => (
          <button
            key={c.id || i}
            type="button"
            className={c.type === "image" ? "message-image" : "message-file"}
            aria-label={`预览 ${c.name || "图片"}`}
            onClick={() =>
              setPreview({
                name: c.name || "图片",
                url: c.url,
                mime: c.mime || (c.type === "image" ? "image/png" : undefined),
              })
            }
          >
            {c.type === "image" ? (
              <img src={c.url} alt={c.name || "用户附件"} />
            ) : (
              <>
                <FileText size={18} />
                <span>{c.name || "附件"}</span>
              </>
            )}
          </button>
        ))}
      </div>
      {preview && (
        <AttachmentPreview value={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
