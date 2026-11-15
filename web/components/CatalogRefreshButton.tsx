import type { ComponentPropsWithRef } from "react";
import { RefreshCw } from "lucide-react";

/** Ref forwarding preserves the catalog's focus return after imports and details. */
export function CatalogRefreshButton({
  label,
  busy = false,
  iconSize = 18,
  disabled,
  ...props
}: Omit<
  ComponentPropsWithRef<"button">,
  "children" | "type" | "className" | "title" | "aria-label"
> & {
  label: string;
  busy?: boolean;
  iconSize?: number;
}) {
  return (
    <button
      {...props}
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
    >
      <RefreshCw
        size={iconSize}
        className={busy ? "spin" : ""}
        aria-hidden="true"
      />
    </button>
  );
}
