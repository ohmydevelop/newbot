import type { Json } from "../../shared/types";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useState,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { Modal, dialogReturnTarget } from "./ui";

export const CatalogNavigation = createContext<{
  toolbar: HTMLElement | null;
  details: HTMLElement | null;
  lock: () => () => void;
  onUse?: (kind: "$" | "@", entry: Json, signal: AbortSignal) => Promise<void>;
} | null>(null);
export function CatalogToolbarSlot({ children }: { children: ReactNode }) {
  const navigation = useContext(CatalogNavigation);
  return navigation?.toolbar ? (
    createPortal(children, navigation.toolbar)
  ) : (
    <>{children}</>
  );
}
/** A detail is a step within the catalog, not another dialog. Standalone callers retain their modal. */
export function CatalogDetail(
  props: ComponentProps<typeof Modal> & {
    returnFocus?: HTMLElement | null;
    feedback?: ReactNode;
  },
) {
  const navigation = useContext(CatalogNavigation);
  useEffect(() => {
    if (props.open && props.dismissible === false) return navigation?.lock();
  }, [props.open, props.dismissible, navigation?.lock]);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const returnOrigin = useRef<HTMLElement | null>(null);
  if (props.open && !wasOpen.current)
    returnOrigin.current = props.returnFocus || dialogReturnTarget();
  wasOpen.current = props.open;
  const scrollOrigin = useRef({
    top: navigation?.details?.parentElement?.scrollTop || 0,
    view: navigation?.details?.parentElement?.getAttribute("data-catalog-view"),
    step: navigation?.details?.lastElementChild,
  });
  useLayoutEffect(() => {
    if (!navigation?.details || !props.open) return;
    const origin = returnOrigin.current;
    const scroller = navigation.details.parentElement;
    scroller?.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      requestAnimationFrame(() => {
        if (
          scroller?.isConnected &&
          scroller.getAttribute("data-catalog-view") ===
            scrollOrigin.current.view &&
          (navigation.details?.lastElementChild || null) ===
            (scrollOrigin.current.step || null)
        )
          scroller.scrollTo({ top: scrollOrigin.current.top });
        if (origin?.isConnected && origin.getClientRects().length)
          origin.focus({ preventScroll: true });
        else if (navigation.details?.isConnected) {
          const fallback =
            navigation.details.lastElementChild?.querySelector<HTMLElement>(
              "h2",
            ) ||
            navigation.toolbar?.querySelector<HTMLElement>("input, button");
          fallback?.focus({ preventScroll: true });
        }
      });
    };
  }, [navigation?.details, props.open]);
  if (!navigation?.details) {
    const { returnFocus: _, feedback, children, ...modalProps } = props;
    return (
      <Modal {...modalProps}>
        {feedback}
        {children}
      </Modal>
    );
  }
  if (!props.open) return null;
  return createPortal(
    <section
      className={`catalog-step ${props.className || ""}`}
      aria-label={props.title}
    >
      <header className="catalog-step-navigation">
        <div className="catalog-step-heading">
          <button
            type="button"
            className="catalog-back"
            data-modal-back
            disabled={props.dismissible === false}
            onClick={() => props.onOpenChange(false)}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="sr-only">返回</span>
          </button>
          <h2 ref={heading} tabIndex={-1}>
            {props.title}
          </h2>
          {props.headerActions && (
            <div className="catalog-heading-actions">{props.headerActions}</div>
          )}
        </div>
        {props.feedback && (
          <div className="catalog-heading-feedback">{props.feedback}</div>
        )}
      </header>
      {props.description && <p className="muted">{props.description}</p>}
      {props.children}
    </section>,
    navigation.details,
  );
}

export function CatalogUse({
  kind,
  entry,
  disabled = false,
}: {
  kind: "$" | "@";
  entry: Json;
  disabled?: boolean;
}) {
  const navigation = useContext(CatalogNavigation);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (!navigation?.onUse) return null;
  return (
    <div className="catalog-use">
      <button
        className="primary catalog-use-button"
        disabled={busy || disabled}
        onClick={async () => {
          if (pending.current) return;
          const controller = new AbortController();
          pending.current = controller;
          const unlock = navigation.lock();
          setBusy(true);
          setError("");
          try {
            await navigation.onUse!(kind, entry, controller.signal);
          } catch (e) {
            if (!controller.signal.aborted)
              setError(e instanceof Error ? e.message : "选择失败，请重试");
          } finally {
            unlock();
            pending.current = null;
            setBusy(false);
          }
        }}
      >
        {busy ? "正在选择…" : "在聊天中使用"}
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
