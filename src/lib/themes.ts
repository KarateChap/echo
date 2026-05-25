export type RGB = [number, number, number];

export type ThemePreset = {
  id: string;
  name: string;
  swatch: string;

  // CSS hex colors
  background: string;
  primary: string;
  accent: string;
  primaryGlow: string;
  accentGlow: string;

  // RGB component strings for rgba() in CSS
  primaryRgb: string;
  accentRgb: string;
  glassRgb: string;
  glassLightRgb: string;
  deepRgb: string;
  accentGlowRgb: string;
  navRgb: string;
  navHoverRgb: string;
  textSecondaryRgb: string;
  textHoverRgb: string;
  toastBgRgb: string;
  placeholderRgb: string;

  // btn-accent gradient
  btnAccentFrom: string;
  btnAccentMid: string;
  btnAccentTo: string;

  // Canvas reference colors
  canvasPrimary: RGB;
  canvasGlow: RGB;
  canvasLight: RGB;
  canvasDim: RGB;
  canvasBgTint: RGB;
};

// --- Presets ---

const green: ThemePreset = {
  id: "green",
  name: "Morph",
  swatch: "#22c55e",
  background: "#060d08",
  primary: "#22c55e",
  accent: "#10b981",
  primaryGlow: "#4ade80",
  accentGlow: "#34d399",
  primaryRgb: "34, 197, 94",
  accentRgb: "16, 185, 129",
  glassRgb: "74, 222, 128",
  glassLightRgb: "134, 239, 172",
  deepRgb: "22, 163, 74",
  accentGlowRgb: "52, 211, 153",
  navRgb: "134, 239, 172",
  navHoverRgb: "200, 245, 215",
  textSecondaryRgb: "200, 240, 210",
  textHoverRgb: "220, 252, 231",
  toastBgRgb: "10, 30, 20",
  placeholderRgb: "134, 239, 172",
  btnAccentFrom: "#16a34a",
  btnAccentMid: "#22c55e",
  btnAccentTo: "#4ade80",
  canvasPrimary: [74, 222, 128],
  canvasGlow: [134, 239, 170],
  canvasLight: [180, 255, 200],
  canvasDim: [50, 200, 120],
  canvasBgTint: [8, 14, 10],
};

const indigo: ThemePreset = {
  id: "indigo",
  name: "Indigo",
  swatch: "#6366f1",
  background: "#080c18",
  primary: "#6366f1",
  accent: "#a855f7",
  primaryGlow: "#818cf8",
  accentGlow: "#c084fc",
  primaryRgb: "99, 102, 241",
  accentRgb: "168, 85, 247",
  glassRgb: "140, 160, 255",
  glassLightRgb: "180, 200, 255",
  deepRgb: "124, 58, 237",
  accentGlowRgb: "192, 132, 252",
  navRgb: "180, 200, 255",
  navHoverRgb: "200, 215, 255",
  textSecondaryRgb: "200, 210, 255",
  textHoverRgb: "220, 225, 255",
  toastBgRgb: "20, 30, 70",
  placeholderRgb: "180, 200, 255",
  btnAccentFrom: "#7c3aed",
  btnAccentMid: "#a855f7",
  btnAccentTo: "#c084fc",
  canvasPrimary: [140, 130, 255],
  canvasGlow: [180, 140, 255],
  canvasLight: [180, 220, 255],
  canvasDim: [100, 140, 255],
  canvasBgTint: [8, 12, 24],
};

const purple: ThemePreset = {
  id: "purple",
  name: "Purple",
  swatch: "#a855f7",
  background: "#0d0618",
  primary: "#a855f7",
  accent: "#d946ef",
  primaryGlow: "#c084fc",
  accentGlow: "#e879f9",
  primaryRgb: "168, 85, 247",
  accentRgb: "217, 70, 239",
  glassRgb: "180, 140, 255",
  glassLightRgb: "210, 180, 255",
  deepRgb: "126, 34, 206",
  accentGlowRgb: "232, 121, 249",
  navRgb: "200, 170, 255",
  navHoverRgb: "225, 210, 255",
  textSecondaryRgb: "210, 190, 255",
  textHoverRgb: "235, 220, 255",
  toastBgRgb: "25, 15, 45",
  placeholderRgb: "200, 170, 255",
  btnAccentFrom: "#7e22ce",
  btnAccentMid: "#a855f7",
  btnAccentTo: "#c084fc",
  canvasPrimary: [168, 120, 255],
  canvasGlow: [200, 160, 255],
  canvasLight: [220, 200, 255],
  canvasDim: [130, 100, 240],
  canvasBgTint: [12, 6, 20],
};

const cyan: ThemePreset = {
  id: "cyan",
  name: "Cyan",
  swatch: "#06b6d4",
  background: "#060d0d",
  primary: "#06b6d4",
  accent: "#14b8a6",
  primaryGlow: "#22d3ee",
  accentGlow: "#2dd4bf",
  primaryRgb: "6, 182, 212",
  accentRgb: "20, 184, 166",
  glassRgb: "74, 220, 230",
  glassLightRgb: "134, 235, 240",
  deepRgb: "8, 145, 178",
  accentGlowRgb: "45, 212, 191",
  navRgb: "134, 235, 240",
  navHoverRgb: "200, 245, 248",
  textSecondaryRgb: "200, 240, 245",
  textHoverRgb: "220, 248, 252",
  toastBgRgb: "10, 25, 30",
  placeholderRgb: "134, 235, 240",
  btnAccentFrom: "#0891b2",
  btnAccentMid: "#06b6d4",
  btnAccentTo: "#22d3ee",
  canvasPrimary: [74, 210, 230],
  canvasGlow: [134, 230, 240],
  canvasLight: [180, 240, 255],
  canvasDim: [50, 190, 210],
  canvasBgTint: [8, 12, 14],
};

const rose: ThemePreset = {
  id: "rose",
  name: "Rose",
  swatch: "#f43f5e",
  background: "#0d0608",
  primary: "#f43f5e",
  accent: "#ec4899",
  primaryGlow: "#fb7185",
  accentGlow: "#f472b6",
  primaryRgb: "244, 63, 94",
  accentRgb: "236, 72, 153",
  glassRgb: "255, 140, 160",
  glassLightRgb: "255, 180, 200",
  deepRgb: "225, 29, 72",
  accentGlowRgb: "244, 114, 182",
  navRgb: "255, 180, 200",
  navHoverRgb: "255, 215, 225",
  textSecondaryRgb: "255, 200, 210",
  textHoverRgb: "255, 225, 235",
  toastBgRgb: "35, 10, 20",
  placeholderRgb: "255, 180, 200",
  btnAccentFrom: "#e11d48",
  btnAccentMid: "#f43f5e",
  btnAccentTo: "#fb7185",
  canvasPrimary: [255, 100, 130],
  canvasGlow: [255, 160, 180],
  canvasLight: [255, 200, 215],
  canvasDim: [230, 80, 110],
  canvasBgTint: [14, 8, 10],
};

const amber: ThemePreset = {
  id: "amber",
  name: "Amber",
  swatch: "#f59e0b",
  background: "#0d0b06",
  primary: "#f59e0b",
  accent: "#f97316",
  primaryGlow: "#fbbf24",
  accentGlow: "#fb923c",
  primaryRgb: "245, 158, 11",
  accentRgb: "249, 115, 22",
  glassRgb: "255, 200, 100",
  glassLightRgb: "255, 220, 150",
  deepRgb: "217, 119, 6",
  accentGlowRgb: "251, 146, 60",
  navRgb: "255, 220, 150",
  navHoverRgb: "255, 235, 200",
  textSecondaryRgb: "255, 225, 180",
  textHoverRgb: "255, 240, 210",
  toastBgRgb: "35, 25, 10",
  placeholderRgb: "255, 220, 150",
  btnAccentFrom: "#d97706",
  btnAccentMid: "#f59e0b",
  btnAccentTo: "#fbbf24",
  canvasPrimary: [255, 190, 60],
  canvasGlow: [255, 220, 120],
  canvasLight: [255, 235, 180],
  canvasDim: [220, 160, 40],
  canvasBgTint: [14, 12, 8],
};

export const THEMES: ThemePreset[] = [green, indigo, purple, cyan, rose, amber];

export const DEFAULT_THEME = green;

export function getThemeById(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

// Canvas helpers

export function darkenRgb(c: RGB, factor: number): RGB {
  return [Math.round(c[0] * factor), Math.round(c[1] * factor), Math.round(c[2] * factor)];
}

export function lightenRgb(c: RGB, factor: number): RGB {
  return [
    Math.round(c[0] + (255 - c[0]) * factor),
    Math.round(c[1] + (255 - c[1]) * factor),
    Math.round(c[2] + (255 - c[2]) * factor),
  ];
}
