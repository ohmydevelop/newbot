import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  panelKeyboard,
  panelLimits,
  clampPanel,
  type PanelSide,
} from "../panel-sizing";
import { updatePanel } from "../panels";
export function PanelResizer({
  side,
  width,
  disabled = false,
}: {
  side: PanelSide;
  width: number;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    width: number;
    latest: number;
    pointer: number;
    node: HTMLDivElement;
  } | null>(null);
  const frame = useRef(0);
  const finish = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    updatePanel(side, active.latest, true);
    if (active.node.hasPointerCapture(active.pointer))
      active.node.releasePointerCapture(active.pointer);
    document.documentElement.removeAttribute("data-panel-dragging");
    setDragging(false);
  };
  useEffect(() => {
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      finish();
    };
  }, [side]);
  useEffect(() => {
    if (disabled) finish();
  }, [disabled]);
  if (disabled) return null;
  return (
    <>
      <div
        className={`panel-resizer panel-resizer-${side}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整${side === "left" ? "左" : "右"}侧栏宽度`}
        tabIndex={0}
        aria-valuemin={panelLimits[side].min}
        aria-valuemax={panelLimits[side].max}
        aria-valuenow={width}
        onKeyDown={(event) => {
          const next = panelKeyboard(side, width, event.key);
          if (next !== null) {
            event.preventDefault();
            updatePanel(side, next, true);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            width,
            latest: width,
            pointer: event.pointerId,
            node: event.currentTarget,
          };
          document.documentElement.dataset.panelDragging = side;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || event.pointerId !== active.pointer) return;
          active.latest = clampPanel(
            side,
            active.width +
              (event.clientX - active.x) * (side === "left" ? 1 : -1),
          );
          if (!frame.current) {
            const start = performance.now();
            frame.current = requestAnimationFrame(() => {
              frame.current = 0;
              if (drag.current) updatePanel(side, drag.current.latest);
              if (new URL(location.href).searchParams.get("profile") === "1")
                requestAnimationFrame(() => {
                  window.dispatchEvent(
                    new CustomEvent("newbot:panel-frame", {
                      detail: performance.now() - start,
                    }),
                  );
                });
            });
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      {dragging &&
        createPortal(
          <div className="panel-drag-shield" aria-hidden="true" />,
          document.body,
        )}
    </>
  );
}
