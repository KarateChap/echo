import { useState, useRef, useEffect } from "react";

const CURRENCY_CONFIG: Record<string, { symbol: string; locale: string; label: string }> = {
  PHP: { symbol: "₱", locale: "en-PH", label: "Philippine Peso" },
  USD: { symbol: "$", locale: "en-US", label: "US Dollar" },
  EUR: { symbol: "€", locale: "de-DE", label: "Euro" },
  GBP: { symbol: "£", locale: "en-GB", label: "British Pound" },
  JPY: { symbol: "¥", locale: "ja-JP", label: "Japanese Yen" },
  SGD: { symbol: "S$", locale: "en-SG", label: "Singapore Dollar" },
  KRW: { symbol: "₩", locale: "ko-KR", label: "Korean Won" },
  AUD: { symbol: "A$", locale: "en-AU", label: "Australian Dollar" },
  CAD: { symbol: "C$", locale: "en-CA", label: "Canadian Dollar" },
  CHF: { symbol: "Fr", locale: "de-CH", label: "Swiss Franc" },
  CNY: { symbol: "¥", locale: "zh-CN", label: "Chinese Yuan" },
  HKD: { symbol: "HK$", locale: "en-HK", label: "Hong Kong Dollar" },
  INR: { symbol: "₹", locale: "en-IN", label: "Indian Rupee" },
  IDR: { symbol: "Rp", locale: "id-ID", label: "Indonesian Rupiah" },
  MYR: { symbol: "RM", locale: "ms-MY", label: "Malaysian Ringgit" },
  NZD: { symbol: "NZ$", locale: "en-NZ", label: "New Zealand Dollar" },
  THB: { symbol: "฿", locale: "th-TH", label: "Thai Baht" },
  TWD: { symbol: "NT$", locale: "zh-TW", label: "Taiwan Dollar" },
  VND: { symbol: "₫", locale: "vi-VN", label: "Vietnamese Dong" },
  AED: { symbol: "د.إ", locale: "ar-AE", label: "UAE Dirham" },
  SAR: { symbol: "﷼", locale: "ar-SA", label: "Saudi Riyal" },
  BRL: { symbol: "R$", locale: "pt-BR", label: "Brazilian Real" },
  MXN: { symbol: "MX$", locale: "es-MX", label: "Mexican Peso" },
  ZAR: { symbol: "R", locale: "en-ZA", label: "South African Rand" },
};

const STORAGE_KEY = "echo-portfolio-currency";

function getSavedCurrency(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "PHP";
  } catch {
    return "PHP";
  }
}

interface Props {
  total: Record<string, number>;
  currencies: string[];
  loading: boolean;
}

export default function PortfolioValueDisplay({ total, currencies, loading }: Props) {
  const [currency, setCurrency] = useState(getSavedCurrency);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function select(c: string) {
    setCurrency(c);
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, c); } catch {}
  }

  const value = total[currency] ?? 0;
  const config = CURRENCY_CONFIG[currency] ?? { symbol: currency, locale: "en-US", label: currency };

  const formatted = new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
  }).format(value);

  return (
    <div className="flex flex-col items-center gap-0.5">
      {loading ? (
        <div className="h-7 w-32 animate-pulse rounded-lg bg-white/[0.06]" />
      ) : (
        <span
          className="text-xl font-bold tabular-nums tracking-tight"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          {formatted}
        </span>
      )}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 transition-all duration-200 active:scale-95"
        >
          <span className="text-[10px] text-white/30">Total Portfolio Value</span>
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white/40 transition-colors hover:text-white/60"
            style={{ background: "rgba(140, 160, 255, 0.08)" }}
          >
            {currency}
            <svg
              className="h-2.5 w-2.5 transition-transform duration-200"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>

        {open && (
          <div
            className="absolute left-1/2 top-full z-50 mt-2 w-48 -translate-x-1/2 overflow-y-auto rounded-xl border border-white/[0.08] backdrop-blur-xl"
            style={{
              background: "rgba(15, 15, 30, 0.92)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(140, 160, 255, 0.06)",
              maxHeight: 300,
            }}
          >
            {currencies.map((c) => {
              const cfg = CURRENCY_CONFIG[c];
              if (!cfg) return null;
              const isActive = c === currency;
              const cValue = total[c] ?? 0;
              const cFormatted = new Intl.NumberFormat(cfg.locale, {
                style: "currency",
                currency: c,
                minimumFractionDigits: c === "JPY" || c === "KRW" ? 0 : 2,
                maximumFractionDigits: c === "JPY" || c === "KRW" ? 0 : 2,
              }).format(cValue);

              return (
                <button
                  key={c}
                  onClick={() => select(c)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.06]"
                  style={{
                    background: isActive ? "rgba(99, 102, 241, 0.12)" : undefined,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        background: isActive ? "rgba(99, 102, 241, 0.3)" : "rgba(140, 160, 255, 0.08)",
                        color: isActive ? "rgba(165, 170, 255, 1)" : "rgba(255,255,255,0.4)",
                      }}
                    >
                      {cfg.symbol}
                    </span>
                    <div>
                      <div
                        className="text-xs font-medium"
                        style={{ color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)" }}
                      >
                        {c}
                      </div>
                      <div className="text-[10px] text-white/30">{cfg.label}</div>
                    </div>
                  </div>
                  <span
                    className="text-[10px] tabular-nums"
                    style={{ color: isActive ? "rgba(165, 170, 255, 0.8)" : "rgba(255,255,255,0.25)" }}
                  >
                    {cFormatted}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
