import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { CronExpressionParser } from "cron-parser";

function nextCronRunAt(cronExpr: string): number {
  const interval = CronExpressionParser.parse(cronExpr, { currentDate: new Date() });
  return interval.next().toDate().getTime();
}

function nextScheduleRunAt(schedule: { kind: string; value: string }): number {
  const now = new Date();

  // Handle monthly — value is the day of month, e.g. "1" or "15"
  if (schedule.kind === "monthly") {
    const dayOfMonth = parseInt(schedule.value) || 1;
    const next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (next.getTime() <= now.getTime()) {
      next.setMonth(next.getMonth() + 1);
    }
    return next.getTime();
  }

  // Handle weekly — value is day name, e.g. "Monday"
  if (schedule.kind === "weekly") {
    const dayNames: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const targetDay = dayNames[schedule.value.toLowerCase()] ?? 1;
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(0, 0, 0, 0);
    return next.getTime();
  }

  // Handle cron expression with validation
  if (schedule.kind === "cron") {
    try {
      return nextCronRunAt(schedule.value);
    } catch {
      // If the cron expression is invalid, try to interpret the value as a
      // day-of-month (GPT sometimes returns kind:"cron" with just a number)
      const parsed = parseInt(schedule.value);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 31) {
        const next = new Date(now.getFullYear(), now.getMonth(), parsed);
        if (next.getTime() <= now.getTime()) {
          next.setMonth(next.getMonth() + 1);
        }
        return next.getTime();
      }
    }
  }

  // Fallback
  return Date.now() + 24 * 60 * 60 * 1000;
}

export const createFromIntent = mutation({
  args: {
    privyId: v.string(),
    recipientName: v.string(),
    recipientEmail: v.string(),
    recipientHint: v.optional(v.string()),
    kind: v.union(v.literal("recurring"), v.literal("conditional"), v.literal("oneShot")),
    amountUsdc: v.number(),
    token: v.optional(v.string()),
    schedule: v.optional(v.object({
      kind: v.union(v.literal("monthly"), v.literal("weekly"), v.literal("cron")),
      value: v.string(),
    })),
    condition: v.optional(v.object({
      walletBelowUsdc: v.number(),
      topUpUsdc: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId))
      .unique();
    if (!user) throw new Error("User not found");

    // Find or create recipient by name + owner (case-insensitive)
    const allRecipients = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    const nameLower = args.recipientName.toLowerCase();
    let recipient = allRecipients.find(
      (r) => r.displayName.toLowerCase() === nameLower ||
        (r.relationship && r.relationship.toLowerCase() === nameLower),
    ) ?? null;

    // Check if the recipient email belongs to an existing Echo user (already has a wallet)
    const existingUsers = await ctx.db.query("users").collect();
    const matchingUser = existingUsers.find(
      (u) => u.email && u.email.toLowerCase() === args.recipientEmail.toLowerCase(),
    );
    const recipientWallet = matchingUser?.walletAddress;

    if (!recipient) {
      const recipientId = await ctx.db.insert("recipients", {
        ownerId: user._id,
        displayName: args.recipientName,
        contactEmail: args.recipientEmail,
        relationship: args.recipientHint,
        walletAddress: recipientWallet,
      });
      recipient = (await ctx.db.get(recipientId))!;
    } else {
      await ctx.db.patch(recipient._id, {
        contactEmail: args.recipientEmail,
        ...(recipientWallet && !recipient.walletAddress ? { walletAddress: recipientWallet } : {}),
        ...(!recipient.relationship && args.recipientHint ? { relationship: args.recipientHint } : {}),
      });
      // Re-read to get updated fields
      recipient = (await ctx.db.get(recipient._id))!;
    }

    // Compute nextRunAt for scheduled rules (not for one-shot — those fire immediately)
    let nextRunAt: number | undefined;
    if (args.kind === "recurring" && args.schedule) {
      nextRunAt = nextScheduleRunAt(args.schedule);
    }

    const ruleId = await ctx.db.insert("rules", {
      ownerId: user._id,
      recipientId: recipient._id,
      kind: args.kind,
      amountUsdc: args.amountUsdc,
      token: args.token ?? "USDC",
      schedule: args.schedule,
      condition: args.condition,
      // One-shot = "pending" (fired immediately, cron ignores it)
      // Recurring/conditional = "active" (cron picks them up)
      status: args.kind === "oneShot" ? "pending" : "active",
      nextRunAt,
    });

    // For one-shot rules, fire the payment immediately (don't wait for cron)
    if (args.kind === "oneShot") {
      await ctx.scheduler.runAfter(0, internal.executePayment.executePayment, {
        ruleId,
      });
    }

    return { ruleId, recipientName: recipient.displayName };
  },
});

export const attachVoiceMessage = mutation({
  args: {
    ruleId: v.id("rules"),
    voiceMessageId: v.id("voiceMessages"),
  },
  handler: async (ctx, { ruleId, voiceMessageId }) => {
    await ctx.db.patch(ruleId, { voiceMessageId });
  },
});

export const getInternal = internalQuery({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule) return null;
    const recipient = await ctx.db.get(rule.recipientId);
    const owner = await ctx.db.get(rule.ownerId);
    return {
      ...rule,
      recipientName: recipient?.displayName ?? "Unknown",
      recipientEmail: recipient?.contactEmail ?? null,
      recipientWalletAddress: recipient?.walletAddress ?? null,
      ownerName: owner?.displayName ?? owner?.email ?? "Someone",
      token: rule.token ?? "USDC",
    };
  },
});

export const cancel = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule) throw new Error("Rule not found");
    await ctx.db.patch(ruleId, { status: "cancelled" });
  },
});

export const pause = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule) throw new Error("Rule not found");
    await ctx.db.patch(ruleId, { status: "paused" });
  },
});

export const resume = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule) throw new Error("Rule not found");
    const nextRunAt = rule.schedule
      ? nextScheduleRunAt(rule.schedule)
      : Date.now() + 24 * 60 * 60 * 1000;
    await ctx.db.patch(ruleId, { status: "active", nextRunAt });
  },
});

export const markCompleted = internalMutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    await ctx.db.patch(ruleId, { status: "completed" });
  },
});

export const markCancelled = internalMutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    await ctx.db.patch(ruleId, { status: "cancelled" });
  },
});

export const advanceNextRun = internalMutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.db.get(ruleId);
    if (!rule || rule.kind !== "recurring") return;

    const nextRunAt = rule.schedule
      ? nextScheduleRunAt(rule.schedule)
      : Date.now() + 24 * 60 * 60 * 1000;

    await ctx.db.patch(ruleId, { nextRunAt });
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

    const rules = await ctx.db
      .query("rules")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    // Attach recipient names, emails, and voice message audio URLs
    return Promise.all(
      rules.map(async (rule) => {
        const recipient = await ctx.db.get(rule.recipientId);
        let voiceMessageUrl: string | null = null;
        let voiceMessageDuration: number | null = null;
        if (rule.voiceMessageId) {
          const vm = await ctx.db.get(rule.voiceMessageId);
          if (vm) {
            voiceMessageUrl = await ctx.storage.getUrl(vm.storageId);
            voiceMessageDuration = vm.durationSec;
          }
        }
        return {
          ...rule,
          recipientName: recipient?.displayName ?? "Unknown",
          recipientEmail: recipient?.contactEmail ?? null,
          voiceMessageUrl,
          voiceMessageDuration,
        };
      }),
    );
  },
});
