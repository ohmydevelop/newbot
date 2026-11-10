import { PublicError } from "./public-error.js";
import type { FastifyInstance } from "fastify";
import type { ArtifactStore } from "./artifacts.js";
export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || header.length > 128)
    return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const total = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    return suffix > 0n
      ? { start: Number(suffix >= total ? 0n : total - suffix), end: size - 1 }
      : null;
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : total - 1n;
  if (start >= total || end < start) return null;
  return { start: Number(start), end: Number(end >= total ? total - 1n : end) };
}
export function pdfRoutes(app: FastifyInstance, artifacts: ArtifactStore) {
  app.get("/api/artifacts/:id/pdf", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (artifacts.get(id).kind !== "pdf")
      throw new PublicError("此文件不是 PDF");
    // Each response uses the existing bounded, hash-verified immutable snapshot.
    const { artifact, data } = await artifacts.read(id);
    const etag = `"${artifact.sha256}"`;
    reply
      .type("application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
      )
      .header("Cache-Control", "private, no-store")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header("Accept-Ranges", "bytes")
      .header("ETag", etag);
    const range = req.method !== "HEAD" ? req.headers.range : undefined;
    if (
      range &&
      /^bytes=/i.test(range.trim()) &&
      !range.includes(",") &&
      (!req.headers["if-range"] || req.headers["if-range"] === etag)
    ) {
      const selected = byteRange(range, data.length);
      if (!selected)
        return reply
          .code(416)
          .type("application/json")
          .header("Content-Range", `bytes */${data.length}`)
          .send({ error: "请求的 PDF 字节范围无效" });
      const chunk = data.subarray(selected.start, selected.end + 1);
      return reply
        .code(206)
        .header(
          "Content-Range",
          `bytes ${selected.start}-${selected.end}/${data.length}`,
        )
        .header("Content-Length", chunk.length)
        .send(chunk);
    }
    return reply.header("Content-Length", data.length).send(data);
  });
}
