import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    privyId: v.string(),
    walletAddress: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
  }).index("by_privyId", ["privyId"]),

  recipients: defineTable({
    ownerId: v.id("users"),
    displayName: v.string(),
    walletAddress: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    relationship: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  rules: defineTable({
    ownerId: v.id("users"),
    recipientId: v.id("recipients"),
    kind: v.union(v.literal("recurring"), v.literal("conditional"), v.literal("oneShot")),
    amountUsdc: v.number(),
    token: v.optional(v.string()), // "USDC" | "USDT" | "ETH" | "HTT", defaults to USDC
    schedule: v.optional(v.object({
      kind: v.union(
        v.literal("monthly"), v.literal("weekly"), v.literal("daily"),
        v.literal("biweekly"), v.literal("cron"), v.literal("once"),
      ),
      value: v.string(),
    })),
    condition: v.optional(v.object({
      walletBelowUsdc: v.number(),
      topUpUsdc: v.number(),
    })),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("paused"), v.literal("cancelled"), v.literal("completed")),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    nextRunAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status_and_next_run", ["status", "nextRunAt"]),

  voiceMessages: defineTable({
    ownerId: v.id("users"),
    ruleId: v.optional(v.id("rules")),
    transactionId: v.optional(v.id("transactions")),
    storageId: v.id("_storage"),
    durationSec: v.number(),
    transcript: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  transactions: defineTable({
    ownerId: v.id("users"),
    ruleId: v.optional(v.id("rules")),
    recipientId: v.id("recipients"),
    amountUsdc: v.number(),
    token: v.optional(v.string()),
    txHash: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("submitted"), v.literal("success"), v.literal("failed")),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    executedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    notificationStatus: v.optional(v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("skipped"))),
    notificationError: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_rule", ["ruleId"]),

  customTokens: defineTable({
    ownerId: v.id("users"),
    symbol: v.string(),
    name: v.string(),
    address: v.string(),
    decimals: v.number(),
    icon: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  claims: defineTable({
    token: v.string(),
    cryptoToken: v.optional(v.string()), // "USDC" | "USDT" | "ETH" | "HTT"
    ruleId: v.id("rules"),
    recipientId: v.id("recipients"),
    senderName: v.string(),
    recipientEmail: v.string(),
    amountUsdc: v.number(),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    claimed: v.boolean(),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  voiceSessions: defineTable({
    ownerId: v.id("users"),
    selectedToken: v.optional(v.string()), // token the user tapped in the UI
    audioStorageId: v.optional(v.id("_storage")),
    transcript: v.optional(v.string()),
    intent: v.optional(v.string()),
    readbackStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("recording"),
      v.literal("transcribing"),
      v.literal("parsing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),
});
