export type MarketplaceSource = {
  source: string;
  refName?: string;
  sparsePaths?: string[];
};
export type ManagedMarketplace = MarketplaceSource & {
  id: string;
  name: string;
  displayName: string;
  root: string;
  updated: number;
};
export type MarketplaceState = {
  revision: string;
  entries: ManagedMarketplace[];
  receipts: Record<string, { fingerprint: string; id: string }>;
};
export type MarketplaceView = {
  revision: string;
  entries: Array<
    Omit<ManagedMarketplace, "root"> & {
      managed: boolean;
      plugins: number;
      installed: number;
    }
  >;
};
