export type PanelSide = "left" | "right";
export const panelLimits = {
  left: { min: 220, max: 400, initial: 256, key: "newbot:navigation-width" },
  right: { min: 260, max: 520, initial: 300, key: "newbot:rail-width" },
} as const;
export function clampPanel(side: PanelSide, value: number) {
  const { min, max, initial } = panelLimits[side];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
}
export function panelKeyboard(
  side: PanelSide,
  value: number,
  key: string,
): number | null {
  if (key === "Home") return panelLimits[side].min;
  if (key === "End") return panelLimits[side].max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const direction = side === "left" ? 1 : -1;
  return clampPanel(
    side,
    value + (key === "ArrowRight" ? 10 : -10) * direction,
  );
}
export function panelLayout(
  viewport: number,
  leftOpen: boolean,
  rightOpen: boolean,
  preferredLeft: number,
  preferredRight: number,
) {
  let left = leftOpen ? clampPanel("left", preferredLeft) : 57;
  let right = clampPanel("right", preferredRight);
  const overlay = viewport <= 1080;
  if (viewport <= 760) return { left, right, overlay: true };
  let excess = Math.max(
    0,
    left + (rightOpen && !overlay ? right : 0) + 480 - viewport,
  );
  if (rightOpen && !overlay) {
    const reduction = Math.min(excess, right - panelLimits.right.min);
    right -= reduction;
    excess -= reduction;
  }
  if (leftOpen) left -= Math.min(excess, left - panelLimits.left.min);
  return { left, right, overlay };
}
