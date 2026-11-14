import { z } from "zod";
import { PublicError } from "./public-error.js";
import { importPath } from "./import-files.js";

export function githubLocation(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicError("请输入 GitHub 仓库或子目录地址");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length < 2 ||
    !parts.slice(0, 2).every((p) => /^[\w.-]+$/.test(p))
  )
    throw new PublicError("仅支持公开 github.com 仓库");
  const tag = parts[2] === "releases" && parts[3] === "tag";
  if (
    parts.length > 2 &&
    !(tag ? parts[4] : ["tree", "blob"].includes(parts[2]) && parts[3])
  )
    throw new PublicError("请使用仓库、分支、标签或子目录链接");
  let tail: string;
  try {
    tail = parts
      .slice(tag ? 4 : 3)
      .map(decodeURIComponent)
      .join("/");
  } catch {
    throw new PublicError("GitHub 地址编码无效");
  }
  if (
    tail &&
    (tail.length > 1024 ||
      tail.split("/").length > 24 ||
      /[\x00-\x1f]/.test(tail))
  )
    throw new PublicError("GitHub 子目录地址过长或无效");
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, ""), tail, tag };
}

const commitId = z.string().regex(/^[a-f0-9]{40}$/);
const refName = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !/[\x00-\x1f]/.test(v));

/** A persisted scan uses its captured commit and directory, never today's branch tip. */
export function pinnedGithubSource(source: {
  url?: string;
  ref?: string;
  path?: string;
  commit?: string;
}) {
  if (!source.commit || !source.ref)
    throw new PublicError("此导入记录尚未固定版本，请重新粘贴链接扫描");
  const { owner, repo } = githubLocation(source.url || "");
  return {
    owner,
    repo,
    ref: refName.parse(source.ref),
    path: source.path ? importPath(source.path) : "",
    commit: commitId.parse(source.commit),
  };
}

/** Public repository metadata only. No credentials, redirects or arbitrary hosts. */
export function githubCatalog(fetcher: typeof fetch = fetch) {
  async function json(path: string, missing = false) {
    const response = await fetcher(`https://api.github.com/repos/${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "newbot-import/1",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (missing && response.status === 404) return null;
    if (!response.ok)
      throw new PublicError(
        response.status === 403 || response.status === 429
          ? "GitHub 请求额度暂不可用，请稍后重试或使用本地 ZIP。"
          : "无法读取公开仓库，请检查地址后重试。",
      );
    if (
      !response.headers.get("content-type")?.includes("json") ||
      !response.body
    )
      throw new PublicError("GitHub 返回了无效的目录数据");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if ((size += result.value.length) > 1024 * 1024)
          throw new PublicError("GitHub 目录超过读取预算");
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel();
    }
    let value: any;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new PublicError("GitHub 返回了无效的目录数据");
    }
    return value;
  }
  const sha = (value: unknown) => commitId.parse(value);
  async function resolve(raw: string) {
    const { owner, repo, tail, tag } = githubLocation(raw),
      base = `${owner}/${repo}`;
    let ref: string,
      path = "",
      commit: string;
    if (tag) {
      ref = refName.parse(tail);
      const reference = await json(
        `${base}/git/ref/tags/${encodeURIComponent(ref)}`,
        true,
      );
      if (!reference || reference.ref !== `refs/tags/${ref}`)
        throw new PublicError("未找到链接中的标签，请检查地址后重试");
      let object = reference.object;
      const seen = new Set<string>();
      while (object?.type === "tag") {
        const id = sha(object.sha);
        if (seen.has(id) || seen.size >= 8)
          throw new PublicError("GitHub 标签引用无效或层级过深");
        seen.add(id);
        object = (await json(`${base}/git/tags/${id}`)).object;
      }
      if (object?.type !== "commit")
        throw new PublicError("链接中的标签未指向可导入的提交");
      commit = sha(object.sha);
    } else if (tail) {
      // Resolve the longest real ref first: branches and tags can contain '/'.
      // Pin the returned commit, never infer a ref from the first URL segment.
      const segments = tail.split("/");
      let linked: { ref: string; path: string; commit: string } | undefined;
      for (let n = segments.length; n > 0; n--) {
        const candidate = segments.slice(0, n).join("/");
        const info = await json(
          `${base}/commits/${encodeURIComponent(candidate)}`,
          true,
        );
        if (!info) continue;
        linked = {
          ref: candidate,
          path: segments.slice(n).join("/"),
          commit: sha(info.sha),
        };
        break;
      }
      if (!linked)
        throw new PublicError("未找到链接中的分支或标签，请检查地址后重试");
      ({ ref, path, commit } = linked);
    } else {
      const metadata = await json(base);
      ref = refName.parse(metadata.default_branch);
      commit = sha(
        (await json(`${base}/commits/${encodeURIComponent(ref)}`)).sha,
      );
    }
    return {
      owner,
      repo,
      ref: refName.parse(ref),
      path: path ? importPath(path) : "",
      commit,
    };
  }
  return { resolve };
}

export async function githubBytes(
  url: string,
  limit: number,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "newbot-import/1",
    },
  });
  if (!response.ok || !response.body)
    throw new PublicError(
      `GitHub 下载失败（${response.status}），请检查公开访问、ref 或改用本地 ZIP`,
    );
  if (Number(response.headers.get("content-length") || 0) > limit)
    throw new PublicError("GitHub 内容超过下载预算");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw new PublicError("GitHub 内容超过下载预算");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
