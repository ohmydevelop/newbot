import { Component, Suspense, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
export class DeferredPanel extends Component<
  { label: string; onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  notice(failed: boolean) {
    return (
      <section
        className="deferred-panel"
        aria-label={`${this.props.label}加载状态`}
      >
        <p role={failed ? "alert" : "status"}>
          {!failed && (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          )}
          {failed
            ? `${this.props.label}暂时无法加载，可重新加载页面。`
            : `正在加载${this.props.label}…`}
        </p>
        {failed && (
          <p className="muted">
            未发送草稿仅保留在当前页面，请先复制需要保留的内容。
          </p>
        )}
        <div>
          <button
            type="button"
            className="secondary"
            onClick={this.props.onClose}
          >
            关闭提示
          </button>
          {failed && (
            <button
              type="button"
              className="primary"
              onClick={() => location.reload()}
            >
              重新加载页面
            </button>
          )}
        </div>
      </section>
    );
  }
  render() {
    return this.state.failed ? (
      this.notice(true)
    ) : (
      <Suspense fallback={this.notice(false)}>{this.props.children}</Suspense>
    );
  }
}
