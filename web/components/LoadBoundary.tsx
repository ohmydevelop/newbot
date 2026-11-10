import { Component, type ReactNode } from "react";
export class LoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="boot">
          <div>
            <p role="alert">页面资源加载失败，请刷新后重试。</p>
            <p className="muted">重新加载会清空当前页面的未发送草稿。</p>
          </div>
          <button className="primary" onClick={() => location.reload()}>
            重新加载
          </button>
        </main>
      );
    return this.props.children;
  }
}
