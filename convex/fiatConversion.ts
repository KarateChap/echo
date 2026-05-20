/**
 * Shared fiat-to-token conversion logic.
 * Fetches live exchange rates and converts a fiat amount to a token amount.
 */

export interface FiatConversionResult {
  amount: number;
  conversionRate: number;
}

/**
 * Convert a fiat amount to a token amount using live exchange rates.
 * Tries CoinGecko → FX API (stablecoins) → CryptoCompare (ETH) → hardcoded fallback.
 * Returns null if conversion fails entirely.
 */
export async function convertFiatToToken(
  amountFiat: number,
  fiatCurrency: string,
  token: string,
): Promise<FiatConversionResult | { error: string }> {
  if (token === "HTT") {
    return { error: "HTT is a testnet token with no fiat value. Please specify the amount in HTT directly." };
  }

  const currency = fiatCurrency.toLowerCase();
  const tokenToCgId: Record<string, string> = {
    ETH: "ethereum",
    USDC: "usd-coin",
    USDT: "tether",
  };
  const cgId = tokenToCgId[token];
  let rate = 0;

  // Try CoinGecko first
  try {
    const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=${currency}`;
    const priceRes = await fetch(cgUrl);
    if (priceRes.ok) {
      const cgData = (await priceRes.json()) as Record<string, Record<string, number>>;
      rate = cgData[cgId]?.[currency] ?? 0;
    } else {
      console.warn(`CoinGecko returned ${priceRes.status}`);
    }
  } catch (e) {
    console.warn("CoinGecko fetch failed:", e);
  }

  // Fallback: for stablecoins (USDC/USDT), use a USD-based FX rate approach
  if (rate === 0 && (token === "USDC" || token === "USDT")) {
    try {
      const fxRes = await fetch(`https://open.er-api.com/v6/latest/USD`);
      if (fxRes.ok) {
        const fxData = (await fxRes.json()) as { rates: Record<string, number> };
        rate = fxData.rates?.[fiatCurrency] ?? 0;
      }
    } catch (e) {
      console.warn("FX fallback failed:", e);
    }
  }

  // Fallback: for ETH, try CryptoCompare
  if (rate === 0 && token === "ETH") {
    try {
      const ccRes = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=${fiatCurrency}`);
      if (ccRes.ok) {
        const ccData = (await ccRes.json()) as Record<string, number>;
        rate = ccData[fiatCurrency] ?? 0;
      }
    } catch (e) {
      console.warn("CryptoCompare fallback failed:", e);
    }
  }

  // Hardcoded fallback rates when all APIs fail
  if (rate === 0) {
    const hardcodedUsdRates: Record<string, number> = {
      PHP: 56.0,
      USD: 1.0,
    };
    const usdRate = hardcodedUsdRates[fiatCurrency];
    if (usdRate) {
      if (token === "USDC" || token === "USDT") {
        rate = usdRate;
      } else if (token === "ETH") {
        rate = usdRate * 2500;
      }
      if (rate > 0) {
        console.warn(`Using hardcoded fallback rate: 1 ${token} ≈ ${rate} ${fiatCurrency}`);
      }
    }
  }

  if (rate > 0) {
    return { amount: amountFiat / rate, conversionRate: rate };
  }
  return { error: `Could not fetch ${fiatCurrency} price for ${token}. Please try again.` };
}
