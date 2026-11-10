import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useMediaQuery } from "../media";
export function Sidebar({
  open,
  onOpenChange,
  restoreFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
  children: ReactNode;
}) {
  const narrow = useMediaQuery("(max-width: 760px)");
  if (!narrow)
    return open ? (
      <aside className="sidebar" aria-label="对话导航">
        {children}
      </aside>
    ) : null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sidebar-backdrop" />
        <Dialog.Content
          className="sidebar"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!document.querySelector('[role="dialog"]:not(.sidebar)'))
              restoreFocus();
          }}
        >
          <Dialog.Title className="sr-only">对话导航</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
