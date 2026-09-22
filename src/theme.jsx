// ============================================================================
// theme.js — design tokens, chart palette, and the light/dark theme provider.
//
// Chart colors are the validated 8-slot categorical palette. Both modes were
// checked with the dataviz palette validator against this app's real surfaces
// (light #FFFFFF, dark #16191E): lightness band, chroma floor, CVD separation,
// normal-vision floor and contrast all pass.
// ============================================================================

import { createContext, useContext, useEffect, useMemo, useState } from "react";

// ─── Categorical series palette (fixed order — never cycled, never by rank) ──
export const SERIES = {
  light: ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#4A3AA7", "#E34948"],
  dark:  ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181", "#008300", "#9085E9", "#E66767"],
};

// Neutral used for everything past slot 8 ("Other").
export const SERIES_OTHER = { light: "#98A2B3", dark: "#7D8694" };

// ─── Status palette (reserved — never reused as a series color) ─────────────
// Marks always ship with a label, never color alone.
const STATUS = {
  good: "#0CA30C", warning: "#FAB219", serious: "#EC835A", critical: "#D03B3B",
};

// ─── Token sets ─────────────────────────────────────────────────────────────
const LIGHT = {
  mode: "light",
  page: "#F4F6F8",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC",
  surfaceSunken: "#F1F4F7",
  border: "#E3E8EF",
  borderStrong: "#CDD5DF",
  text: "#111927",
  text2: "#4B5565",
  text3: "#8A94A6",
  accent: "#2A78D6",
  accentSoft: "#EAF2FD",
  accentText: "#1B5CAB",
  grid: "#EDF0F4",
  axis: "#CDD5DF",
  // status, plus text-safe variants for use as type color on the light surface
  ...STATUS,
  goodText: "#067647",
  warningText: "#B54708",
  criticalText: "#B42318",
  shadow1: "0 1px 2px rgba(16,24,40,0.05)",
  shadow2: "0 8px 24px -6px rgba(16,24,40,0.14), 0 2px 6px -2px rgba(16,24,40,0.06)",
  meterTrack: "#E7ECF2",
  series: SERIES.light,
  seriesOther: SERIES_OTHER.light,
  // Outcome roles used for large chart fills (categorical, not status).
  chartOk: SERIES.light[2],
  chartProg: SERIES.light[0],
  chartWait: SERIES.light[3],
};

const DARK = {
  mode: "dark",
  page: "#0E1013",
  surface: "#16191E",
  surfaceAlt: "#1C2027",
  surfaceSunken: "#1A1E24",
  border: "#272C35",
  borderStrong: "#39404B",
  text: "#F2F4F7",
  text2: "#B3BCC9",
  text3: "#7D8694",
  accent: "#3987E5",
  accentSoft: "#152436",
  accentText: "#8FBEF2",
  grid: "#232830",
  axis: "#39404B",
  ...STATUS,
  goodText: "#4ADE80",
  warningText: "#FCD34D",
  criticalText: "#F98080",
  shadow1: "0 1px 2px rgba(0,0,0,0.4)",
  shadow2: "0 8px 24px -6px rgba(0,0,0,0.55), 0 2px 6px -2px rgba(0,0,0,0.4)",
  meterTrack: "#2B313A",
  series: SERIES.dark,
  seriesOther: SERIES_OTHER.dark,
  chartOk: SERIES.dark[2],
  chartProg: SERIES.dark[0],
  chartWait: SERIES.dark[3],
};

export const THEMES = { light: LIGHT, dark: DARK };

// ─── Provider ───────────────────────────────────────────────────────────────
const STORAGE_KEY = "zra_theme";
const ThemeCtx = createContext(LIGHT);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* private mode / blocked storage */ }
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch { /* no matchMedia */ }
  return "light";
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readStored);

  useEffect(() => {
    const t = THEMES[mode];
    const root = document.documentElement;
    root.setAttribute("data-theme", mode);
    root.style.colorScheme = mode;
    // Expose every token as a CSS custom property so stylesheets stay in sync.
    Object.entries(t).forEach(([k, v]) => {
      if (typeof v === "string") root.style.setProperty(`--${k}`, v);
    });
    t.series.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const value = useMemo(
    () => ({ ...THEMES[mode], mode, toggle: () => setMode(m => (m === "dark" ? "light" : "dark")) }),
    [mode]
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }

// ─── Stable color assignment ────────────────────────────────────────────────
// Color follows the entity, never its rank — so filtering the data never
// repaints the series that survive. `order` is the stable, full-dataset list.
export function colorFor(name, order, t) {
  const i = order.indexOf(name);
  if (i < 0 || i >= t.series.length) return t.seriesOther;
  return t.series[i];
}
