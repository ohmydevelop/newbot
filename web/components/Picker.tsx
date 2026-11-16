import * as Popover from "@radix-ui/react-popover";
import {
  useContext,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ModalLayer } from "./ui";
export type ComposerPanel =
  | "plugins"
  | "skills"
  | "runtime"
  | "reasoning"
  | "approval"
  | "attachments"
  | null;
export type PanelSetter = Dispatch<SetStateAction<ComposerPanel>>;
export function PickerContent({
  className = "",
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof Popover.Content>) {
  const inModal = useContext(ModalLayer);
  return (
    <Popover.Portal>
      <Popover.Content
        sideOffset={8}
        collisionPadding={12}
        {...props}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const focused = document.activeElement;
          const content =
            event.target instanceof HTMLElement ? event.target : null;
          if (
            !event.defaultPrevented &&
            focused &&
            focused !== document.body &&
            focused.isConnected &&
            !content?.contains(focused)
          )
            event.preventDefault();
        }}
        className={`picker-panel ${className}`}
        data-modal-layer={inModal || undefined}
      />
    </Popover.Portal>
  );
}
