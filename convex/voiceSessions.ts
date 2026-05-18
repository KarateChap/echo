import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    privyId: v.string(),
    audioStorageId: v.id("_storage"),
  },
  handler: async (ctx, { privyId, audioStorageId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    return await ctx.db.insert("voiceSessions", {
      ownerId: user._id,
      audioStorageId,
      status: "transcribing",
    });
  },
});

export const get = query({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const audioUrl = session.audioStorageId
      ? await ctx.storage.getUrl(session.audioStorageId)
      : null;
    const readbackUrl = session.readbackStorageId
      ? await ctx.storage.getUrl(session.readbackStorageId)
      : null;
    return { ...session, audioUrl, readbackUrl };
  },
});
