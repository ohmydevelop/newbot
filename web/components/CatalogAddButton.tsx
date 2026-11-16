import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Plus } from "lucide-react";

export const CatalogAddButton = forwardRef<
  HTMLButtonElement,
  Omit<
    ComponentPropsWithoutRef<"button">,
    "children" | "className" | "aria-label"
  > & { label: string }
>(function CatalogAddButton({ label, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className="icon-button catalog-create"
      aria-label={label}
      title={label}
    >
      <Plus size={20} aria-hidden="true" />
    </button>
  );
});
