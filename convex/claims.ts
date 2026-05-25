import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { serverNow } from "./serverTime";

export const createClaimToken = internalMutation({
  args: {
    ruleId: v.id("rules"),
    recipientId: v.id("recipients"),
    senderName: v.string(),
    recipientEmail: v.string(),
    amountUsdc: v.number(),
    cryptoToken: v.optional(v.string()),
    voiceMessageId: v.optional(v.id("voiceMessages")),
  },
  handler: async (ctx, args) => {
    const token = btoa(`${args.ruleId}:${serverNow()}`)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    await ctx.db.insert("claims", {
      token,
      cryptoToken: args.cryptoToken,
      ruleId: args.ruleId,
      recipientId: args.recipientId,
      senderName: args.senderName,
      recipientEmail: args.recipientEmail,
      amountUsdc: args.amountUsdc,
      voiceMessageId: args.voiceMessageId,
      claimed: false,
      createdAt: serverNow(),
    });

    return token;
  },
});

export const hasClaimForRule = internalQuery({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const existing = await ctx.db
      .query("claims")
      .withIndex("by_ruleId", (q) => q.eq("ruleId", ruleId))
      .first();
    return !!existing;
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const claim = await ctx.db
      .query("claims")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!claim) return null;

    let voiceMessageUrl: string | null = null;
    if (claim.voiceMessageId) {
      const vm = await ctx.db.get(claim.voiceMessageId);
      if (vm) {
        voiceMessageUrl = await ctx.storage.getUrl(vm.storageId);
      }
    }

    return { ...claim, voiceMessageUrl };
  },
});

export const markClaimed = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const claim = await ctx.db
      .query("claims")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (claim) {
      await ctx.db.patch(claim._id, { claimed: true, claimedAt: serverNow() });
    }
  },
});
