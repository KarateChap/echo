import { useEffect, useMemo, useState } from "react";
import type { TokenBalance } from "./useTokenBalances";

// Derive HTTP actions URL from Convex URL (same pattern as VoiceHome)
const siteUrl = (import.meta.env.VITE_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site");

interface PriceData {
  prices: Record<string, Record<string, number>> | null;
  currencies: string[];
  updatedAt?: number;
}

export interface PortfolioValue {
  total: Record<string, number>;
  currencies: string[];
  loading: boolean;
}

export function usePortfolioValue(balances: TokenBalance[]): PortfolioValue {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!siteUrl) return;

    let cancelled = false;

    async function fetchPrices() {
      try {
        const res = await fetch(`${siteUrl}/api/prices`);
        if (!res.ok) return;
        const data = (await res.json()) as PriceData;
        if (!cancelled) {
          setPriceData(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const total = useMemo(() => {
    const totals: Record<string, number> = {};
    if (!priceData?.prices) return totals;

    const currencies = priceData.currencies;
    for (const c of currencies) totals[c] = 0;

    for (const b of balances) {
      const tokenPrices = priceData.prices[b.token.symbol];
      if (!tokenPrices) continue;
      const amount = parseFloat(b.formatted);
      if (isNaN(amount) || amount === 0) continue;

      for (const c of currencies) {
        const rate = tokenPrices[c.toLowerCase()] ?? 0;
        totals[c] += amount * rate;
      }
    }

    return totals;
  }, [balances, priceData]);

  return {
    total,
    currencies: priceData?.currencies ?? [],
    loading,
  };
}
