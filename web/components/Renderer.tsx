import type { MediaReference } from "../../shared/types";
import { MediaImage } from "./MediaImage";
import {
  memo,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useId,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResolvedTheme } from "../appearance";
import { resourceLoadFailure } from "../resource-errors";
import { Check, Copy } from "lucide-react";
export function Code({ language, code }: { language: string; code: string }) {
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    let active = true;
    setHtml("");
    setCopyError("");
    import("../highlight")
      .then(async ({ highlight }) => {
        const value = await highlight(code, language);
        if (active) setHtml(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [language, code]);
  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{language || "text"}</span>
        <button
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopyError("");
                setCopied(true);
                clearTimeout(copyTimer.current);
                copyTimer.current = setTimeout(() => setCopied(false), 1500);
              } catch {
                setCopyError("无法复制，请手动选择内容");
              }
            })();
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "已复制" : "复制代码"}
        </button>
      </div>
      {copyError && (
        <p className="inline-error code-copy-error" role="alert">
          {copyError}
        </p>
      )}
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
let diagrams: Promise<typeof import("mermaid").default> | undefined;
let diagramQueue: Promise<unknown> = Promise.resolve();
function renderDiagram(
  id: string,
  code: string,
  theme: "light" | "dark",
  active: () => boolean,
) {
  const task = diagramQueue
    .catch(() => {})
    .then(async () => {
      if (!active()) return;
      const mermaid = await (diagrams ??= import("mermaid").then(
        (m) => m.default,
      ));
      if (!active()) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "neutral",
        suppressErrorRendering: true,
        maxTextSize: 30000,
      });
      return mermaid.render(id, code);
    });
  diagramQueue = task;
  return task;
}
function Diagram({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const theme = useResolvedTheme();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [resourceError, setResourceError] = useState(false);
  useEffect(() => {
    if (streaming) return;
    let active = true;
    const timer = setTimeout(() => {
      void renderDiagram(`diagram-${id}-${theme}`, code, theme, () => active)
        .then((rendered) => {
          if (active && rendered) {
            setSvg(rendered.svg);
            setError("");
          }
        })
        .catch((failure) => {
          if (active) {
            const resource = resourceLoadFailure(failure);
            setResourceError(resource);
            setError(
              resource
                ? "图表资源未能加载，重新加载页面前请先复制未发送草稿。"
                : "图表尚未完整，或 Mermaid 语法无效",
            );
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, id, theme, streaming]);
  return (
    <div className="diagram">
      {streaming ? (
        <p className="muted" role="status">
          正在绘制图表…
        </p>
      ) : error ? (
        <>
          <p className="muted">{error}</p>
          {resourceError && (
            <button
              type="button"
              className="secondary"
              onClick={() => location.reload()}
            >
              重新加载页面
            </button>
          )}
          <Code language="text" code={code} />
        </>
      ) : (
        <div aria-busy={!svg} dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
const Chart = lazy(() => import("./Chart"));
const MathMarkdown = lazy(() => import("./MathMarkdown"));
export const Renderer = memo(function Renderer({
  text,
  document = false,
  media = [],
  streaming = false,
}: {
  text: string;
  document?: boolean;
  media?: MediaReference[];
  streaming?: boolean;
}) {
  const components: import("react-markdown").Components = {
    a: ({ children, href }) =>
      document && !/^(?:https?:\/\/|mailto:|#)/i.test(href || "") ? (
        <span>{children}</span>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    img: ({ src, alt }) =>
      document ? (
        <span className="muted">
          [图片：{alt || "未命名"}，请下载后查看引用资源]
        </span>
      ) : (
        <MediaImage
          media={media.find((m) => m.reference === src)}
          label={alt || "图片"}
        />
      ),
    pre: ({ children }) => <>{children}</>,
    code: ({ children, className, ...props }) => {
      const code = String(children).replace(/\n$/, "");
      const language = /language-(\S+)/.exec(className || "")?.[1];
      if (!document && language === "mermaid")
        return <Diagram code={code} streaming={streaming} />;
      if (!document && language === "echarts")
        return (
          <Suspense fallback={<p className="muted">正在加载图表…</p>}>
            <Chart code={code} streaming={streaming} />
          </Suspense>
        );
      return language || code.includes("\n") ? (
        <Code code={code} language={language || "text"} />
      ) : (
        <code className="inline-code" {...props}>
          {children}
        </code>
      );
    },
  };
  const plain = (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
  const math = /\$\$|(?<!\\)\$[^\n$]+\$/.test(text);
  return (
    <div className="prose">
      {math ? (
        <Suspense fallback={plain}>
          <MathMarkdown text={text} components={components} />
        </Suspense>
      ) : (
        plain
      )}
    </div>
  );
});
