import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

export const ActionMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Dropdown.Content>
>(function ActionMenuContent(
  {
    className = "",
    sideOffset = 8,
    collisionPadding = 12,
    align = "end",
    ...props
  },
  ref,
) {
  return (
    <Dropdown.Content
      ref={ref}
      className={`dropdown action-menu ${className}`}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      align={align}
      {...props}
    />
  );
});
export const ActionMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Dropdown.Item> & {
    icon: LucideIcon;
    destructive?: boolean;
    separated?: boolean;
    description?: string;
    trailing?: ReactNode;
  }
>(function ActionMenuItem(
  {
    icon: Icon,
    destructive,
    separated,
    description,
    trailing,
    className = "",
    children,
    ...props
  },
  ref,
) {
  return (
    <>
      {separated && <Dropdown.Separator className="action-menu-separator" />}
      <Dropdown.Item
        ref={ref}
        data-variant={destructive ? "destructive" : "default"}
        className={`action-menu-item ${destructive ? "action-destructive" : ""} ${className}`}
        {...props}
      >
        <Icon
          className="action-menu-icon"
          size={18}
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="action-menu-label">
          {children}
          {description && <small>{description}</small>}
        </span>
        {trailing && (
          <span className="action-menu-trailing" aria-hidden="true">
            {trailing}
          </span>
        )}
      </Dropdown.Item>
    </>
  );
});
