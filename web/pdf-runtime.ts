import * as pdfjs from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Artifact } from "../shared/types";
import { artifactEndpoint, artifactFetch } from "./artifacts";
pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
const resources = {
  ...import.meta.glob<string>("/node_modules/pdfjs-dist/cmaps/*.bcmap", {
    eager: true,
    query: "?url",
    import: "default",
  }),
  ...import.meta.glob<string>(
    "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    { eager: true, query: "?url", import: "default" },
  ),
  ...import.meta.glob<string>(
    "/node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm",
    { eager: true, query: "?url", import: "default" },
  ),
};
class LocalBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const folder = (
      {
        cMapUrl: "cmaps",
        standardFontDataUrl: "standard_fonts",
        wasmUrl: "wasm",
      } as Record<string, string>
    )[kind];
    const url =
      folder && resources[`/node_modules/pdfjs-dist/${folder}/${filename}`];
    if (!url) throw new Error("PDF 内置资源不可用");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("PDF 字体或解码资源读取失败");
    return new Uint8Array(await response.arrayBuffer());
  }
}
export const PDF_CHUNK_SIZE = 128 * 1024;
export async function pdfRange(
  artifact: Artifact,
  begin: number,
  end: number,
  signal: AbortSignal,
) {
  const response = await artifactFetch(artifactEndpoint(artifact.id, "pdf"), {
    signal,
    headers: {
      Range: `bytes=${begin}-${end - 1}`,
      "If-Range": `"${artifact.sha256}"`,
    },
  });
  const expected = `bytes ${begin}-${end - 1}/${artifact.size}`;
  if (
    response.status !== 206 ||
    response.headers.get("content-range") !== expected ||
    response.headers.get("etag") !== `"${artifact.sha256}"`
  )
    throw new Error("PDF 分段响应不一致，请重新加载");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== end - begin)
    throw new Error("PDF 数据不完整，请重新加载");
  return bytes;
}
export async function openPdf(
  artifact: Artifact,
  controller: AbortController,
  onFailure: (error: unknown) => void,
) {
  const initial = await pdfRange(
    artifact,
    0,
    Math.min(PDF_CHUNK_SIZE, artifact.size),
    controller.signal,
  );
  class Transport extends pdfjs.PDFDataRangeTransport {
    private queue = Promise.resolve();
    override requestDataRange(begin: number, end: number) {
      // Serialize per-viewer reads; cancellation covers queued and active requests.
      this.queue = this.queue
        .then(async () => {
          if (controller.signal.aborted) return;
          const data = await pdfRange(
            artifact,
            begin,
            Math.min(end, artifact.size),
            controller.signal,
          );
          if (!controller.signal.aborted) this.onDataRange(begin, data);
        })
        .catch((error) => {
          if (!controller.signal.aborted) onFailure(error);
        });
    }
    override abort() {
      controller.abort();
    }
  }
  const range = new Transport(artifact.size, initial, true, artifact.name);
  return pdfjs.getDocument({
    range,
    rangeChunkSize: PDF_CHUNK_SIZE,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
    BinaryDataFactory: LocalBinaryData,
    useWasm: true,
    enableXfa: false,
    disableWorkerRendering: true,
    stopAtErrors: true,
    maxImageSize: 16_000_000,
    canvasMaxAreaInBytes: 32_000_000,
    verbosity: 0,
  });
}
export { AnnotationMode } from "pdfjs-dist";
export type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
