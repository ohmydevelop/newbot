import { Component, type ReactNode } from "react";
import { resourceLoadFailure } from "../../resource-errors";
export class ContentBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; resource: boolean }
> {
  state = { failed: false, resource: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, resource: resourceLoadFailure(error) };
  }
  render() {
    return this.state.failed ? (
      <div className="message-fallback" role="status">
        <p>
          {this.state.resource
            ? "显示资源未能加载，其他消息仍可使用。"
            : "这条内容暂时无法显示，其他消息仍可使用。"}
        </p>
        {this.state.resource && (
          <p className="muted">
            重新加载会清空当前页面的未发送草稿，请先复制需要保留的内容。
          </p>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            this.state.resource
              ? location.reload()
              : this.setState({ failed: false, resource: false })
          }
        >
          {this.state.resource ? "重新加载页面" : "重新显示内容"}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
