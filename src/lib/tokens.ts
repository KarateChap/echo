export interface Token {
  symbol: string;
  name: string;
  address: `0x${string}` | "native";
  decimals: number;
  icon: string;
  isCustom?: boolean;
  customTokenId?: string;
}

export const BUILTIN_TOKENS: Token[] = [
  {
    symbol: "ETH",
    name: "Ether",
    address: "native",
    decimals: 18,
    icon: "⟠",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x7433b41C6c5e1d58D4Da99483609520255ab661B",
    decimals: 6,
    icon: "💵",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xb646c743b4ba47ac03bee360bb2484fb55db8d7e",
    decimals: 6,
    icon: "💲",
  },
  {
    symbol: "HTT",
    name: "Hoodi Test Token",
    address: "0xecf966cc754bc411e1f1106fbb4e343b835e85e4",
    decimals: 18,
    icon: "🪙",
  },
];

// Keep TOKENS as the builtin list for backwards compat in imports
export const TOKENS = BUILTIN_TOKENS;
