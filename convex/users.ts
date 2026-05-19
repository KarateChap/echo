import { mutation, query, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

async function linkWalletToRecipients(ctx: MutationCtx, email: string, walletAddress: string) {
  const recipients = await ctx.db.query("recipients").collect();
  for (const r of recipients) {
    if (r.contactEmail?.toLowerCase() === email.toLowerCase() && !r.walletAddress) {
      await ctx.db.patch(r._id, { walletAddress });
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
    const existing = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();

    if (existing) {
      // Only overwrite walletAddress if a new one is provided
      const patch: Record<string, unknown> = {
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

export const getByPrivyId = query({
  args: { privyId: v.string() },
  handler: async (ctx, { privyId }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
  },
});
