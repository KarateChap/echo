import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Atomically reserve the next nonce for a wallet.
 * Convex mutations are serializable — concurrent calls will never return the same nonce.
 */
export const reserveNonce = internalMutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    const addr = walletAddress.toLowerCase();
    const row = await ctx.db
      .query("nonceCounter")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", addr))
      .unique();

    if (!row) {
      throw new Error("NONCE_NOT_INITIALIZED");
    }

    const nonce = row.nextNonce;
    await ctx.db.patch(row._id, { nextNonce: nonce + 1 });
    return nonce;
  },
});

/**
 * Upsert the nonce counter to a specific value.
 */
export const resetNonce = internalMutation({
  args: { walletAddress: v.string(), nonce: v.number() },
  handler: async (ctx, { walletAddress, nonce }) => {
    const addr = walletAddress.toLowerCase();
    const row = await ctx.db
      .query("nonceCounter")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", addr))
      .unique();

    if (row) {
      await ctx.db.patch(row._id, {
        nextNonce: nonce,
        lastSyncedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("nonceCounter", {
        walletAddress: addr,
        nextNonce: nonce,
        lastSyncedAt: Date.now(),
      });
    }
  },
});

/**
 * Read the current nonce counter row for a wallet.
 */
export const getNonceRow = internalQuery({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    const addr = walletAddress.toLowerCase();
    return await ctx.db
      .query("nonceCounter")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", addr))
      .unique();
  },
});

/**
 * Fetch the on-chain nonce and reset the DB counter to match.
 */
export const syncFromChain = internalAction({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    const rpcUrl = process.env.MORPH_HOODI_RPC_URL;
    if (!rpcUrl) throw new Error("Missing MORPH_HOODI_RPC_URL");

    const { createPublicClient, http, defineChain } = await import("viem");

    const morphHoodi = defineChain({
      id: 2910,
      name: "Morph Hoodi Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
      testnet: true,
    });

    const publicClient = createPublicClient({
      chain: morphHoodi,
      transport: http(rpcUrl),
    });

    const onChainNonce = await publicClient.getTransactionCount({
      address: walletAddress as `0x${string}`,
      blockTag: "pending",
    });

    await ctx.runMutation(internal.nonce.resetNonce, {
      walletAddress,
      nonce: onChainNonce,
    });

    return onChainNonce;
  },
});

/**
 * Safety-net cron: sync DB nonce counter with on-chain state.
 * - If on-chain nonce > DB counter → bump DB (txs landed that we lost track of)
 * - If DB counter > on-chain nonce + 5 → likely crashed reservations, reset to chain
 * - Otherwise leave it alone (in-flight txs have reserved higher nonces)
 */
export const periodicSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const agentKey = process.env.AGENT_PRIVATE_KEY;
    const rpcUrl = process.env.MORPH_HOODI_RPC_URL;
    if (!agentKey || !rpcUrl) return;

    const { privateKeyToAccount } = await import("viem/accounts");
    const { createPublicClient, http, defineChain } = await import("viem");

    const account = privateKeyToAccount(agentKey as `0x${string}`);
    const walletAddress = account.address;

    const morphHoodi = defineChain({
      id: 2910,
      name: "Morph Hoodi Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
      testnet: true,
    });

    const publicClient = createPublicClient({
      chain: morphHoodi,
      transport: http(rpcUrl),
    });

    const onChainNonce = await publicClient.getTransactionCount({
      address: walletAddress,
      blockTag: "pending",
    });

    const row = await ctx.runQuery(internal.nonce.getNonceRow, {
      walletAddress,
    });

    if (!row) {
      // First time — initialize
      await ctx.runMutation(internal.nonce.resetNonce, {
        walletAddress,
        nonce: onChainNonce,
      });
      return;
    }

    if (onChainNonce > row.nextNonce) {
      // Chain advanced past our counter (manual txs or lost tracking)
      await ctx.runMutation(internal.nonce.resetNonce, {
        walletAddress,
        nonce: onChainNonce,
      });
    } else if (row.nextNonce > onChainNonce + 5) {
      // Large gap — likely crashed reservations that never sent. Reset.
      console.warn(
        `[nonce.periodicSync] Nonce gap detected: DB=${row.nextNonce}, chain=${onChainNonce}. Resetting.`,
      );
      await ctx.runMutation(internal.nonce.resetNonce, {
        walletAddress,
        nonce: onChainNonce,
      });
    }
  },
});
