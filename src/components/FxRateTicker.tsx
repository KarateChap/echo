import { useMemo } from "react";
import { CURRENCY_CONFIG, useCurrency } from "@/lib/currencyConfig";

interface Props {
  prices: Record<string, Record<string, number>> | null;
  loading: boolean;
}

const SEA_CURRENCIES = [
  { code: "PHP", flag: "\u{1F1F5}\u{1F1ED}" },
  { code: "SGD", flag: "\u{1F1F8}\u{1F1EC}" },
  { code: "THB", flag: "\u{1F1F9}\u{1F1ED}" },
  { code: "VND", flag: "\u{1F1FB}\u{1F1F3}" },
  { code: "IDR", flag: "\u{1F1EE}\u{1F1E9}" },
  { code: "MYR", flag: "\u{1F1F2}\u{1F1FE}" },
  { code: "MMK", flag: "\u{1F1F2}\u{1F1F2}" },
  { code: "KHR", flag: "\u{1F1F0}\u{1F1ED}" },
  { code: "LAK", flag: "\u{1F1F1}\u{1F1E6}" },
  { code: "BND", flag: "\u{1F1E7}\u{1F1F3}" },
] as const;

const OTHER_CURRENCIES = [
  { code: "USD", flag: "\u{1F1FA}\u{1F1F8}" },
  { code: "EUR", flag: "\u{1F1EA}\u{1F1FA}" },
  { code: "GBP", flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "JPY", flag: "\u{1F1EF}\u{1F1F5}" },
  { code: "KRW", flag: "\u{1F1F0}\u{1F1F7}" },
  { code: "AUD", flag: "\u{1F1E6}\u{1F1FA}" },
  { code: "CAD", flag: "\u{1F1E8}\u{1F1E6}" },
  { code: "CHF", flag: "\u{1F1E8}\u{1F1ED}" },
  { code: "CNY", flag: "\u{1F1E8}\u{1F1F3}" },
  { code: "HKD", flag: "\u{1F1ED}\u{1F1F0}" },
  { code: "INR", flag: "\u{1F1EE}\u{1F1F3}" },
  { code: "NZD", flag: "\u{1F1F3}\u{1F1FF}" },
  { code: "TWD", flag: "\u{1F1F9}\u{1F1FC}" },
  { code: "AED", flag: "\u{1F1E6}\u{1F1EA}" },
  { code: "SAR", flag: "\u{1F1F8}\u{1F1E6}" },
  { code: "BRL", flag: "\u{1F1E7}\u{1F1F7}" },
  { code: "MXN", flag: "\u{1F1F2}\u{1F1FD}" },
  { code: "ZAR", flag: "\u{1F1FF}\u{1F1E6}" },
] as const;

const ALL_CURRENCIES: readonly { code: string; flag: string }[] = [...SEA_CURRENCIES, ...OTHER_CURRENCIES];

const NO_FRACTION_CURRENCIES = new Set(["VND", "IDR", "KRW", "MMK", "KHR", "LAK"]);

function formatRate(code: string, value: number): string {
  const cfg = CURRENCY_CONFIG[code];
  const sym = cfg?.symbol ?? "";

  if (NO_FRACTION_CURRENCIES.has(code)) {
    return sym + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  if (value > 0 && value < 10) {
    return sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value);
  }
  return sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export default function FxRateTicker({ prices, loading }: Props) {
  const { currency } = useCurrency();

  const items = useMemo(() => {
    const usdcPrices = prices?.USDC;
    if (!usdcPrices) return null;

    const baseRate = usdcPrices[currency.toLowerCase()] ?? 0;
    if (baseRate === 0) return null;

    const seaCodes = new Set<string>(SEA_CURRENCIES.map((c) => c.code));
    const targets = ALL_CURRENCIES.filter((c) => c.code !== currency);

    const seaTargets = targets.filter((c) => seaCodes.has(c.code));
    const otherTargets = targets.filter((c) => !seaCodes.has(c.code));
    const ordered = [...seaTargets, ...otherTargets].slice(0, 10);

    return ordered.map(({ code, flag }) => {
      const targetRate = usdcPrices[code.toLowerCase()] ?? 0;
      const crossRate = baseRate > 0 ? targetRate / baseRate : 0;
      return {
        code,
        flag,
        label: `${currency}/${code}`,
        formatted: formatRate(code, crossRate),
      };
    });
  }, [prices, currency]);

  if (loading) {
    return (
      <div className="mt-4 -mx-4 py-2">
        <div className="mx-4 h-6 animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    );
  }

  if (!items) return null;

  const doubled = [...items, ...items];

  return (
    <div
      className="ticker-mask mt-4 -mx-4 overflow-hidden"
      style={{
        borderTop: "1px solid rgba(140, 160, 255, 0.06)",
        borderBottom: "1px solid rgba(140, 160, 255, 0.06)",
        background:
          "linear-gradient(90deg, rgba(99, 102, 241, 0.03) 0%, rgba(140, 160, 255, 0.05) 50%, rgba(99, 102, 241, 0.03) 100%)",
        padding: "8px 0",
      }}
    >
      <div className="animate-ticker flex w-max items-center gap-2 pl-2">
        {doubled.map((item, i) => (
          <div
            key={`${item.code}-${i}`}
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 transition-colors duration-200"
            style={{
              background: "rgba(140, 160, 255, 0.05)",
              border: "1px solid rgba(140, 160, 255, 0.07)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span className="text-[13px] leading-none">{item.flag}</span>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[10px] font-medium uppercase tracking-wide"
                style={{ color: "rgba(140, 160, 255, 0.45)" }}
              >
                {item.label}
              </span>
              <span
                className="text-[12px] font-semibold tabular-nums"
                style={{ color: "rgba(255, 255, 255, 0.82)" }}
              >
                {item.formatted}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
