import { THEMES } from "@/lib/themes";
import { useTheme } from "@/lib/ThemeContext";
import { X } from "lucide-react";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, setThemeId } = useTheme();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative mx-4 mb-4 w-full max-w-sm rounded-2xl border border-white/10 p-6 shadow-2xl sm:mb-0"
        style={{ background: "rgba(12, 16, 12, 0.95)" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="mb-3 block text-xs font-medium uppercase tracking-wider text-white/40">
            Theme Color
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {THEMES.map((t) => {
              const active = t.id === theme.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setThemeId(t.id)}
                  className="group relative flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-all duration-200"
                  style={{
                    borderColor: active ? t.swatch : "rgba(255,255,255,0.08)",
                    background: active
                      ? `rgba(${t.primaryRgb}, 0.1)`
                      : "rgba(255,255,255,0.03)",
                    boxShadow: active
                      ? `0 0 16px rgba(${t.primaryRgb}, 0.2)`
                      : "none",
                  }}
                >
                  <div
                    className="h-8 w-8 rounded-full transition-transform duration-200 group-hover:scale-110"
                    style={{
                      background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`,
                      boxShadow: `0 0 12px rgba(${t.primaryRgb}, 0.4)`,
                    }}
                  />
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: active ? t.swatch : "rgba(255,255,255,0.5)" }}
                  >
                    {t.name}
                  </span>
                  {active && (
                    <div
                      className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] text-white"
                      style={{ background: t.swatch }}
                    >
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
