import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** One line until explicitly expanded; clipped controls are never focusable. */
export function CapabilityRow({
  items,
  label = "已选能力",
}: {
  items: { id: string; content: ReactNode }[];
  label?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(items.length);
  const signature = items.map((x) => x.id).join("|");
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const widths = Array.from(element.children).map(
        (el) => el.getBoundingClientRect().width,
      );
      const available = element.clientWidth;
      let used = 0,
        count = 0;
      for (const width of widths) {
        if (used + width > available + 1) break;
        used += width + 6;
        count++;
      }
      setVisible(count);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    Array.from(element.children).forEach((el) => observer.observe(el));
    measure();
    return () => observer.disconnect();
  }, [signature]);
  if (!items.length) return null;
  const overflow = visible < items.length;
  return (
    <div
      className={`capabilities ${expanded ? "is-expanded" : ""}`}
      aria-label={label}
    >
      <div className="capability-row" ref={row}>
        {items.map((item, index) => (
          <div
            key={item.id}
            className="capability-chip"
            inert={!expanded && index >= visible}
            aria-hidden={!expanded && index >= visible ? true : undefined}
            style={
              !expanded && index >= visible
                ? { visibility: "hidden" }
                : undefined
            }
          >
            {item.content}
          </div>
        ))}
      </div>
      {(overflow || expanded) && (
        <button
          type="button"
          className="capability-expand"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "收起已选能力"
              : `展开全部已选能力，还有 ${items.length - visible} 项`
          }
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronUp size={15} />
          ) : (
            <>
              <span>+{items.length - visible}</span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  );
}
