import { useCallback, useEffect, useState } from "react";

export const CURRENCY_CONFIG: Record<string, { symbol: string; locale: string; label: string }> = {
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
  MMK: { symbol: "K", locale: "my-MM", label: "Myanmar Kyat" },
  KHR: { symbol: "៛", locale: "km-KH", label: "Cambodian Riel" },
  LAK: { symbol: "₭", locale: "lo-LA", label: "Lao Kip" },
  BND: { symbol: "B$", locale: "ms-BN", label: "Brunei Dollar" },
  AED: { symbol: "د.إ", locale: "ar-AE", label: "UAE Dirham" },
  SAR: { symbol: "﷼", locale: "ar-SA", label: "Saudi Riyal" },
  BRL: { symbol: "R$", locale: "pt-BR", label: "Brazilian Real" },
  MXN: { symbol: "MX$", locale: "es-MX", label: "Mexican Peso" },
  ZAR: { symbol: "R", locale: "en-ZA", label: "South African Rand" },
};

export const CURRENCY_STORAGE_KEY = "echo-portfolio-currency";

// Module-level subscribers for same-tab sync
const subscribers = new Set<(c: string) => void>();

function getSavedCurrency(): string {
  try {
    return localStorage.getItem(CURRENCY_STORAGE_KEY) ?? "PHP";
  } catch {
    return "PHP";
  }
}

export function useCurrency() {
  const [currency, _setCurrency] = useState(getSavedCurrency);

  const setCurrency = useCallback((c: string) => {
    _setCurrency(c);
    try { localStorage.setItem(CURRENCY_STORAGE_KEY, c); } catch {}
    for (const fn of subscribers) fn(c);
  }, []);

  useEffect(() => {
    const handler = (c: string) => _setCurrency(c);
    subscribers.add(handler);
    return () => { subscribers.delete(handler); };
  }, []);

  return { currency, setCurrency };
}

export function formatFiatValue(amount: number, currency: string): string {
  const config = CURRENCY_CONFIG[currency] ?? { locale: "en-US" };
  const noFractions = currency === "JPY" || currency === "KRW" || currency === "MMK" || currency === "KHR" || currency === "LAK";
  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: noFractions ? 0 : 2,
    maximumFractionDigits: noFractions ? 0 : 2,
  }).format(amount);
}
