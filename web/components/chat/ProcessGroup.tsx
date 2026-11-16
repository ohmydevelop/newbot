import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ChevronRight, LoaderCircle, Clock3 } from "lucide-react";
import type { Item } from "../../../shared/types";
import { anchorDisclosure } from "../../chat-scroll";
import { ContentBoundary } from "./ContentBoundary";
import { Message } from "./Message";

export function ProcessGroup({
  items,
  threadId,
  turnId,
  label,
  running,
  active = running,
  children,
}: {
  items: Item[];
  threadId: string;
  turnId: string;
  label: string;
  running: boolean;
  active?: boolean;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const follow = useRef(running),
    position = useRef(0),
    wasExpanded = useRef(false);
  const id = useId();
  const measure = () => {
    const el = viewport.current;
    if (!el || !expanded) return;
    const next = {
      top: el.scrollTop > 2,
      bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 2,
    };
    setEdges((old) =>
      old.top === next.top && old.bottom === next.bottom ? old : next,
    );
  };
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || !expanded) {
      wasExpanded.current = false;
      return;
    }
    if (!wasExpanded.current)
      el.scrollTop =
        follow.current && running ? el.scrollHeight : position.current;
    wasExpanded.current = true;
    measure();
  }, [expanded, items, running]);
  useEffect(() => {
    if (!expanded || !content.current) return;
    const observer = new ResizeObserver(() => {
      const el = viewport.current;
      if (el && follow.current && running) el.scrollTop = el.scrollHeight;
      measure();
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [expanded, running]);
  return (
    <section
      className={`process-group ${expanded ? "process-expanded" : "process-collapsed"}`}
    >
      <div className="process-heading">
        <button
          type="button"
          className="process-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={(e) =>
            anchorDisclosure(e.currentTarget, () => setExpanded((v) => !v))
          }
        >
          {running ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : (
            <Clock3 size={18} aria-hidden="true" />
          )}
          <span>{label}</span>
          <ChevronRight
            size={15}
            className="process-chevron"
            aria-hidden="true"
          />
        </button>
        {children}
      </div>
      <div
        className={`process-window ${edges.top ? "has-before" : ""} ${edges.bottom ? "has-after" : ""}`}
        hidden={!expanded}
      >
        <div
          id={id}
          className="process-viewport"
          ref={viewport}
          tabIndex={0}
          role="region"
          aria-label="执行过程详情"
          onScroll={(e) => {
            if (!expanded) return;
            position.current = e.currentTarget.scrollTop;
            follow.current =
              e.currentTarget.scrollHeight -
                e.currentTarget.clientHeight -
                e.currentTarget.scrollTop <
              24;
            measure();
          }}
        >
          <div ref={content} className="process-items">
            {items.map((item) => (
              <ContentBoundary key={item.id}>
                <Message
                  streaming={active}
                  item={item}
                  threadId={threadId}
                  turnId={turnId}
                  processExpanded={expanded}
                />
              </ContentBoundary>
            ))}
          </div>
        </div>
        {edges.bottom && running && (
          <button
            type="button"
            className="process-latest"
            aria-label="查看最新执行步骤"
            onClick={() => {
              follow.current = true;
              if (viewport.current)
                viewport.current.scrollTop = viewport.current.scrollHeight;
              measure();
            }}
          >
            <ArrowDown size={13} aria-hidden="true" />
            最新步骤
          </button>
        )}
      </div>
    </section>
  );
}
