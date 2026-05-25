import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { type ThemePreset, DEFAULT_THEME, getThemeById } from "./themes";

type ThemeContextValue = {
  theme: ThemePreset;
  setThemeId: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setThemeId: () => {},
});

const STORAGE_KEY = "echo_theme";

function applyTheme(t: ThemePreset) {
  const s = document.documentElement.style;

  // Hex colors (used by Tailwind utilities via var())
  s.setProperty("--color-background", t.background);
  s.setProperty("--color-primary", t.primary);
  s.setProperty("--color-accent", t.accent);
  s.setProperty("--color-primary-glow", t.primaryGlow);
  s.setProperty("--color-accent-glow", t.accentGlow);

  // RGB component strings (used by rgba(var(...), opacity) in CSS)
  s.setProperty("--primary-rgb", t.primaryRgb);
  s.setProperty("--accent-rgb", t.accentRgb);
  s.setProperty("--glass-rgb", t.glassRgb);
  s.setProperty("--glass-light-rgb", t.glassLightRgb);
  s.setProperty("--deep-rgb", t.deepRgb);
  s.setProperty("--accent-glow-rgb", t.accentGlowRgb);
  s.setProperty("--nav-rgb", t.navRgb);
  s.setProperty("--nav-hover-rgb", t.navHoverRgb);
  s.setProperty("--text-secondary-rgb", t.textSecondaryRgb);
  s.setProperty("--text-hover-rgb", t.textHoverRgb);
  s.setProperty("--toast-bg-rgb", t.toastBgRgb);
  s.setProperty("--placeholder-rgb", t.placeholderRgb);

  // btn-accent gradient stops
  s.setProperty("--btn-accent-from", t.btnAccentFrom);
  s.setProperty("--btn-accent-mid", t.btnAccentMid);
  s.setProperty("--btn-accent-to", t.btnAccentTo);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemePreset>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? getThemeById(stored) : DEFAULT_THEME;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setThemeId = useCallback((id: string) => {
    const t = getThemeById(id);
    setTheme(t);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
