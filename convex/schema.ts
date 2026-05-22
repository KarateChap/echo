import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    privyId: v.string(),
    walletAddress: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    voiceGender: v.optional(v.union(v.literal("female"), v.literal("male"))),
    lastSeenActivity: v.optional(v.number()),
    lastSeenRules: v.optional(v.number()),
  }).index("by_privyId", ["privyId"])
    .index("by_email", ["email"]),

  recipients: defineTable({
    ownerId: v.id("users"),
    displayName: v.string(),
    walletAddress: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    relationship: v.optional(v.string()),
  }).index("by_owner", ["ownerId"])
    .index("by_contactEmail", ["contactEmail"])
    .index("by_walletAddress", ["walletAddress"]),

  rules: defineTable({
    ownerId: v.id("users"),
    recipientId: v.id("recipients"),
    kind: v.union(v.literal("recurring"), v.literal("conditional"), v.literal("oneShot")),
    amountUsdc: v.number(),
    token: v.optional(v.string()), // "USDC" | "USDT" | "ETH" | "HTT" — enforced at application layer
    schedule: v.optional(v.object({
      kind: v.union(
        v.literal("monthly"), v.literal("weekly"), v.literal("daily"),
        v.literal("biweekly"), v.literal("cron"), v.literal("once"),
        v.literal("seconds"), v.literal("yearly"),
      ),
      value: v.string(),
    })),
    condition: v.optional(v.object({
      walletBelowUsdc: v.number(),
      topUpUsdc: v.number(),
      direction: v.optional(v.union(v.literal("below"), v.literal("above"))), // defaults to "below" if unset
    })),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("paused"), v.literal("cancelled"), v.literal("completed"), v.literal("awaitingRecipient")),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    fundingTxHash: v.optional(v.string()), // legacy custodial path
    delegationTxHash: v.optional(v.string()), // EIP-7702 delegation tx
    ownerWalletAddress: v.optional(v.string()), // user's EOA for 7702 executeTransfer
    revocationTxHash: v.optional(v.string()), // on-chain revocation tx
    nextRunAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    totalOccurrences: v.optional(v.number()),
    totalFunded: v.optional(v.number()), // legacy custodial path
    executionCount: v.optional(v.number()),
    conditionArmed: v.optional(v.boolean()), // conditional rules: true once the condition has been observed as NOT met, preventing immediate firing
  })
    .index("by_owner", ["ownerId"])
    .index("by_status_and_next_run", ["status", "nextRunAt"])
    .index("by_recipient_and_status", ["recipientId", "status"]),

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
    .index("by_rule", ["ruleId"])
    .index("by_recipientId", ["recipientId"]),

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
  }).index("by_token", ["token"])
    .index("by_ruleId", ["ruleId"]),

  chatSessions: defineTable({
    ownerId: v.id("users"),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      timestamp: v.number(),
    })),
    status: v.union(v.literal("active"), v.literal("closed")),
  }).index("by_owner", ["ownerId"]),

  withdrawals: defineTable({
    ownerId: v.id("users"),
    token: v.string(),
    tokenAmount: v.number(),
    fiatAmount: v.number(),
    fiatCurrency: v.string(),
    country: v.string(),
    destinationType: v.union(v.literal("ewallet"), v.literal("bank")),
    destinationName: v.string(),
    accountIdentifier: v.string(),
    txHash: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("success"), v.literal("failed")),
    referenceNumber: v.string(),
    fee: v.number(),
    executedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  voiceSessions: defineTable({
    ownerId: v.id("users"),
    selectedToken: v.optional(v.string()), // token the user tapped in the UI
    audioStorageId: v.optional(v.id("_storage")),
    transcript: v.optional(v.string()),
    intent: v.optional(v.string()),
    readbackStorageId: v.optional(v.id("_storage")),
    readbackText: v.optional(v.string()),
    preTranscript: v.optional(v.string()),
    detectedLanguage: v.optional(v.string()),
    speculativeParseDone: v.optional(v.boolean()),
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
