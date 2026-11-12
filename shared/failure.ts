// Public diagnostics contain only product-authored text and bounded protocol facts.
export type Failure = {
  message: string;
  category?: string;
  action?: string;
  httpStatus?: number;
  code?: string;
  retrying?: boolean;
};
