import { defineChain } from "viem";

export const morphHoodi = defineChain({
  id: Number(import.meta.env.VITE_MORPH_HOODI_CHAIN_ID),
  name: "Morph Hoodi Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_MORPH_HOODI_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "MorphScan Hoodi", url: import.meta.env.VITE_MORPH_HOODI_EXPLORER },
  },
  testnet: true,
});

export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS as `0x${string}`;
export const USDC_DECIMALS = 6;

export const ECHO_DELEGATOR_ADDRESS = import.meta.env.VITE_ECHO_DELEGATOR_ADDRESS as `0x${string}`;
export const AGENT_ADDRESS = import.meta.env.VITE_AGENT_WALLET_ADDRESS as `0x${string}`;
