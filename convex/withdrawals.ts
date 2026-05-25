import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { serverNow } from "./serverTime";

export const create = mutation({
  args: {
    privyId: v.string(),
    token: v.string(),
    tokenAmount: v.number(),
    fiatAmount: v.number(),
    fiatCurrency: v.string(),
    country: v.string(),
    destinationType: v.union(v.literal("ewallet"), v.literal("bank")),
    destinationName: v.string(),
    accountIdentifier: v.string(),
    referenceNumber: v.string(),
    fee: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();
    if (!user) throw new Error("User not found");

    return await ctx.db.insert("withdrawals", {
      ownerId: user._id,
      token: args.token,
      tokenAmount: args.tokenAmount,
      fiatAmount: args.fiatAmount,
      fiatCurrency: args.fiatCurrency,
      country: args.country,
      destinationType: args.destinationType,
      destinationName: args.destinationName,
      accountIdentifier: args.accountIdentifier,
      referenceNumber: args.referenceNumber,
      fee: args.fee,
      status: "processing",
    });
  },
});

export const markSuccess = mutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    txHash: v.string(),
  },
  handler: async (ctx, { withdrawalId, txHash }) => {
    await ctx.db.patch(withdrawalId, {
      status: "success",
      txHash,
      executedAt: serverNow(),
    });
  },
});

export const markFailed = mutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    error: v.string(),
  },
  handler: async (ctx, { withdrawalId, error }) => {
    await ctx.db.patch(withdrawalId, {
      status: "failed",
      error,
      executedAt: serverNow(),
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

    return await ctx.db
      .query("withdrawals")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
  },
});
