import { useEffect, useState } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { morphHoodi, USDC_ADDRESS, USDC_DECIMALS } from "./morph";

const client = createPublicClient({
  chain: morphHoodi,
  transport: http(morphHoodi.rpcUrls.default.http[0]),
});

const balanceOfAbi = [{
  name: "balanceOf",
  type: "function",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
}] as const;

export function useUsdcBalance(address: string | undefined) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) { setBalance(null); return; }

    let cancelled = false;
    async function fetch() {
      setLoading(true);
      try {
        const raw = await client.readContract({
          address: USDC_ADDRESS,
          abi: balanceOfAbi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        if (!cancelled) {
          setBalance(formatUnits(raw, USDC_DECIMALS));
        }
      } catch (e) {
        console.error("Failed to fetch USDC balance:", e);
        if (!cancelled) setBalance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    const interval = setInterval(fetch, 15_000); // refresh every 15s
    return () => { cancelled = true; clearInterval(interval); };
  }, [address]);

  return { balance, loading };
}
