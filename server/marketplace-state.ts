import type { Store } from "./db.js";
import type { MarketplaceState } from "../shared/marketplaces.js";
export const marketplaceKey = "plugins:marketplaces:v1";
export function marketplaceState(db: Store): MarketplaceState {
  const raw = db.get(marketplaceKey);
  return raw
    ? JSON.parse(raw)
    : { revision: "absent", entries: [], receipts: {} };
}
