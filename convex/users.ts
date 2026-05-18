import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsertUser = mutation({
  args: {
    privyId: v.string(),
    walletAddress: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        walletAddress: args.walletAddress,
        email: args.email,
        displayName: args.displayName,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      privyId: args.privyId,
      walletAddress: args.walletAddress,
      email: args.email,
      displayName: args.displayName,
    });
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
