import type { ReactNode } from "react";

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
      <span className="catalog-identity">
        <strong title={name}>{name}</strong>
        {description && <small title={description}>{description}</small>}
      </span>
      {status && <span className="catalog-status">{status}</span>}
    </span>
  );
}
