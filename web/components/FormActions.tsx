import type { ComponentPropsWithRef, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

const layouts = {
  editor: "editor-actions",
  catalog: "catalog-form-actions",
  modal: "modal-actions",
};

/** Preserve each established layout; business actions and their order stay with the caller. */
export function FormActions({
  layout = "editor",
  className,
  ...props
}: ComponentPropsWithRef<"div"> & { layout?: keyof typeof layouts }) {
  return (
    <div
      {...props}
      className={[layouts[layout], className].filter(Boolean).join(" ")}
    />
  );
}

/** Presentation only: no request, retry, or duplicate copy of the form's pending state. */
export function FormSubmit({
  busy = false,
  busyLabel,
  spinner = false,
  disabled,
  className,
  children,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "type"> & {
  busy?: boolean;
  busyLabel?: ReactNode;
  spinner?: boolean;
}) {
  return (
    <button
      {...props}
      type="submit"
      className={["primary", className].filter(Boolean).join(" ")}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
    >
      {busy && spinner && (
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
      )}
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
