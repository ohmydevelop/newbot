import { LoaderCircle, RotateCw } from "lucide-react";

/** A reserved status slot keeps background refreshes out of the document flow. */
export function ReadIndicator({
  busy,
  error,
  label,
  onRetry,
}: {
  busy: boolean;
  error?: string;
  label: string;
  onRetry?: () => void;
}) {
  return (
    <span className="read-indicator">
      {busy ? (
        <span role="status" className="read-progress">
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ) : error && onRetry ? (
        <button
          type="button"
          className="icon-button danger-text"
          title={`${error} 点击重试`}
          aria-label={`${error} 重试`}
          onClick={onRetry}
        >
          <RotateCw size={16} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
