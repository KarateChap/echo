import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const executePayment = internalAction({
  args: {
    ruleId: v.id("rules"),
  },
  handler: async (ctx, { ruleId }) => {
    const agentKey = process.env.AGENT_PRIVATE_KEY;
    const rpcUrl = process.env.MORPH_HOODI_RPC_URL;

    if (!agentKey || !rpcUrl) {
      await ctx.runMutation(internal.transactions.recordFailure, {
        ruleId,
        error: "Missing env: AGENT_PRIVATE_KEY or MORPH_HOODI_RPC_URL",
      });
      return;
    }

    const TOKEN_ADDRESSES: Record<string, { address: string; decimals: number }> = {
      USDC: { address: process.env.USDC_ADDRESS ?? "0x1178341838B764dCfFA5BCEAb1d41443Fd71a227", decimals: 6 },
      USDT: { address: "0xb646c743b4ba47ac03bee360bb2484fb55db8d7e", decimals: 6 },
      HTT: { address: "0xecf966cc754bc411e1f1106fbb4e343b835e85e4", decimals: 18 },
    };

    const rule = await ctx.runQuery(internal.rules.getInternal, { ruleId });
    if (!rule) {
      await ctx.runMutation(internal.transactions.recordFailure, {
        ruleId,
        error: "Rule not found",
      });
      return;
    }

    // Guard: don't execute if already completed or cancelled
    if (rule.status === "completed" || rule.status === "cancelled") {
      return;
    }

    if (!rule.recipientWalletAddress) {
      await ctx.runMutation(internal.transactions.recordFailure, {
        ruleId,
        error: `Recipient "${rule.recipientName}" has no wallet address yet — they need to claim first`,
      });
      // Mark one-shot rules as cancelled on failure so they don't stay pending
      if (rule.kind === "oneShot") {
        await ctx.runMutation(internal.rules.markCancelled, { ruleId });
      }
      return;
    }

    try {
      const { createWalletClient, createPublicClient, http, parseUnits, parseEther, encodeFunctionData, defineChain } = await import("viem");
      const { privateKeyToAccount } = await import("viem/accounts");

      const morphHoodi = defineChain({
        id: 2910,
        name: "Morph Hoodi Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
        blockExplorers: { default: { name: "MorphScan", url: "https://explorer-hoodi.morph.network" } },
        testnet: true,
      });

      const account = privateKeyToAccount(agentKey as `0x${string}`);
      const client = createWalletClient({
        account,
        chain: morphHoodi,
        transport: http(rpcUrl),
      });
      const publicClient = createPublicClient({
        chain: morphHoodi,
        transport: http(rpcUrl),
      });

      const token = rule.token;
      if (!token || token === "Unknown") {
        await ctx.runMutation(internal.transactions.recordFailure, {
          ruleId,
          error: "Rule is missing token — cannot execute payment",
        });
        if (rule.kind === "oneShot") {
          await ctx.runMutation(internal.rules.markCancelled, { ruleId });
        }
        return;
      }
      let txHash: `0x${string}`;

      if (token === "ETH") {
        // Native ETH transfer
        const value = parseEther(rule.amountUsdc.toString());
        txHash = await client.sendTransaction({
          to: rule.recipientWalletAddress as `0x${string}`,
          value,
          chain: morphHoodi,
        });
      } else {
        // ERC-20 transfer
        const tokenInfo = TOKEN_ADDRESSES[token];
        if (!tokenInfo) throw new Error(`Unsupported token: ${token}`);

        const amount = parseUnits(rule.amountUsdc.toString(), tokenInfo.decimals);
        const data = encodeFunctionData({
          abi: [{
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
          }],
          functionName: "transfer",
          args: [rule.recipientWalletAddress as `0x${string}`, amount],
        });

        txHash = await client.sendTransaction({
          to: tokenInfo.address as `0x${string}`,
          data,
          chain: morphHoodi,
        });
      }

      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

      const transactionId = await ctx.runMutation(internal.transactions.recordSuccess, {
        ruleId,
        ownerId: rule.ownerId,
        recipientId: rule.recipientId,
        amountUsdc: rule.amountUsdc,
        token,
        txHash,
        voiceMessageId: rule.voiceMessageId,
        hasRecipientEmail: !!rule.recipientEmail,
      });

      // Notify recipient only after confirmed on-chain success
      if (rule.recipientEmail) {
        console.log(`[executePayment] Scheduling notification for rule ${ruleId}, tx ${transactionId}`);
        await ctx.scheduler.runAfter(0, internal.notify.sendClaimEmail, {
          ruleId,
          recipientId: rule.recipientId,
          recipientEmail: rule.recipientEmail,
          recipientName: rule.recipientName,
          senderName: rule.ownerName,
          amountUsdc: rule.amountUsdc,
          cryptoToken: token,
          voiceMessageId: rule.voiceMessageId,
          transactionId,
        });
      } else {
        console.log(`[executePayment] No recipientEmail, skipping notification for rule ${ruleId}`);
      }

      // Mark one-shot rules as completed after successful payment
      if (rule.kind === "oneShot") {
        await ctx.runMutation(internal.rules.markCompleted, { ruleId });
      }

    } catch (e) {
      const rawError = e instanceof Error ? e.message : String(e);

      // Extract a human-readable error from viem's verbose output
      let friendlyError = rawError;
      const revertMatch = rawError.match(/reason:\s*(.+?)(?:\.|$)/);
      const detailsMatch = rawError.match(/Details:\s*(.+?)(?:\n|$)/);
      if (revertMatch) {
        friendlyError = revertMatch[1].trim();
      } else if (detailsMatch) {
        friendlyError = detailsMatch[1].trim();
      } else if (rawError.length > 150) {
        friendlyError = rawError.slice(0, 150) + "…";
      }

      await ctx.runMutation(internal.transactions.recordFailure, {
        ruleId,
        error: friendlyError,
      });

      // Mark one-shot rules as cancelled on failure so they don't stay pending
      if (rule.kind === "oneShot") {
        await ctx.runMutation(internal.rules.markCancelled, { ruleId });
      }
    }
  },
});

export const executeRefund = internalAction({
  args: {
    ruleId: v.id("rules"),
    refundAmount: v.number(),
  },
  handler: async (ctx, { ruleId, refundAmount }) => {
    const agentKey = process.env.AGENT_PRIVATE_KEY;
    const rpcUrl = process.env.MORPH_HOODI_RPC_URL;

    if (!agentKey || !rpcUrl) {
      console.error("[executeRefund] Missing env: AGENT_PRIVATE_KEY or MORPH_HOODI_RPC_URL");
      return;
    }

    const TOKEN_ADDRESSES: Record<string, { address: string; decimals: number }> = {
      USDC: { address: process.env.USDC_ADDRESS ?? "0x1178341838B764dCfFA5BCEAb1d41443Fd71a227", decimals: 6 },
      USDT: { address: "0xb646c743b4ba47ac03bee360bb2484fb55db8d7e", decimals: 6 },
      HTT: { address: "0xecf966cc754bc411e1f1106fbb4e343b835e85e4", decimals: 18 },
    };

    const rule = await ctx.runQuery(internal.rules.getInternal, { ruleId });
    if (!rule) {
      console.error("[executeRefund] Rule not found:", ruleId);
      return;
    }

    // Get the owner's wallet address to send refund to
    const owner = await ctx.runQuery(internal.users.getInternal, { userId: rule.ownerId });
    if (!owner?.walletAddress) {
      console.error("[executeRefund] Owner wallet not found for rule:", ruleId);
      return;
    }

    try {
      const { createWalletClient, createPublicClient, http, parseUnits, parseEther, encodeFunctionData, defineChain } = await import("viem");
      const { privateKeyToAccount } = await import("viem/accounts");

      const morphHoodi = defineChain({
        id: 2910,
        name: "Morph Hoodi Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
        blockExplorers: { default: { name: "MorphScan", url: "https://explorer-hoodi.morph.network" } },
        testnet: true,
      });

      const account = privateKeyToAccount(agentKey as `0x${string}`);
      const client = createWalletClient({
        account,
        chain: morphHoodi,
        transport: http(rpcUrl),
      });
      const publicClient = createPublicClient({
        chain: morphHoodi,
        transport: http(rpcUrl),
      });

      const token = rule.token;
      if (!token || token === "Unknown") {
        console.error("[executeRefund] Rule missing token:", ruleId);
        return;
      }

      let txHash: `0x${string}`;

      if (token === "ETH") {
        const value = parseEther(refundAmount.toString());
        txHash = await client.sendTransaction({
          to: owner.walletAddress as `0x${string}`,
          value,
          chain: morphHoodi,
        });
      } else {
        const tokenInfo = TOKEN_ADDRESSES[token];
        if (!tokenInfo) {
          console.error("[executeRefund] Unsupported token:", token);
          return;
        }

        const amount = parseUnits(refundAmount.toString(), tokenInfo.decimals);
        const data = encodeFunctionData({
          abi: [{
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
          }],
          functionName: "transfer",
          args: [owner.walletAddress as `0x${string}`, amount],
        });

        txHash = await client.sendTransaction({
          to: tokenInfo.address as `0x${string}`,
          data,
          chain: morphHoodi,
        });
      }

      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

      // Record the refund transaction
      await ctx.runMutation(internal.transactions.recordRefund, {
        ruleId,
        ownerId: rule.ownerId,
        recipientId: rule.recipientId,
        amountUsdc: refundAmount,
        token,
        txHash,
      });

      console.log(`[executeRefund] Refunded ${refundAmount} ${token} to ${owner.walletAddress} for rule ${ruleId}`);
    } catch (e) {
      console.error("[executeRefund] Failed:", e instanceof Error ? e.message : String(e));
    }
  },
});
