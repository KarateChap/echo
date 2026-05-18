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

      // Advance nextRunAt for recurring rules so they don't re-fire next tick.
      // One-shot rules are marked "completed" inside executePayment after success.
      if (rule.kind === "recurring") {
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

