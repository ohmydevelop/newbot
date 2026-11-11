import { createHash, randomUUID } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Item, Json, MediaReference, Thread } from "../shared/types.js";
import type { ArtifactStore } from "./artifacts.js";
import type { Store } from "./db.js";
import {
  fetchPublicImage,
  imageExtension,
  IMAGE_LIMIT,
} from "./public-images.js";
import { PublicError } from "./public-error.js";

type Candidate = {
  key: string;
  label: string;
  reference?: string;
  path?: string;
  url?: string;
  data?: string;
  unavailable?: boolean;
};
export function markdownImages(text: string): { url: string; alt: string }[] {
  const tree = unified().use(remarkParse).parse(text.slice(0, 262144));
  const definitions = new Map<string, string>();
  const images: any[] = [];
  const walk = (node: any) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if (node.type === "image" || node.type === "imageReference")
      images.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return images
    .map((n) => ({
      url: n.url || definitions.get(n.identifier) || "",
      alt: n.alt || "图片",
    }))
    .filter((n) => n.url)
    .slice(0, 16);
}
function candidates(item: Json): Candidate[] {
  const out: Candidate[] = [];
  if (item.type === "agentMessage") {
    for (const [i, image] of markdownImages(item.text || "").entries()) {
      if (image.url.length > 4096) continue;
      out.push({
        key: `markdown:${i}`,
        label: image.alt,
        reference: image.url,
        ...(/^(?!sandbox:)[a-z][a-z\d+.-]*:/i.test(image.url)
          ? { url: image.url }
          : { path: image.url.replace(/^sandbox:/, "") }),
      });
    }
  }
  if (
    item.type === "imageGeneration" &&
    item.status === "completed" &&
    !item.failure
  ) {
    out.push({
      key: "generation",
      label: "生成的图片",
      ...(item.result
        ? { data: item.result }
        : item.savedPath
          ? { path: item.savedPath }
          : { unavailable: true }),
    });
  }
  if (item.type === "imageView" && item.path)
    out.push({ key: "view", label: "图片", path: item.path });
  const content =
    item.type === "mcpToolCall" && !item.error
      ? item.result?.content
      : item.type === "dynamicToolCall"
        ? item.contentItems
        : item.type === "functionCallOutput"
          ? item.output
          : [];
  if (Array.isArray(content))
    for (const [i, block] of content.entries()) {
      if (block.type === "image" && typeof block.data === "string")
        out.push({
          key: `image:${i}`,
          label: "工具返回的图片",
          data: block.data,
        });
      if (["inputImage", "input_image"].includes(block.type)) {
        const url = block.imageUrl || block.image_url;
        out.push({
          key: `image:${i}`,
          label: "工具返回的图片",
          ...(typeof url === "string"
            ? url.startsWith("data:")
              ? { data: url }
              : { url }
            : { unavailable: true }),
        });
      }
      if (
        block.type === "resource_link" &&
        /^image\//.test(block.mimeType || "")
      )
        out.push({
          key: `image:${i}`,
          label: block.name || "工具返回的图片",
          url: block.uri,
        });
    }
  return out.slice(0, 16);
}
function decodeImage(value: string) {
  const base64 = value.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "");
  if (
    base64.length > Math.ceil(IMAGE_LIMIT / 3) * 4 ||
    !/^[A-Za-z\d+/]*={0,2}$/.test(base64) ||
    base64.length % 4 !== 0
  )
    throw new PublicError("图片数据无效或超过 8 MiB");
  const data = Buffer.from(base64, "base64");
  imageExtension(data);
  return data;
}
type Row = {
  id: string;
  thread_id: string;
  turn_id: string;
  item_id: string;
  reference: string | null;
  label: string;
  state: MediaReference["state"];
  reason: string | null;
  artifact_id: string | null;
};
export function mediaStore(
  db: Store,
  artifacts: ArtifactStore,
  fetchImage = fetchPublicImage,
) {
  let closed = false;
  const pending = new Set<Promise<unknown>>();
  function refs(
    threadId: string,
    turnId: string,
    itemId: string,
  ): MediaReference[] {
    return (
      db.raw
        .prepare(
          "SELECT * FROM message_media WHERE thread_id=? AND turn_id=? AND item_id=? ORDER BY created,rowid",
        )
        .all(threadId, turnId, itemId) as Row[]
    ).map((row) => ({
      id: row.id,
      ...(row.reference ? { reference: row.reference } : {}),
      label: row.label,
      state: row.state,
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.artifact_id
        ? {
            artifactId: row.artifact_id,
            url: `/api/artifacts/${row.artifact_id}/content`,
          }
        : {}),
    }));
  }
  const decorateItem = (threadId: string, turnId: string, item: Item): Item => {
    const media = refs(threadId, turnId, item.id);
    return media.length ? { ...item, media } : item;
  };
  return {
    decorateItem,
    async resolveImage(
      threadId: string,
      turnId: string,
      itemId: string,
      reference: string,
      label: string,
    ) {
      if (closed || !db.owns(threadId) || pending.size >= 32)
        throw new PublicError("图片暂时不可用");
      const key = `a2ui:${createHash("sha256").update(reference).digest("hex")}`;
      const row = db.raw
        .prepare(
          "SELECT * FROM message_media WHERE thread_id=? AND turn_id=? AND item_id=? AND source_key=?",
        )
        .get(threadId, turnId, itemId, key) as Row | undefined;
      if (row?.state === "ready" && row.artifact_id)
        return artifacts.get(row.artifact_id).contentUrl;
      if (row) throw new PublicError("图片保存未完成，请更换资源后重试");
      const id = randomUUID();
      db.raw
        .prepare(
          "INSERT INTO message_media VALUES(?,?,?,?,?,?,?,'pending',NULL,NULL,?)",
        )
        .run(id, threadId, turnId, itemId, key, reference, label, Date.now());
      const task = (async () => {
        const match = /^\/api\/artifacts\/([a-f\d-]+)\/content$/.exec(
          reference,
        );
        if (match) {
          const artifact = artifacts.get(match[1]);
          if (artifact.threadId !== threadId || artifact.kind !== "image")
            throw new PublicError("图片不属于当前会话");
          return artifact;
        }
        return artifacts.image(
          threadId,
          turnId,
          itemId,
          /^(?!sandbox:)[a-z][a-z\d+.-]*:/i.test(reference)
            ? { data: await fetchImage(reference) }
            : { path: reference.replace(/^sandbox:/, "") },
        );
      })()
        .then((artifact) => {
          db.raw
            .prepare(
              "UPDATE message_media SET state='ready',artifact_id=? WHERE id=?",
            )
            .run(artifact.id, id);
          return artifact.contentUrl;
        })
        .catch((error) => {
          db.raw
            .prepare(
              "UPDATE message_media SET state='failed',reason='图片无法保存，请检查资源后重新生成' WHERE id=?",
            )
            .run(id);
          throw error;
        })
        .finally(() => pending.delete(task));
      pending.add(task);
      return task;
    },
    decorate(thread: Thread) {
      for (const turn of thread.turns)
        turn.items = turn.items.map((item) =>
          decorateItem(thread.id, turn.id, item),
        );
      return thread;
    },
    completed(
      threadId: string,
      turnId: string,
      item: Json,
      changed: () => void,
    ) {
      if (closed || !db.owns(threadId) || !turnId) return;
      for (const source of candidates(item)) {
        const id = randomUUID();
        const inserted = db.raw
          .prepare(
            "INSERT OR IGNORE INTO message_media VALUES(?,?,?,?,?,?,?,'pending',NULL,NULL,?)",
          )
          .run(
            id,
            threadId,
            turnId,
            item.id,
            source.key,
            source.reference || null,
            source.label.slice(0, 200),
            Date.now(),
          );
        if (!inserted.changes) continue;
        if (pending.size >= 32) {
          db.raw
            .prepare(
              "UPDATE message_media SET state='failed',reason='图片处理队列已满，请稍后重新生成' WHERE id=?",
            )
            .run(id);
          continue;
        }
        const task = (async () => {
          if (source.unavailable)
            throw new PublicError(
              "上游仅返回文件标识，当前接口无法取得图片内容",
            );
          if (source.reference?.startsWith("/api/artifacts/")) {
            const match = /^\/api\/artifacts\/([a-f\d-]+)\/content$/.exec(
              source.reference,
            );
            const artifact = match && artifacts.get(match[1]);
            if (
              !artifact ||
              artifact.threadId !== threadId ||
              artifact.kind !== "image"
            )
              throw new PublicError("图片不属于当前会话");
            return artifact;
          }
          const data = source.data
            ? decodeImage(source.data)
            : source.url
              ? await fetchImage(source.url)
              : undefined;
          return artifacts.image(threadId, turnId, item.id, {
            data,
            path: source.path,
          });
        })()
          .then((artifact) => {
            db.raw
              .prepare(
                "UPDATE message_media SET state='ready',artifact_id=? WHERE id=?",
              )
              .run(artifact.id, id);
          })
          .catch((error) => {
            db.raw
              .prepare(
                "UPDATE message_media SET state='failed',reason=? WHERE id=?",
              )
              .run(
                error instanceof PublicError
                  ? error.message
                  : "图片无法保存，请检查资源后重新生成",
                id,
              );
          })
          .finally(() => {
            pending.delete(task);
            changed();
          });
        pending.add(task);
      }
    },
    async close() {
      closed = true;
      await Promise.allSettled(pending);
    },
  };
}
export type MediaStore = ReturnType<typeof mediaStore>;
