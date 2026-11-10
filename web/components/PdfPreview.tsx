import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCw,
} from "lucide-react";
import type { Artifact } from "../../shared/types";
import {
  AnnotationMode,
  openPdf,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "../pdf-runtime";
export default function PdfPreview({ artifact }: { artifact: Artifact }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [pageText, setPageText] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = container.current!;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(1, entries[0].contentRect.width - 32)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setError("");
    setBusy(true);
    setPage(1);
    setInput("1");
    setPageText("");
    const fail = (reason: unknown) => {
      if (!active || controller.signal.aborted) return;
      const name = (reason as { name?: string })?.name;
      setError(
        name === "PasswordException"
          ? "此 PDF 需要密码，请下载后使用本地阅读器打开。"
          : reason instanceof Error &&
              /^(?:[\u3400-\u9fff]|PDF [\u3400-\u9fff])/.test(reason.message)
            ? reason.message
            : "PDF 无法读取，文件可能已损坏或格式不受支持。可重试或下载后查看。",
      );
      setBusy(false);
      controller.abort();
      if (task) void task.destroy().catch(() => {});
    };
    const timeout = setTimeout(
      () => fail(new Error("PDF 加载超时，请重试或下载后查看。")),
      20000,
    );
    void openPdf(artifact, controller, fail)
      .then(async (loading) => {
        task = loading;
        if (!active || controller.signal.aborted) {
          await loading.destroy();
          return;
        }
        loading.onPassword = () =>
          fail(
            Object.assign(new Error("password"), { name: "PasswordException" }),
          );
        const pdf = await loading.promise;
        if (!active || controller.signal.aborted) return;
        if (!pdf.numPages || pdf.numPages > 500) {
          fail(
            new Error("PDF 页数超过预览限制（最多 500 页），请下载后查看。"),
          );
          return;
        }
        clearTimeout(timeout);
        setDocument(pdf);
      })
      .catch(fail);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
      if (task) void task.destroy().catch(() => {});
    };
  }, [artifact.id, revision]);
  useEffect(() => {
    if (!document || !width) return;
    let active = true;
    let render: RenderTask | undefined;
    const target = canvas.current!;
    setBusy(true);
    setError("");
    setPageText("");
    const timeout = setTimeout(() => {
      if (active) {
        render?.cancel();
        setBusy(false);
        setError("页面渲染超时，可尝试其他页面或重新读取。");
      }
    }, 15000);
    void (async () => {
      const pdfPage = await document.getPage(page);
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      if (
        !Number.isFinite(base.width) ||
        !Number.isFinite(base.height) ||
        base.width <= 0 ||
        base.height <= 0
      )
        throw new Error("PDF 页面尺寸无效，请下载后查看。");
      const scale = Math.min(width / base.width, 1.5) * zoom;
      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(8_000_000 / (base.width * base.height * scale * scale)),
        8192 / (base.width * scale),
        8192 / (base.height * scale),
      );
      const viewport = pdfPage.getViewport({ scale: scale * density });
      target.width = Math.max(1, Math.floor(viewport.width));
      target.height = Math.max(1, Math.floor(viewport.height));
      target.style.width = `${base.width * scale}px`;
      target.style.height = `${base.height * scale}px`;
      render = pdfPage.render({
        canvas: target,
        viewport,
        annotationMode: AnnotationMode.ENABLE,
      });
      await render.promise;
      if (!active) return;
      setBusy(false);
      clearTimeout(timeout);
      const reader = pdfPage.streamTextContent().getReader();
      let text = "";
      try {
        while (active && text.length < 20000) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items)
            if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (active) setPageText(text.slice(0, 20000));
    })()
      .catch((reason) => {
        if (active && reason?.name !== "RenderingCancelledException") {
          setBusy(false);
          setError(
            reason instanceof Error &&
              /^(?:[\u3400-\u9fff]|PDF [\u3400-\u9fff])/.test(reason.message)
              ? reason.message
              : "此页无法渲染，可尝试其他页面或下载后查看。",
          );
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      render?.cancel();
      target.width = 0;
      target.height = 0;
    };
  }, [document, page, width, zoom]);
  function changePage(next: number) {
    if (!document) return;
    const value = Math.max(1, Math.min(document.numPages, next));
    setPage(value);
    setInput(String(value));
    container.current?.scrollTo(0, 0);
  }
  function jump(event: FormEvent) {
    event.preventDefault();
    const value = Number(input);
    if (Number.isInteger(value)) changePage(value);
    else setInput(String(page));
  }
  return (
    <section className="pdf-preview" aria-label={`${artifact.name} PDF 预览`}>
      <div className="pdf-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label="上一页"
          disabled={!document || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <form onSubmit={jump} className="pdf-page-form">
          <input
            type="number"
            aria-label="PDF 页码"
            min={1}
            max={document?.numPages || 1}
            value={input}
            disabled={!document}
            onChange={(e) => setInput(e.target.value)}
            onBlur={() => {
              const n = Number(input);
              if (Number.isInteger(n)) changePage(n);
              else setInput(String(page));
            }}
          />
          <span aria-live="polite">/ {document?.numPages || "…"} 页</span>
        </form>
        <button
          type="button"
          className="icon-button"
          aria-label="下一页"
          disabled={!document || page >= document.numPages}
          onClick={() => changePage(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <select
          aria-label="PDF 缩放"
          value={zoom}
          disabled={!document}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          <option value={1}>适合宽度</option>
          <option value={1.25}>放大 125%</option>
          <option value={1.5}>放大 150%</option>
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label="重新读取 PDF"
          onClick={() => setRevision((n) => n + 1)}
        >
          <RotateCw size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="pdf-pages" ref={container} aria-busy={busy}>
        {busy && (
          <div className="pdf-feedback" role="status">
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            正在读取 PDF 页面…
          </div>
        )}
        {error && (
          <div className="pdf-error">
            <p className="inline-error" role="alert">
              {error}
            </p>
            <button
              type="button"
              className="secondary artifact-download-button"
              onClick={() => setRevision((n) => n + 1)}
            >
              重试预览
            </button>
          </div>
        )}
        <canvas
          ref={canvas}
          className={`pdf-canvas ${busy || error ? "is-hidden" : ""}`}
          role="img"
          aria-label={`${artifact.name}，第 ${page} 页`}
        />
        {pageText && !error && !busy && (
          <details className="pdf-page-text">
            <summary>本页文字</summary>
            <pre>{pageText}</pre>
          </details>
        )}
      </div>
    </section>
  );
}
