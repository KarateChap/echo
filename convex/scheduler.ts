import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const tickScheduledRules = internalAction({
  args: {},
  handler: async (ctx) => {
    const dueRules = await ctx.runQuery(internal.scheduler.getDueRules);

    for (const rule of dueRules) {
      // Seconds-based rules are self-scheduled, skip them here
      if (rule.schedule?.kind === "seconds") continue;

      // Check if the rule has expired
      if (rule.expiresAt && Date.now() > rule.expiresAt) {
        await ctx.runMutation(internal.rules.markCompleted, {
          ruleId: rule._id,
        });
        continue;
      }

      // Guard: if bounded recurring rule has completed all occurrences, mark done
      if (rule.totalOccurrences && (rule.executionCount ?? 0) >= rule.totalOccurrences) {
        await ctx.runMutation(internal.rules.markCompleted, {
          ruleId: rule._id,
        });
        continue;
      }

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

export const executeSecondsRule = internalAction({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, { ruleId }) => {
    const rule = await ctx.runQuery(internal.rules.getInternal, { ruleId });
    if (!rule || rule.status !== "active") return;

    // Check if expired
    if (rule.expiresAt && Date.now() > rule.expiresAt) {
      await ctx.runMutation(internal.rules.markCompleted, { ruleId });
      return;
    }

    // Check occurrence limit
    const currentCount = rule.executionCount ?? 0;
    if (rule.totalOccurrences && currentCount >= rule.totalOccurrences) {
      await ctx.runMutation(internal.rules.markCompleted, { ruleId });
      return;
    }

    // Fire payment
    await ctx.scheduler.runAfter(0, internal.executePayment.executePayment, { ruleId });

    // Increment execution count
    const newCount = currentCount + 1;
    if (rule.totalOccurrences && newCount >= rule.totalOccurrences) {
      await ctx.runMutation(internal.rules.markCompleted, { ruleId });
      return;
    }
    await ctx.runMutation(internal.rules.incrementExecutionCount, { ruleId, newCount });

    // Self-schedule next execution
    const intervalSeconds = parseInt(rule.schedule?.value ?? "5");
    await ctx.scheduler.runAfter(intervalSeconds * 1000, internal.scheduler.executeSecondsRule, { ruleId });
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
          q.neq(q.field("kind"), "conditional"),
        ),
      )
      .collect();
  },
});

export const getActiveConditionalRules = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_status_and_next_run")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const conditionalRules = rules.filter(
      (r) => r.kind === "conditional" && r.condition,
    );

    return Promise.all(
      conditionalRules.map(async (rule) => {
        const recipient = await ctx.db.get(rule.recipientId);
        return {
          ...rule,
          recipientWalletAddress: recipient?.walletAddress ?? null,
        };
      }),
    );
  },
});

export const tickConditionalRules = internalAction({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.runQuery(internal.scheduler.getActiveConditionalRules);

    for (const rule of rules) {
      try {
        // Skip rules without a recipient wallet (they need to claim first)
        if (!rule.recipientWalletAddress) continue;
        if (!rule.condition) continue;

        // Check if expired
        if (rule.expiresAt && Date.now() > rule.expiresAt) {
          await ctx.runMutation(internal.rules.markCompleted, { ruleId: rule._id });
          continue;
        }

        // Check occurrence limit
        if (rule.totalOccurrences && (rule.executionCount ?? 0) >= rule.totalOccurrences) {
          await ctx.runMutation(internal.rules.markCompleted, { ruleId: rule._id });
          continue;
        }

        // Read recipient's on-chain balance
        const balance = await getRecipientBalance(
          rule.recipientWalletAddress,
          rule.token ?? "USDC",
        );

        // Only fire if balance is below threshold
        if (balance < rule.condition.walletBelowUsdc) {
          await ctx.scheduler.runAfter(0, internal.executePayment.executePayment, {
            ruleId: rule._id,
          });

          // Increment execution count
          const newCount = (rule.executionCount ?? 0) + 1;
          if (rule.totalOccurrences && newCount >= rule.totalOccurrences) {
            await ctx.runMutation(internal.rules.markCompleted, { ruleId: rule._id });
          } else {
            await ctx.runMutation(internal.rules.incrementExecutionCount, {
              ruleId: rule._id,
              newCount,
            });
          }
        }
      } catch (e) {
        console.error(
          `[tickConditionalRules] Error checking rule ${rule._id}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  },
});

async function getRecipientBalance(
  walletAddress: string,
  token: string,
): Promise<number> {
  const rpcUrl = process.env.MORPH_HOODI_RPC_URL;
  if (!rpcUrl) throw new Error("Missing MORPH_HOODI_RPC_URL");

  const { createPublicClient, http, formatUnits, defineChain } = await import("viem");

  const morphHoodi = defineChain({
    id: 2910,
    name: "Morph Hoodi Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });

  const publicClient = createPublicClient({
    chain: morphHoodi,
    transport: http(rpcUrl),
  });

  const TOKEN_ADDRESSES: Record<string, { address: string; decimals: number }> = {
    USDC: { address: process.env.USDC_ADDRESS ?? "0x1178341838B764dCfFA5BCEAb1d41443Fd71a227", decimals: 6 },
    USDT: { address: "0xb646c743b4ba47ac03bee360bb2484fb55db8d7e", decimals: 6 },
    HTT: { address: "0xecf966cc754bc411e1f1106fbb4e343b835e85e4", decimals: 18 },
  };

  if (token === "ETH") {
    const balance = await publicClient.getBalance({
      address: walletAddress as `0x${string}`,
    });
    return parseFloat(formatUnits(balance, 18));
  }

  const tokenInfo = TOKEN_ADDRESSES[token];
  if (!tokenInfo) throw new Error(`Unsupported token: ${token}`);

  const balance = await publicClient.readContract({
    address: tokenInfo.address as `0x${string}`,
    abi: [{
      name: "balanceOf",
      type: "function",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    }],
    functionName: "balanceOf",
    args: [walletAddress as `0x${string}`],
  }) as bigint;

  return parseFloat(formatUnits(balance, tokenInfo.decimals));
}

