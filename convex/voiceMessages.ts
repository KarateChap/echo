import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    privyId: v.string(),
    ruleId: v.id("rules"),
    storageId: v.id("_storage"),
    durationSec: v.number(),
  },
  handler: async (ctx, { privyId, ruleId, storageId, durationSec }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    const voiceMessageId = await ctx.db.insert("voiceMessages", {
      ownerId: user._id,
      ruleId,
      storageId,
      durationSec,
    });

    // Attach to the rule
    await ctx.db.patch(ruleId, { voiceMessageId });

    return voiceMessageId;
  },
});

export const updateVoiceMessage = mutation({
  args: {
    privyId: v.string(),
    ruleId: v.id("rules"),
    storageId: v.id("_storage"),
    durationSec: v.number(),
  },
  handler: async (ctx, { privyId, ruleId, storageId, durationSec }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    const rule = await ctx.db.get(ruleId);
    if (!rule) throw new Error("Rule not found");

    if (rule.voiceMessageId) {
      // Update existing voice message and clean up old storage
      const existing = await ctx.db.get(rule.voiceMessageId);
      if (existing) {
        await ctx.storage.delete(existing.storageId);
        await ctx.db.patch(rule.voiceMessageId, { storageId, durationSec });
        return rule.voiceMessageId;
      }
    }

    // No existing message — create a new one
    const voiceMessageId = await ctx.db.insert("voiceMessages", {
      ownerId: user._id,
      ruleId,
      storageId,
      durationSec,
    });
    await ctx.db.patch(ruleId, { voiceMessageId });
    return voiceMessageId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
