import { useState } from "react";
import { createPublicClient, http } from "viem";
import { morphHoodi } from "./morph";

const client = createPublicClient({
  chain: morphHoodi,
  transport: http(morphHoodi.rpcUrls.default.http[0]),
});

const erc20Abi = [
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

export function useTokenMetadata() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchMetadata(address: string): Promise<TokenMetadata | null> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Invalid contract address");
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "name" }),
        client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
      ]);

      return { name: name as string, symbol: symbol as string, decimals: Number(decimals) };
    } catch {
      setError("Could not read token. Make sure it's a valid ERC-20 on Morph Hoodi.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { fetchMetadata, loading, error };
}
