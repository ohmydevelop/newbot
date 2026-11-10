import { AlertCircle, X } from "lucide-react";
import { loadThread, useApp } from "../../store";
export function BackgroundNotice() {
  const failure = useApp((s) => s.backgroundFailure),
    selected = useApp((s) => s.selectedId);
  if (!failure || failure.threadId === selected) return null;
  return (
    <div className="background-notice" role="status" aria-label="后台任务提示">
      <AlertCircle size={16} aria-hidden="true" />
      <span>另一个对话需要查看任务状态。</span>
      <button
        className="secondary"
        type="button"
        onClick={() => void loadThread(failure.threadId)}
      >
        查看对话
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="关闭后台任务提示"
        onClick={() => useApp.setState({ backgroundFailure: null })}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
