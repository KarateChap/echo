import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { CronExpressionParser } from "cron-parser";

function nextCronRunAt(cronExpr: string): number {
  const interval = CronExpressionParser.parse(cronExpr, { currentDate: new Date() });
  return interval.next().toDate().getTime();
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function nextScheduleRunAt(schedule: { kind: string; value: string }): number {
  const now = new Date();

  // Handle monthly — value is the day of month, e.g. "1", "15", or "last"
  if (schedule.kind === "monthly") {
    if (schedule.value === "last") {
      // Last day of the current month; if already past, last day of next month
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      lastDay.setHours(9, 0, 0, 0);
      if (lastDay.getTime() <= now.getTime()) {
        const nextMonthLast = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        nextMonthLast.setHours(9, 0, 0, 0);
        return nextMonthLast.getTime();
      }
      return lastDay.getTime();
    }
    const dayOfMonth = parseInt(schedule.value) || 1;
    const next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, 9, 0, 0, 0);
    // If the day rolled over (e.g. Feb 30 → Mar 2), skip to next valid month
    if (next.getDate() !== dayOfMonth) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(dayOfMonth);
    }
    if (next.getTime() <= now.getTime()) {
      next.setMonth(next.getMonth() + 1);
    }
    return next.getTime();
  }

  // Handle weekly — value is day name, e.g. "Monday"
  if (schedule.kind === "weekly") {
    const targetDay = DAY_NAMES[schedule.value.toLowerCase()] ?? 1;
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }

  // Handle daily — value is time in HH:MM format, e.g. "09:00"
  if (schedule.kind === "daily") {
    const [hours, minutes] = (schedule.value || "09:00").split(":").map(Number);
    const next = new Date(now);
    next.setHours(hours || 9, minutes || 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  // Handle biweekly — value is day name; first run is next occurrence of that day
  if (schedule.kind === "biweekly") {
    const targetDay = DAY_NAMES[schedule.value.toLowerCase()] ?? 5; // default Friday
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }

  // Handle once — value is ISO date "YYYY-MM-DD" for a future one-shot
  if (schedule.kind === "once") {
    const target = new Date(schedule.value + "T09:00:00");
    return target.getTime();
  }

  // Handle cron expression with validation
  if (schedule.kind === "cron") {
    try {
      return nextCronRunAt(schedule.value);
    } catch (e) {
      console.error("Invalid cron expression:", schedule.value, e);
      // If the cron expression is invalid, try to interpret the value as a
      // day-of-month (GPT sometimes returns kind:"cron" with just a number)
      const parsed = parseInt(schedule.value);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 31) {
        const next = new Date(now.getFullYear(), now.getMonth(), parsed, 9, 0, 0, 0);
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

    // Compute nextRunAt and status based on kind + schedule
    let nextRunAt: number | undefined;
    let status: "pending" | "active";

    const isFutureOneShot = args.kind === "oneShot" && args.schedule?.kind === "once";

    if (isFutureOneShot && args.schedule) {
      // Future-dated one-shot: let cron pick it up at the scheduled time
      nextRunAt = nextScheduleRunAt(args.schedule);
      status = "active";
    } else if (args.kind === "oneShot") {
      // Immediate one-shot: fire right away
      status = "pending";
    } else if (args.schedule) {
      // Recurring/conditional with schedule
      nextRunAt = nextScheduleRunAt(args.schedule);
      status = "active";
    } else {
      // Conditional without schedule, or fallback
      status = "active";
    }

    const ruleId = await ctx.db.insert("rules", {
      ownerId: user._id,
      recipientId: recipient._id,
      kind: args.kind,
      amountUsdc: args.amountUsdc,
      token: args.token ?? "USDC",
      schedule: args.schedule,
      condition: args.condition,
      status,
      nextRunAt,
    });

    // For immediate one-shot rules, fire the payment now (don't wait for cron)
    if (args.kind === "oneShot" && !isFutureOneShot) {
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
    if (!rule) return;

    // Future one-shots and non-recurring rules should be marked completed, not advanced
    if (rule.kind !== "recurring") return;

    let nextRunAt: number;
    if (rule.schedule?.kind === "biweekly" && rule.nextRunAt) {
      // Biweekly: add exactly 14 days from the last scheduled time
      nextRunAt = rule.nextRunAt + 14 * 24 * 60 * 60 * 1000;
    } else if (rule.schedule) {
      nextRunAt = nextScheduleRunAt(rule.schedule);
    } else {
      nextRunAt = Date.now() + 24 * 60 * 60 * 1000;
    }

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
