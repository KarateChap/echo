import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { serverNow } from "./serverTime";

export const recordSuccess = internalMutation({
  args: {
    ruleId: v.id("rules"),
    ownerId: v.id("users"),
    recipientId: v.id("recipients"),
    amountUsdc: v.number(),
    token: v.optional(v.string()),
    txHash: v.string(),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    hasRecipientEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("transactions", {
      ownerId: args.ownerId,
      ruleId: args.ruleId,
      recipientId: args.recipientId,
      amountUsdc: args.amountUsdc,
      token: args.token,
      txHash: args.txHash,
      status: "success",
      voiceMessageId: args.voiceMessageId,
      executedAt: serverNow(),
      notificationStatus: args.hasRecipientEmail ? "pending" : "skipped",
    });
  },
});

export const markNotificationSent = internalMutation({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    await ctx.db.patch(transactionId, { notificationStatus: "sent" });
  },
});

export const markNotificationFailed = internalMutation({
  args: { transactionId: v.id("transactions"), error: v.string() },
  handler: async (ctx, { transactionId, error }) => {
    await ctx.db.patch(transactionId, { notificationStatus: "failed", notificationError: error });
  },
});

export const getPendingNotifications = internalQuery({
  args: {},
  handler: async (ctx) => {
    const fiveMinAgo = serverNow() - 5 * 60 * 1000;
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_notificationStatus", (q) => q.eq("notificationStatus", "pending"))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "success"),
          q.lte(q.field("executedAt"), fiveMinAgo),
        ),
      )
      .collect();
    return txs;
  },
});

export const recordRefund = internalMutation({
  args: {
    ruleId: v.id("rules"),
    ownerId: v.id("users"),
    recipientId: v.id("recipients"),
    amountUsdc: v.number(),
    token: v.optional(v.string()),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("transactions", {
      ownerId: args.ownerId,
      ruleId: args.ruleId,
      recipientId: args.recipientId,
      amountUsdc: args.amountUsdc,
      token: args.token,
      txHash: args.txHash,
      status: "success",
      executedAt: serverNow(),
      error: "REFUND",
      notificationStatus: "skipped",
    });
  },
});

export const recordFailure = internalMutation({
  args: {
    ruleId: v.id("rules"),
    error: v.string(),
  },
  handler: async (ctx, { ruleId, error }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule) return;

    await ctx.db.insert("transactions", {
      ownerId: rule.ownerId,
      ruleId,
      recipientId: rule.recipientId,
      amountUsdc: rule.amountUsdc,
      token: rule.token,
      status: "failed",
      error,
      executedAt: serverNow(),
    });
  },
});

// Helper: find recipient IDs that belong to this user (as a receiver)
async function getMyRecipientIds(
  ctx: { db: QueryCtx["db"] },
  user: { _id: Id<"users">; email?: string; walletAddress?: string },
) {
  const recipientsByEmail = user.email
    ? await ctx.db
        .query("recipients")
        .withIndex("by_contactEmail", (q) => q.eq("contactEmail", user.email!.toLowerCase()))
        .collect()
    : [];
  const recipientsByWallet = user.walletAddress
    ? await ctx.db
        .query("recipients")
        .withIndex("by_walletAddress", (q) => q.eq("walletAddress", user.walletAddress!.toLowerCase()))
        .collect()
    : [];
  const idSet = new Set(
    [...recipientsByEmail, ...recipientsByWallet].map((r) => r._id),
  );
  return [...idSet];
}

export const listByUser = query({
  args: { privyId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { privyId, limit }) => {
    const cap = limit ?? 50;
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) return [];

    // Transactions the user SENT
    const sent = await ctx.db
      .query("transactions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();

    // Transactions the user RECEIVED — indexed lookups instead of full table scans
    const myRecipientIds = await getMyRecipientIds(ctx, user);

    const received: typeof sent = [];
    for (const rid of myRecipientIds) {
      const txs = await ctx.db
        .query("transactions")
        .withIndex("by_recipientId", (q) => q.eq("recipientId", rid))
        .order("desc")
        .collect();
      for (const tx of txs) {
        if (tx.ownerId !== user._id && tx.error !== "REFUND") {
          received.push(tx);
        }
      }
    }

    // Merge and deduplicate
    const allTxs = [...sent, ...received];
    const seen = new Set<string>();
    const unique = allTxs.filter((tx) => {
      if (seen.has(tx._id)) return false;
      seen.add(tx._id);
      return true;
    });
    unique.sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0));

    // Cap before enrichment to avoid unnecessary DB reads
    const capped = unique.slice(0, cap);

    // Batch-fetch all related docs to avoid N+1
    const recipientIds = [...new Set(capped.map((tx) => tx.recipientId))];
    const ownerIds = [...new Set(capped.map((tx) => tx.ownerId))];
    const ruleIds = [...new Set(capped.map((tx) => tx.ruleId).filter(Boolean))] as Id<"rules">[];

    const [recipientDocs, ownerDocs, ruleDocs] = await Promise.all([
      Promise.all(recipientIds.map((id) => ctx.db.get(id))),
      Promise.all(ownerIds.map((id) => ctx.db.get(id))),
      Promise.all(ruleIds.map((id) => ctx.db.get(id))),
    ]);

    const recipientMap = new Map(recipientIds.map((id, i) => [id as string, recipientDocs[i]]));
    const ownerMap = new Map(ownerIds.map((id, i) => [id as string, ownerDocs[i]]));
    const ruleMap = new Map(ruleIds.map((id, i) => [id as string, ruleDocs[i]]));

    // Batch-fetch voice messages
    const vmIds = [...new Set(capped.map((tx) => {
      const rule = tx.ruleId ? ruleMap.get(tx.ruleId) : null;
      return tx.voiceMessageId ?? rule?.voiceMessageId;
    }).filter(Boolean))];
    const vmDocs = await Promise.all(vmIds.map((id) => ctx.db.get(id!)));
    const vmMap = new Map(vmIds.map((id, i) => [id!, vmDocs[i]]));

    const txItems = await Promise.all(
      capped.map(async (tx) => {
        const recipient = recipientMap.get(tx.recipientId);
        const sender = ownerMap.get(tx.ownerId);
        const isSender = tx.ownerId === user._id;

        const rule = tx.ruleId ? ruleMap.get(tx.ruleId) : null;
        let voiceMessageUrl: string | null = null;
        const vmId = tx.voiceMessageId ?? rule?.voiceMessageId;
        if (vmId) {
          const vm = vmMap.get(vmId);
          if (vm) {
            voiceMessageUrl = await ctx.storage.getUrl(vm.storageId);
          }
        }

        const resolvedToken = tx.token ?? rule?.token;

        return {
          ...tx,
          _type: "transaction" as const,
          token: resolvedToken,
          recipientName: recipient?.displayName ?? "Unknown",
          senderName: sender?.displayName ?? sender?.email ?? "Someone",
          isSender,
          voiceMessageUrl,
        };
      }),
    );

    // Withdrawals
    const withdrawals = await ctx.db
      .query("withdrawals")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();

    const withdrawalItems = withdrawals.map((w) => ({
      ...w,
      _type: "withdrawal" as const,
      amountUsdc: w.tokenAmount,
      isSender: true,
      recipientName: w.destinationName,
      senderName: user.displayName ?? user.email ?? "You",
      voiceMessageUrl: null as string | null,
    }));

    // Merge and sort by timestamp
    const merged = [...txItems, ...withdrawalItems];
    merged.sort((a, b) => {
      const tsA = a.executedAt ?? a._creationTime;
      const tsB = b.executedAt ?? b._creationTime;
      return tsB - tsA;
    });

    return merged;
  },
});

export const countUnseenByUser = query({
  args: { privyId: v.string(), since: v.number() },
  handler: async (ctx, { privyId, since }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) return 0;

    // Count sent transactions newer than `since`
    const sent = await ctx.db
      .query("transactions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    let count = sent.filter((tx) => (tx.executedAt ?? tx._creationTime) > since).length;

    // Count received transactions newer than `since`
    const myRecipientIds = await getMyRecipientIds(ctx, user);
    for (const rid of myRecipientIds) {
      const txs = await ctx.db
        .query("transactions")
        .withIndex("by_recipientId", (q) => q.eq("recipientId", rid))
        .order("desc")
        .collect();
      for (const tx of txs) {
        if (
          tx.ownerId !== user._id &&
          tx.error !== "REFUND" &&
          (tx.executedAt ?? tx._creationTime) > since
        ) {
          count++;
        }
      }
    }

    // Count withdrawals
    const withdrawals = await ctx.db
      .query("withdrawals")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    count += withdrawals.filter((w) => (w.executedAt ?? w._creationTime) > since).length;

    return count;
  },
});
