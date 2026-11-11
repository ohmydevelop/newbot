import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Upload,
  Github,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  IMPORT_LIMITS,
  type ImportSession,
  type ImportChoice,
} from "../../shared/imports";
import { loadSettings } from "../store";
import { responseJson } from "../http";
import { Modal } from "./ui";
async function api(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch("/api/imports" + path, {
    method,
    headers:
      body instanceof File
        ? { "content-type": "application/octet-stream" }
        : body === undefined
          ? undefined
          : { "content-type": "application/json" },
    body:
      body instanceof File
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  const data = await responseJson(r);
  if (!r.ok) throw new Error(data.error || "导入未完成，请重试");
  return data;
}
export default function SkillImport({
  onClose,
  kind = "skills",
  updatePlugin,
}: {
  onClose: () => void;
  kind?: "skills" | "plugin";
  updatePlugin?: { id: string; name: string; displayName: string };
}) {
  const [session, setSession] = useState<ImportSession | null>(null),
    [recent, setRecent] = useState<ImportSession[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [github, setGithub] = useState(false),
    [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [packages, setPackages] = useState<Set<string>>(new Set()),
    [replace, setReplace] = useState<Set<string>>(new Set()),
    [page, setPage] = useState(0);
  const directory = useRef<HTMLInputElement>(null),
    zip = useRef<HTMLInputElement>(null),
    op = useRef<{ signature: string; id: string } | null>(null);
  const pendingFiles = useRef<{
    files: File[];
    kind: "files" | "zip";
    sessionId?: string;
  } | null>(null);
  useEffect(() => {
    void api("")
      .then(setRecent)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!session || !["scanning", "installing"].includes(session.state)) return;
    let active = true;
    const timer = setInterval(() => {
      void api("/" + session.id)
        .then((next) => {
          if (active) setSession(next);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.id, session?.state]);
  const pending =
    !!busy || (!!session && ["scanning", "installing"].includes(session.state));
  async function otherSource() {
    if (session?.retained) await api("/" + session.id, undefined, "DELETE");
    setSession(null);
    pendingFiles.current = null;
    setRecent(await api(""));
    setError("");
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入未完成");
    } finally {
      setBusy("");
    }
  }
  function preview(next: ImportSession) {
    setSession(next);
    setSelected(
      new Set(
        next.entries.flatMap(
          (e) => e.selectedSkills ?? e.skills.map((s) => s.id),
        ),
      ),
    );
    setPackages(
      new Set(
        next.entries
          .filter((e) => e.selectedSkills !== undefined && !e.previousDigest)
          .map((e) => e.id),
      ),
    );
    setReplace(new Set());
    setPage(0);
    op.current = null;
  }
  async function uploadFiles() {
    const pending = pendingFiles.current!;
    let id = pending.sessionId;
    if (!id) {
      const next = await api("", {
        kind: pending.kind,
        updatePluginId: updatePlugin?.id,
        name:
          pending.kind === "files"
            ? pending.files[0].webkitRelativePath.split("/")[0] ||
              pending.files[0].name
            : pending.files[0].name,
      });
      setSession(next);
      id = pending.sessionId = next.id;
    }
    for (const [index, file] of pending.files.entries()) {
      setBusy(`上传 ${index + 1} / ${pending.files.length}`);
      await api(
        `/${id}/${pending.kind === "zip" ? "archive" : "file?path=" + encodeURIComponent(file.webkitRelativePath || file.name)}`,
        file,
        "PUT",
      );
    }
    pendingFiles.current = null;
    setBusy("扫描技能与插件…");
    preview(await api(`/${id}/scan`, {}));
  }
  const chooseFiles = (files: FileList | null, kind: "files" | "zip") => {
    if (!files?.length) return;
    const values = Array.from(files);
    if (
      values.length > IMPORT_LIMITS.files ||
      values.reduce((n, f) => n + f.size, 0) > IMPORT_LIMITS.totalBytes
    ) {
      setError("来源超过 64 MiB 或 4096 个文件的预算");
      return;
    }
    pendingFiles.current = { files: values, kind };
    void run("上传…", async () => {
      if (session?.retained) await api("/" + session.id, undefined, "DELETE");
      await uploadFiles();
    });
  };
  function toggle(
    current: Set<string>,
    set: (v: Set<string>) => void,
    key: string,
  ) {
    const next = new Set(current);
    next.has(key) ? next.delete(key) : next.add(key);
    set(next);
    op.current = null;
  }
  const rows =
      session?.entries.flatMap((entry) =>
        entry.skills.map((skill) => ({ entry, skill })),
      ) || [],
    pages = Math.max(1, Math.ceil(rows.length / 50));
  const finished = session?.state === "complete";
  async function install(retry = false) {
    if (!session?.digest) return;
    const choices: ImportChoice[] = session.entries
      .filter((e) =>
        retry
          ? e.state === "failed"
          : !["installed", "skipped"].includes(e.state),
      )
      .filter((e) =>
        e.kind === "plugin"
          ? packages.has(e.id)
          : e.skills.some((s) => selected.has(s.id)),
      )
      .map((e) => ({
        id: e.id,
        skills: e.skills.filter((s) => selected.has(s.id)).map((s) => s.id),
        replace: replace.has(e.id),
        confirmPackage: packages.has(e.id),
      }));
    if (!choices.length) {
      setError("请选择技能，或确认要安装的完整插件");
      return;
    }
    const body = { digest: session.digest, choices },
      signature = JSON.stringify(body);
    if (!op.current || op.current.signature !== signature)
      op.current = { signature, id: crypto.randomUUID() };
    const next: ImportSession = await api(`/${session.id}/install`, {
      ...body,
      operationId: op.current.id,
    });
    setSession(next);
    if (next.state !== "installing") op.current = null;
    setSelected(
      new Set(
        next.entries.flatMap(
          (e) =>
            e.selectedSkills ??
            e.skills.filter((s) => selected.has(s.id)).map((s) => s.id),
        ),
      ),
    );
    try {
      await loadSettings();
    } catch {
      setError("安装结果已保存，设置读取失败。关闭后刷新即可查看。");
    }
  }
  return (
    <Modal
      open
      title={
        updatePlugin
          ? `升级 ${updatePlugin.displayName}`
          : kind === "plugin"
            ? "添加插件"
            : "添加技能"
      }
      wide
      className="skill-import"
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="skill-import-body">
        {!session ||
        session.state === "uploading" ||
        session.state === "failed" ? (
          <>
            <div className="import-sources">
              <button
                className="secondary"
                disabled={pending}
                onClick={() => directory.current?.click()}
              >
                <FolderOpen size={17} />
                本地目录
              </button>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => zip.current?.click()}
              >
                <Upload size={17} />
                ZIP 文件
              </button>
              <button
                className="secondary"
                disabled={pending}
                onClick={() => setGithub((v) => !v)}
              >
                <Github size={17} />
                GitHub
              </button>
            </div>
            <input
              ref={directory}
              type="file"
              multiple
              {...({ webkitdirectory: "" } as any)}
              hidden
              onChange={(e) => chooseFiles(e.target.files, "files")}
            />
            <input
              ref={zip}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => chooseFiles(e.target.files, "zip")}
            />
            {github && (
              <form
                className="import-github"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("下载并扫描…", async () => {
                    if (session?.retained)
                      await api("/" + session.id, undefined, "DELETE");
                    const next = await api("", {
                      kind: "github",
                      url,
                      updatePluginId: updatePlugin?.id,
                    });
                    setSession(next);
                    preview(await api(`/${next.id}/scan`, {}));
                  });
                }}
              >
                <label className="field-label">
                  GitHub 链接
                  <input
                    required
                    type="url"
                    value={url}
                    disabled={pending}
                    placeholder="https://github.com/owner/repository"
                    onChange={(e) => setUrl(e.target.value)}
                    aria-describedby="github-import-source-hint"
                  />
                </label>
                <p className="muted" id="github-import-source-hint">
                  仓库首页使用默认分支；分支、标签和子目录按链接导入。
                </p>
                <button className="primary" disabled={pending}>
                  扫描来源
                </button>
                <p className="muted">
                  私有内容请使用本地目录或 ZIP。需要保留执行权限时使用 ZIP。
                </p>
              </form>
            )}
            {!!recent.length && !session && (
              <div className="import-recent">
                <span className="muted">最近导入</span>
                {recent
                  .filter(
                    (s) =>
                      !updatePlugin || s.update?.pluginId === updatePlugin.id,
                  )
                  .slice(0, 5)
                  .map((s) => (
                    <div className="import-recent-item" key={s.id}>
                      <button
                        className="import-recent-row"
                        key={s.id}
                        onClick={() =>
                          void run("读取结果…", async () =>
                            preview(await api("/" + s.id)),
                          )
                        }
                      >
                        <span>{s.source.name}</span>
                        <small>
                          {s.state === "complete"
                            ? "查看结果"
                            : s.state === "ready"
                              ? "继续导入"
                              : "查看记录"}
                        </small>
                      </button>
                      {s.retained &&
                        !["scanning", "installing"].includes(s.state) && (
                          <button
                            className="icon-button"
                            aria-label={`取消导入 ${s.source.name}`}
                            title="取消导入"
                            disabled={pending}
                            onClick={() =>
                              void run("取消导入…", async () => {
                                await api("/" + s.id, undefined, "DELETE");
                                setRecent(await api(""));
                              })
                            }
                          >
                            <X size={16} />
                          </button>
                        )}
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="import-summary">
              <strong>{session.source.name}</strong>
              <span>
                {rows.length} 个技能 · {(session.bytes / 1024).toFixed(0)} KiB
              </span>
            </div>
            {session.source.kind === "github" && session.source.ref && (
              <p className="muted import-source-path">
                来源：{session.source.ref}
                {session.source.path ? ` · ${session.source.path}` : ""}
              </p>
            )}
            <div className="import-packages">
              {session.entries
                .filter(
                  (e) =>
                    session.entries.length > 1 ||
                    e.kind === "plugin" ||
                    e.conflict ||
                    e.error ||
                    ["installed", "skipped"].includes(e.state),
                )
                .map((e) => (
                  <div className="import-package" key={e.id}>
                    {e.kind === "plugin" ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={packages.has(e.id)}
                          disabled={
                            !!e.blocked ||
                            pending ||
                            ["installed", "skipped"].includes(e.state)
                          }
                          onChange={() => toggle(packages, setPackages, e.id)}
                        />
                        <strong>
                          {e.previousDigest ? "升级完整插件" : "安装完整插件"} ·{" "}
                          {e.name}
                        </strong>
                      </label>
                    ) : session.entries.length > 1 ? (
                      <strong>{e.name}</strong>
                    ) : null}
                    {e.kind === "plugin" && (
                      <p className="muted">
                        {e.previousDigest
                          ? `${e.previousVersion || "未标注版本"} → ${e.version || "未标注版本"} · `
                          : e.version
                            ? `${e.version} · `
                            : ""}
                        {e.skills.length} 个技能 · 连接器：
                        {e.mcp.join("、") || "无"} · 钩子：
                        {e.hooks.join("、") || "无"}。仅启用下方勾选的技能。
                      </p>
                    )}
                    {e.kind === "plugin" && e.conflict?.kind === "changed" && (
                      <p className="muted">
                        保留兼容设置和启停选择；新增技能默认关闭，连接器配置需重新确认。
                      </p>
                    )}
                    {e.conflict?.kind === "same" && (
                      <p className="muted">内容一致，将跳过已安装项。</p>
                    )}
                    {e.conflict?.kind === "changed" && (
                      <label className="import-replace">
                        <input
                          type="checkbox"
                          checked={replace.has(e.id)}
                          onChange={() => toggle(replace, setReplace, e.id)}
                          disabled={pending}
                        />
                        替换已有包（新增 {e.conflict.added}、修改{" "}
                        {e.conflict.changed}、删除 {e.conflict.removed} 个文件）
                      </label>
                    )}
                    {["installed", "skipped"].includes(e.state) && (
                      <span className="import-result" role="status">
                        {e.state === "installed"
                          ? e.previousDigest
                            ? "已升级"
                            : "已导入"
                          : "已跳过"}
                      </span>
                    )}
                    {e.blocked && <p className="inline-error">{e.blocked}</p>}
                    {e.error && (
                      <p className="inline-error" role="alert">
                        {e.name}：{e.error}
                      </p>
                    )}
                  </div>
                ))}
            </div>
            <div className="import-selection">
              <label>
                <input
                  type="checkbox"
                  checked={
                    rows.length > 0 &&
                    rows.every((r) => selected.has(r.skill.id))
                  }
                  disabled={pending || finished}
                  onChange={(e) => {
                    setSelected(
                      new Set(
                        e.target.checked ? rows.map((r) => r.skill.id) : [],
                      ),
                    );
                    op.current = null;
                  }}
                />
                全选 {rows.length} 个技能
              </label>
              <span>{selected.size} 项已选</span>
            </div>
            <div className="import-skills">
              {rows
                .slice(page * 50, (page + 1) * 50)
                .map(({ entry, skill }) => (
                  <label className="import-skill" key={entry.id + skill.id}>
                    <input
                      type="checkbox"
                      aria-label={`导入 ${skill.name}`}
                      checked={selected.has(skill.id)}
                      disabled={
                        pending ||
                        !!entry.blocked ||
                        ["installed", "skipped"].includes(entry.state)
                      }
                      onChange={() => toggle(selected, setSelected, skill.id)}
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.description}</small>
                    </span>
                  </label>
                ))}
            </div>
            {pages > 1 && (
              <nav className="import-pagination" aria-label="扫描结果分页">
                <button
                  className="icon-button"
                  aria-label="上一页"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  {page + 1} / {pages}
                </span>
                <button
                  className="icon-button"
                  aria-label="下一页"
                  disabled={page + 1 === pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </nav>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={pending}
                onClick={() => void run("切换来源…", otherSource)}
              >
                选择其他来源
              </button>
              {finished ? (
                session.entries.some((e) => e.state === "failed") ? (
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() => void run("重试失败项…", () => install(true))}
                  >
                    重试失败项
                  </button>
                ) : (
                  <button className="primary" onClick={onClose}>
                    完成
                  </button>
                )
              ) : (
                <button
                  className="primary"
                  disabled={pending}
                  onClick={() => void run("正在导入…", () => install())}
                >
                  {updatePlugin ? "确认升级" : "确认导入"}
                </button>
              )}
            </div>
          </>
        )}
        {(busy || pending) && (
          <p role="status" className="muted">
            {busy ||
              (session?.state === "scanning" ? "扫描技能与插件…" : "正在导入…")}
          </p>
        )}
        {(error || session?.error) && (
          <p role="alert" className="inline-error">
            {error || session?.error}
          </p>
        )}
        {!!error && pendingFiles.current && (
          <button
            className="secondary"
            disabled={pending}
            onClick={() => void run("重试上传…", uploadFiles)}
          >
            重试上传
          </button>
        )}
      </div>
    </Modal>
  );
}
