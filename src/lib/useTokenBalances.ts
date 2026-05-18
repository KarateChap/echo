import { useEffect, useState } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { morphHoodi } from "./morph";
import { BUILTIN_TOKENS, type Token } from "./tokens";

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

export interface TokenBalance {
  token: Token;
  raw: bigint;
  formatted: string;
}

export function useTokenBalances(address: string | undefined, extraTokens?: Token[]) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(false);

  const allTokens = [...BUILTIN_TOKENS, ...(extraTokens ?? [])];
  // Serialize for useEffect dep
  const tokenKey = allTokens.map((t) => t.address).join(",");

  useEffect(() => {
    if (!address) { setBalances([]); return; }

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      try {
        const results = await Promise.all(
          allTokens.map(async (token): Promise<TokenBalance> => {
            try {
              if (token.address === "native") {
                const raw = await client.getBalance({ address: address as `0x${string}` });
                return { token, raw, formatted: formatUnits(raw, token.decimals) };
              } else {
                const raw = await client.readContract({
                  address: token.address as `0x${string}`,
                  abi: balanceOfAbi,
                  functionName: "balanceOf",
                  args: [address as `0x${string}`],
                });
                return { token, raw, formatted: formatUnits(raw, token.decimals) };
              }
            } catch {
              return { token, raw: 0n, formatted: "0" };
            }
          }),
        );
        if (!cancelled) setBalances(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    const interval = setInterval(fetchAll, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokenKey]);

  return { balances, loading };
}
