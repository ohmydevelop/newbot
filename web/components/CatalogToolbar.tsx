import type { ReactNode } from "react";
import { CatalogToolbarSlot } from "./CatalogNavigation";
import { SearchIcon } from "./AppIcons";

/** Tabs already name the catalog. Keep its query, filters and actions together. */
export function CatalogToolbar({
  label,
  query,
  onQuery,
  filters,
  children,
}: {
  label: string;
  query: string;
  onQuery: (query: string) => void;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CatalogToolbarSlot>
      <div className="catalog-toolbar" role="group" aria-label={`${label}操作`}>
        <label className="catalog-query">
          <SearchIcon size={16} />
          <input
            className="catalog-search"
            type="search"
            aria-label={`搜索${label}`}
            placeholder="搜索…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        {filters && <div className="catalog-toolbar-filters">{filters}</div>}
        <div className="catalog-toolbar-actions">{children}</div>
      </div>
    </CatalogToolbarSlot>
  );
}
