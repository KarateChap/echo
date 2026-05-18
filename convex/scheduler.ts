import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const tickScheduledRules = internalAction({
  args: {},
  handler: async (ctx) => {
    const dueRules = await ctx.runQuery(internal.scheduler.getDueRules);

    for (const rule of dueRules) {
      // Fire payment
      await ctx.scheduler.runAfter(0, internal.executePayment.executePayment, {
        ruleId: rule._id,
      });

      const isFutureOneShot = rule.kind === "oneShot" && rule.schedule?.kind === "once";

      if (isFutureOneShot) {
        // Future one-shot picked up by cron — mark completed so it doesn't re-fire.
        // (executePayment also marks it, but this prevents the cron from re-firing
        // before executePayment finishes)
        await ctx.runMutation(internal.rules.markCompleted, {
          ruleId: rule._id,
        });
      } else if (rule.kind === "recurring") {
        // Advance nextRunAt for recurring rules so they don't re-fire next tick.
        await ctx.runMutation(internal.rules.advanceNextRun, {
          ruleId: rule._id,
        });
      }
    }
  },
});

import { internalQuery } from "./_generated/server";

export const getDueRules = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await ctx.db
      .query("rules")
      .withIndex("by_status_and_next_run")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "active"),
          q.lte(q.field("nextRunAt"), now),
        ),
      )
      .collect();
  },
});

