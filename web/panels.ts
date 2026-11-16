import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  panelLayout,
  panelLimits,
  clampPanel,
  type PanelSide,
} from "./panel-sizing";
function saved(side: PanelSide) {
  try {
    const value = Number(localStorage.getItem(panelLimits[side].key));
    return value >= panelLimits[side].min && value <= panelLimits[side].max
      ? value
      : panelLimits[side].initial;
  } catch {
    return panelLimits[side].initial;
  }
}
export const panelPreferences = create(() => ({
  left: saved("left"),
  right: saved("right"),
}));
export function updatePanel(side: PanelSide, width: number, persist = false) {
  const value = clampPanel(side, width);
  panelPreferences.setState({ [side]: value });
  if (persist) {
    try {
      localStorage.setItem(panelLimits[side].key, String(value));
    } catch {}
  }
}
export function usePanelLayout(leftOpen: boolean, rightOpen: boolean) {
  const widths = panelPreferences();
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return panelLayout(viewport, leftOpen, rightOpen, widths.left, widths.right);
}
