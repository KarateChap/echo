import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

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
      executedAt: Date.now(),
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
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const txs = await ctx.db
      .query("transactions")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "success"),
          q.eq(q.field("notificationStatus"), "pending"),
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
      executedAt: Date.now(),
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
      executedAt: Date.now(),
    });
  },
});

export const listByUser = query({
  args: { privyId: v.string() },
  handler: async (ctx, { privyId }) => {
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

    // Transactions the user RECEIVED — find recipients matching this user's email/wallet
    const allRecipients = await ctx.db.query("recipients").collect();
    const myRecipientIds = allRecipients
      .filter((r) =>
        (user.email && r.contactEmail?.toLowerCase() === user.email.toLowerCase()) ||
        (user.walletAddress && r.walletAddress?.toLowerCase() === user.walletAddress.toLowerCase()),
      )
      .map((r) => r._id);

    let received: typeof sent = [];
    if (myRecipientIds.length > 0) {
      const allTxs = await ctx.db.query("transactions").order("desc").collect();
      received = allTxs.filter(
        (tx) => myRecipientIds.some((id) => id === tx.recipientId) && tx.ownerId !== user._id && tx.error !== "REFUND",
      );
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

    const txItems = await Promise.all(
      unique.map(async (tx) => {
        const recipient = await ctx.db.get(tx.recipientId);
        const sender = await ctx.db.get(tx.ownerId);
        const isSender = tx.ownerId === user._id;

        // Get voice message URL and token — check tx first, then fall back to the rule
        const rule = tx.ruleId ? await ctx.db.get(tx.ruleId) : null;
        let voiceMessageUrl: string | null = null;
        const vmId = tx.voiceMessageId ?? rule?.voiceMessageId;
        if (vmId) {
          const vm = await ctx.db.get(vmId);
          if (vm) {
            voiceMessageUrl = await ctx.storage.getUrl(vm.storageId);
          }
        }

        // Resolve token: prefer tx.token, fall back to the linked rule's token
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
