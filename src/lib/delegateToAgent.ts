import {
  createPublicClient,
  http,
  encodeFunctionData,
  numberToHex,
} from "viem";
import { morphHoodi } from "./morph";
import { echoDelegatorAbi } from "./echoDelegatorAbi";

const DELEGATOR_ADDRESS = import.meta.env.VITE_ECHO_DELEGATOR_ADDRESS as `0x${string}`;
const AGENT_ADDRESS = import.meta.env.VITE_AGENT_WALLET_ADDRESS as `0x${string}`;

interface DelegateParams {
  wallet: {
    switchChain: (chainId: number) => Promise<void>;
    getEthereumProvider: () => Promise<any>;
  };
  recipient: `0x${string}`;
  tokenAddress: `0x${string}`; // address(0) for native ETH
  maxPerCycle: bigint;
  cycleSeconds: bigint;
  expiresAt: bigint;
}

export async function delegateToAgent({
  wallet,
  recipient,
  tokenAddress,
  maxPerCycle,
  cycleSeconds,
  expiresAt,
}: DelegateParams): Promise<`0x${string}`> {
  if (!DELEGATOR_ADDRESS) {
    throw new Error("Delegator address not configured (VITE_ECHO_DELEGATOR_ADDRESS)");
  }
  if (!AGENT_ADDRESS) {
    throw new Error("Agent address not configured (VITE_AGENT_WALLET_ADDRESS)");
  }

  await wallet.switchChain(morphHoodi.id);
  const provider = await wallet.getEthereumProvider();

  const publicClient = createPublicClient({
    chain: morphHoodi,
    transport: http(morphHoodi.rpcUrls.default.http[0]),
  });

  // Get user address
  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  const userAddress = accounts[0] as `0x${string}`;
  if (!userAddress) throw new Error("Could not get wallet address");

  // Get user's nonce for the authorization
  const nonce = await publicClient.getTransactionCount({ address: userAddress });

  // Encode delegate() calldata
  const data = encodeFunctionData({
    abi: echoDelegatorAbi,
    functionName: "delegate",
    args: [AGENT_ADDRESS, recipient, tokenAddress, maxPerCycle, cycleSeconds, expiresAt],
  });

  // Send Type-4 (EIP-7702) transaction directly through the provider.
  // Privy's embedded wallet supports eth_sendTransaction with type 0x04
  // and will sign both the authorization and the transaction internally.
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      type: "0x04",
      from: userAddress,
      to: userAddress, // call self — delegator code runs in EOA context
      data,
      value: "0x0",
      authorizationList: [{
        chainId: numberToHex(morphHoodi.id),
        address: DELEGATOR_ADDRESS,
        nonce: numberToHex(nonce),
      }],
    }],
  }) as `0x${string}`;

  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

  return txHash;
}

// Helper to resolve token address for the contract (address(0) for ETH)
export function resolveTokenAddress(token: { address: string }): `0x${string}` {
  if (token.address === "native") {
    return "0x0000000000000000000000000000000000000000";
  }
  return token.address as `0x${string}`;
}

// Helper to compute cycle seconds from schedule
export function computeCycleSeconds(schedule?: { kind: string; value: string }): bigint {
  if (!schedule) return 0n;
  switch (schedule.kind) {
    case "seconds":
      return BigInt(schedule.value);
    case "daily":
      return BigInt(86400);
    case "weekly":
      return BigInt(604800);
    case "biweekly":
      return BigInt(1209600);
    case "monthly":
      return BigInt(2592000); // 30 days
    case "yearly":
      return BigInt(31536000); // 365 days
    case "once":
      return 0n; // one-shot, no cycle
    default:
      return 0n;
  }
}
