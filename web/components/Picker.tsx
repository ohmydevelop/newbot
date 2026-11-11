import * as Popover from "@radix-ui/react-popover";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
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
      />
    </Popover.Portal>
  );
}
