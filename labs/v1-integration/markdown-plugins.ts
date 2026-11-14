import { defaultRehypePlugins } from "streamdown";

// Filter untrusted HTML before generating trusted KaTeX markup. Upstream
// 1.6.11 does this in the reverse order and removes its own math attributes.
// Keep both of the upstream safety filters; KaTeX retains trust:false.
export const markdownPlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
];
