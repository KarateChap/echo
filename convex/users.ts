import { mutation, query, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

async function linkWalletToRecipients(ctx: MutationCtx, email: string, walletAddress: string) {
  const recipients = await ctx.db.query("recipients").collect();
  for (const r of recipients) {
    if (r.contactEmail?.toLowerCase() === email.toLowerCase() && !r.walletAddress) {
      await ctx.db.patch(r._id, { walletAddress });

      // Find rules waiting on this recipient and trigger them
      const awaitingRules = await ctx.db
        .query("rules")
        .withIndex("by_recipient_and_status", (q) =>
          q.eq("recipientId", r._id).eq("status", "awaitingRecipient")
        )
        .collect();

      for (const rule of awaitingRules) {
        await ctx.db.patch(rule._id, {
          status: rule.kind === "oneShot" ? "pending" : "active",
        });
        await ctx.scheduler.runAfter(0, internal.executePayment.executePayment, {
          ruleId: rule._id,
        });
      }
    }
  }
}

export const upsertUser = mutation({
  args: {
    privyId: v.string(),
    walletAddress: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Look up by privyId first, then fall back to email (Privy may assign
    // different IDs across devices for the same email account)
    let existing = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();

    if (!existing && args.email) {
      existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first();
    }

    if (existing) {
      const patch: Record<string, unknown> = {
        privyId: args.privyId,
        email: args.email,
        displayName: args.displayName,
      };
      if (args.walletAddress && !existing.walletAddress) {
        patch.walletAddress = args.walletAddress;
      }
      await ctx.db.patch(existing._id, patch);
      // Link wallet to any recipient rows matching this email
      if (args.email && (args.walletAddress ?? existing.walletAddress)) {
        await linkWalletToRecipients(ctx, args.email, (args.walletAddress ?? existing.walletAddress)!);
      }
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      privyId: args.privyId,
      walletAddress: args.walletAddress,
      email: args.email,
      displayName: args.displayName,
    });

    // Link wallet to any recipient rows matching this email
    if (args.email && args.walletAddress) {
      await linkWalletToRecipients(ctx, args.email, args.walletAddress);
    }

    return userId;
  },
});

export const getInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

export const updateVoiceGender = mutation({
  args: {
    privyId: v.string(),
    voiceGender: v.union(v.literal("female"), v.literal("male")),
  },
  handler: async (ctx, { privyId, voiceGender }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");
    await ctx.db.patch(user._id, { voiceGender });
  },
});

export const markSectionSeen = mutation({
  args: {
    privyId: v.string(),
    section: v.union(v.literal("activity"), v.literal("rules")),
  },
  handler: async (ctx, { privyId, section }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");
    const field = section === "activity" ? "lastSeenActivity" : "lastSeenRules";
    await ctx.db.patch(user._id, { [field]: Date.now() });
  },
});

export const getByPrivyId = query({
  args: { privyId: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { privyId, email }) => {
    const byPrivy = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (byPrivy) return byPrivy;

    // Fallback: Privy may assign different IDs across devices
    if (email) {
      return await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    }
    return null;
  },
});
