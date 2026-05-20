import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const add = mutation({
  args: {
    privyId: v.string(),
    symbol: v.string(),
    name: v.string(),
    address: v.string(),
    decimals: v.number(),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();
    if (!user) throw new Error("User not found");

    // Check if already added
    const existing = await ctx.db
      .query("customTokens")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    if (existing.some((t) => t.address.toLowerCase() === args.address.toLowerCase())) {
      throw new Error("Token already added");
    }

    return await ctx.db.insert("customTokens", {
      ownerId: user._id,
      symbol: args.symbol,
      name: args.name,
      address: args.address,
      decimals: args.decimals,
      icon: args.icon ?? "🔷",
    });
  },
});

export const remove = mutation({
  args: {
    tokenId: v.id("customTokens"),
  },
  handler: async (ctx, { tokenId }) => {
    await ctx.db.delete(tokenId);
  },
});

export const getByOwnerAndSymbol = internalQuery({
  args: {
    ownerId: v.id("users"),
    symbol: v.string(),
  },
  handler: async (ctx, { ownerId, symbol }) => {
    const tokens = await ctx.db
      .query("customTokens")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return tokens.find((t) => t.symbol === symbol) ?? null;
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

    return await ctx.db
      .query("customTokens")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
  },
});
