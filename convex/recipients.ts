import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByOwner = query({
  args: { privyId: v.string() },
  handler: async (ctx, { privyId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) return [];
    const all = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    // Deduplicate by (displayName lowercase, contactEmail) — keep first occurrence
    const seen = new Set<string>();
    return all.filter((r) => {
      const key = `${r.displayName.toLowerCase()}|${(r.contactEmail ?? "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
});

export const findTrusted = query({
  args: {
    privyId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { privyId, name }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) return null;

    const allRecipients = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    const nameLower = name.toLowerCase();

    // Priority: exact displayName match first, then exact relationship match
    const match =
      allRecipients.find(
        (r) => r.displayName.toLowerCase() === nameLower && r.contactEmail,
      ) ??
      allRecipients.find(
        (r) =>
          r.relationship &&
          r.relationship.toLowerCase() === nameLower &&
          r.contactEmail,
      ) ??
      null;

    if (!match) return null;

    return {
      _id: match._id,
      displayName: match.displayName,
      contactEmail: match.contactEmail,
      relationship: match.relationship,
      walletAddress: match.walletAddress,
    };
  },
});

export const add = mutation({
  args: {
    privyId: v.string(),
    displayName: v.string(),
    contactEmail: v.optional(v.string()),
    relationship: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();
    if (!user) throw new Error("User not found");

    return await ctx.db.insert("recipients", {
      ownerId: user._id,
      displayName: args.displayName,
      contactEmail: args.contactEmail,
      relationship: args.relationship,
      walletAddress: args.walletAddress,
    });
  },
});

export const update = mutation({
  args: {
    recipientId: v.id("recipients"),
    displayName: v.string(),
    contactEmail: v.optional(v.string()),
    relationship: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
  },
  handler: async (ctx, { recipientId, ...fields }) => {
    const recipient = await ctx.db.get(recipientId);
    if (!recipient) throw new Error("Recipient not found");

    // Update all duplicate rows that share the same owner + name + email
    const siblings = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", recipient.ownerId))
      .collect();
    const nameLower = recipient.displayName.toLowerCase();
    const emailLower = (recipient.contactEmail ?? "").toLowerCase();
    for (const sib of siblings) {
      if (
        sib.displayName.toLowerCase() === nameLower &&
        (sib.contactEmail ?? "").toLowerCase() === emailLower
      ) {
        await ctx.db.patch(sib._id, fields);
      }
    }
  },
});

export const remove = mutation({
  args: { recipientId: v.id("recipients") },
  handler: async (ctx, { recipientId }) => {
    const recipient = await ctx.db.get(recipientId);
    if (!recipient) throw new Error("Recipient not found");

    // Delete all duplicate rows that share the same owner + name + email
    const siblings = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", recipient.ownerId))
      .collect();
    const nameLower = recipient.displayName.toLowerCase();
    const emailLower = (recipient.contactEmail ?? "").toLowerCase();
    for (const sib of siblings) {
      if (
        sib.displayName.toLowerCase() === nameLower &&
        (sib.contactEmail ?? "").toLowerCase() === emailLower
      ) {
        await ctx.db.delete(sib._id);
      }
    }
  },
});
