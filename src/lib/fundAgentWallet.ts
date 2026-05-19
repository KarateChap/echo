import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseUnits,
  parseEther,
  encodeFunctionData,
} from "viem";
import { morphHoodi } from "./morph";
import type { Token } from "./tokens";

const AGENT_ADDRESS = import.meta.env.VITE_AGENT_WALLET_ADDRESS as `0x${string}`;

const transferAbi = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

interface FundParams {
  wallet: {
    switchChain: (chainId: number) => Promise<void>;
    getEthereumProvider: () => Promise<any>;
  };
  token: Token;
  amount: number;
}

export async function fundAgentWallet({
  wallet,
  token,
  amount,
}: FundParams): Promise<`0x${string}`> {
  if (!AGENT_ADDRESS) {
    throw new Error("Agent wallet address not configured (VITE_AGENT_WALLET_ADDRESS)");
  }

  // Ensure we're on Morph Hoodi
  await wallet.switchChain(morphHoodi.id);
  const provider = await wallet.getEthereumProvider();

  const walletClient = createWalletClient({
    chain: morphHoodi,
    transport: custom(provider),
  });
  const publicClient = createPublicClient({
    chain: morphHoodi,
    transport: http(morphHoodi.rpcUrls.default.http[0]),
  });

  const [userAddress] = await walletClient.getAddresses();
  if (!userAddress) throw new Error("Could not get wallet address");

  let txHash: `0x${string}`;

  if (token.address === "native") {
    // Native ETH transfer
    txHash = await walletClient.sendTransaction({
      account: userAddress,
      to: AGENT_ADDRESS,
      value: parseEther(amount.toString()),
      chain: morphHoodi,
    });
  } else {
    // ERC-20 transfer
    const data = encodeFunctionData({
      abi: transferAbi,
      functionName: "transfer",
      args: [AGENT_ADDRESS, parseUnits(amount.toString(), token.decimals)],
    });

    txHash = await walletClient.sendTransaction({
      account: userAddress,
      to: token.address as `0x${string}`,
      data,
      chain: morphHoodi,
    });
  }

  // Wait for on-chain confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

  return txHash;
}
