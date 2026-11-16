import { useRef, useState } from "react";
import { RefreshCw, LoaderCircle } from "lucide-react";
import { SearchIcon } from "./ReferenceIcons";
import { request } from "../store";

type Catalog = {
  server: string;
  revision: string;
  entries: { name: string; description: string; allowed: boolean }[];
};
export default function ReadOnlyToolAccess({ server }: { server: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const posting = useRef(false);
  async function read() {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setCatalog(await request<Catalog>("mode/tools/read", { server }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "工具读取失败，请重试");
    } finally {
      setBusy(false);
      posting.current = false;
    }
  }
  async function change(name: string, enabled: boolean) {
    if (!catalog || posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const before = catalog;
    setCatalog({
      ...catalog,
      entries: catalog.entries.map((e) =>
        e.name === name ? { ...e, allowed: enabled } : e,
      ),
    });
    const tools = catalog.entries
      .filter((e) => (e.name === name ? enabled : e.allowed))
      .map((e) => e.name);
    try {
      setCatalog(
        await request<Catalog>("mode/tools/update", {
          server,
          expectedRevision: catalog.revision,
          tools,
        }),
      );
      setNotice("已保存，下次任务生效");
    } catch (error) {
      setCatalog(before);
      setError(
        error instanceof Error ? error.message : "保存失败，请刷新后重试",
      );
    } finally {
      setBusy(false);
      posting.current = false;
    }
  }
  const entries =
    catalog?.entries.filter((e) =>
      `${e.name} ${e.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ) || [];
  return (
    <details
      className="readonly-tools"
      onToggle={(e) => {
        if (e.currentTarget.open && !catalog) void read();
      }}
    >
      <summary>聊天与规划可用工具</summary>
      <p className="picker-note">
        仅允许你已确认不会修改文件或外部数据的工具。
      </p>
      <div className="picker-search">
        <SearchIcon size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索只读工具"
          placeholder="搜索工具"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="刷新只读工具"
          disabled={busy}
          onClick={() => void read()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <RefreshCw size={17} />
          )}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      {entries.map((entry) => (
        <label className="readonly-tool-row" key={entry.name}>
          <input
            type="checkbox"
            checked={entry.allowed}
            disabled={busy}
            aria-label={`允许 ${entry.name} 用于聊天与规划`}
            onChange={(e) => void change(entry.name, e.target.checked)}
          />
          <span>
            <strong>{entry.name}</strong>
            <small title={entry.description}>{entry.description}</small>
          </span>
        </label>
      ))}
      {!busy && catalog && !entries.length && (
        <p className="muted">{query ? "没有匹配的工具" : "尚未发现工具"}</p>
      )}
    </details>
  );
}
