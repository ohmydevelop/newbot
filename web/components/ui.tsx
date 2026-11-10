import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
const modalClosers = new WeakMap<HTMLElement, () => void>();
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className = "",
  onCloseAutoFocus,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  onCloseAutoFocus?: (event: Event) => void;
  dismissible?: boolean;
}) {
  const content = useRef<HTMLDivElement | null>(null);
  const close = useRef(() => {});
  close.current = () => {
    if (dismissible) onOpenChange(false);
  };
  const descriptionId = useId();
  const wasOpen = useRef(false),
    returnTarget = useRef<HTMLElement | null>(null);
  if (open && !wasOpen.current) {
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const menu = active?.closest('[role="menu"]');
    const trigger = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'),
    ).find((el) =>
      menu
        ? el.getAttribute("aria-controls") === menu.id
        : el.dataset.state === "open",
    );
    returnTarget.current =
      menu || active === document.body ? trigger || active : active;
  }
  wasOpen.current = open;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim" />
        <Dialog.Content
          ref={(node) => {
            if (content.current) modalClosers.delete(content.current);
            content.current = node;
            if (node) modalClosers.set(node, () => close.current());
          }}
          className={`modal ${wide ? "wide" : ""} ${className}`}
          onOpenAutoFocus={(event) => {
            const target = event.target as HTMLElement;
            const preferred = target.querySelector<HTMLElement>(
              "[data-autofocus]:not([disabled])",
            );
            if (preferred) {
              event.preventDefault();
              preferred.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (!event.defaultPrevented && returnTarget.current?.isConnected) {
              const focused = document.activeElement;
              const closing =
                event.target instanceof HTMLElement ? event.target : null;
              event.preventDefault();
              if (
                !focused ||
                focused === document.body ||
                closing?.contains(focused)
              )
                returnTarget.current.focus({ preventScroll: true });
            }
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            // A child can mount before Radix registers its dismissable layer.
            const top = Array.from(
              document.querySelectorAll<HTMLElement>(
                '.modal[role="dialog"][data-state="open"]',
              ),
            ).at(-1);
            if (top) modalClosers.get(top)?.();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          aria-describedby={description ? descriptionId : undefined}
        >
          <header className="modal-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close
              className="icon-button"
              aria-label="关闭"
              disabled={!dismissible}
            >
              <X size={19} />
            </Dialog.Close>
          </header>
          {description && (
            <Dialog.Description id={descriptionId} className="muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 24V8h5l5 9 5-9h5v16h-5V16l-5 8-5-8v8H6Z"
        fill="currentColor"
      />
    </svg>
  );
}
