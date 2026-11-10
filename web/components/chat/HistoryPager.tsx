import type { RefObject } from "react";
import { LoaderCircle } from "lucide-react";
import { loadOlder, useApp } from "../../store";
export function HistoryPager({
  scroll,
  pinned,
}: {
  scroll: RefObject<HTMLDivElement | null>;
  pinned: RefObject<boolean>;
}) {
  const s = useApp();
  if (!s.thread?.historyCursor) return null;
  return (
    <div className="history-pager">
      <button
        className="older-button"
        disabled={s.olderLoading || s.loading}
        onClick={() => {
          const id = s.thread!.id,
            anchor =
              scroll.current?.querySelector<HTMLElement>("[data-turn-id]"),
            top = anchor?.getBoundingClientRect().top;
          pinned.current = false;
          void loadOlder().then(() =>
            requestAnimationFrame(() => {
              if (
                useApp.getState().selectedId === id &&
                anchor?.isConnected &&
                scroll.current &&
                top !== undefined
              )
                scroll.current.scrollTop +=
                  anchor.getBoundingClientRect().top - top;
            }),
          );
        }}
      >
        {s.olderLoading ? (
          <>
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
            正在加载更早的消息…
          </>
        ) : (
          "加载更早的消息"
        )}
      </button>
      {s.olderError && (
        <p role="alert" className="inline-error">
          {s.olderError}
        </p>
      )}
    </div>
  );
}
