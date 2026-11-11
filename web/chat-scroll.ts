import { flushSync } from "react-dom";

/** User disclosures anchor the clicked control, not the old bottom of the chat. */
export function anchorDisclosure(control: HTMLElement, change: () => void) {
  const viewport = control.closest<HTMLElement>(
    ".process-viewport, .conversation",
  );
  if (!viewport) return change();
  const before = control.getBoundingClientRect().top;
  flushSync(change);
  if (control.isConnected)
    viewport.scrollTop += control.getBoundingClientRect().top - before;
}
