import {
  createPublicClient,
  http,
  encodeFunctionData,
} from "viem";
import { morphHoodi } from "./morph";
import { echoDelegatorAbi } from "./echoDelegatorAbi";

interface RevokeParams {
  wallet: {
    switchChain: (chainId: number) => Promise<void>;
    getEthereumProvider: () => Promise<any>;
  };
  recipient: `0x${string}`;
  tokenAddress: `0x${string}`; // address(0) for native ETH
}

export async function revokeDelegate({
  wallet,
  recipient,
  tokenAddress,
}: RevokeParams): Promise<`0x${string}`> {
  await wallet.switchChain(morphHoodi.id);
  const provider = await wallet.getEthereumProvider();

  const publicClient = createPublicClient({
    chain: morphHoodi,
    transport: http(morphHoodi.rpcUrls.default.http[0]),
  });

  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  const userAddress = accounts[0] as `0x${string}`;
  if (!userAddress) throw new Error("Could not get wallet address");

  const data = encodeFunctionData({
    abi: echoDelegatorAbi,
    functionName: "revoke",
    args: [recipient, tokenAddress],
  });

  // Call revoke() on user's own EOA (delegator code is already set from delegation)
  // Use standard eth_sendTransaction — no new authorization needed
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: userAddress,
      to: userAddress, // call self
      data,
      value: "0x0",
    }],
  }) as `0x${string}`;

  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

  return txHash;
}
