import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import type { Artifact } from "../../shared/types";
import { downloadArtifact } from "../artifacts";
export function ArtifactDownload({
  artifact,
  compact = false,
  onError,
}: {
  artifact: Artifact;
  compact?: boolean;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={
        compact
          ? "icon-button artifact-download"
          : "secondary artifact-download-button"
      }
      disabled={busy}
      aria-label={`下载 ${artifact.name}`}
      title={`下载 ${artifact.name}`}
      onClick={() => {
        setBusy(true);
        onError("");
        void downloadArtifact(artifact)
          .catch((e) => onError((e as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? (
        <LoaderCircle size={17} className="spin" aria-hidden="true" />
      ) : (
        <Download size={17} aria-hidden="true" />
      )}
      {!compact && (busy ? "下载中…" : "下载")}
    </button>
  );
}
