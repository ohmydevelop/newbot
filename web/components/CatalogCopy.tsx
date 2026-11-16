import type { ReactNode } from "react";

/** Shared two-line identity: title/status first, optional purpose second. */
export function CatalogCopy({
  name,
  description,
  status,
}: {
  name: string;
  description?: string | null;
  status?: ReactNode;
}) {
  return (
    <span className="catalog-copy">
      <span className="catalog-title-line">
        <strong title={name}>{name}</strong>
        {status && <span className="catalog-status">{status}</span>}
      </span>
      {description && <small title={description}>{description}</small>}
    </span>
  );
}
