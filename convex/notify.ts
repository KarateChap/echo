import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const RESEND_URL = "https://api.resend.com/emails";

export const sendClaimEmail = internalAction({
  args: {
    ruleId: v.id("rules"),
    recipientId: v.id("recipients"),
    recipientEmail: v.string(),
    recipientName: v.string(),
    senderName: v.string(),
    amountUsdc: v.number(),
    cryptoToken: v.optional(v.string()),
    voiceMessageId: v.optional(v.id("voiceMessages")),
    transactionId: v.optional(v.id("transactions")),
  },
  handler: async (ctx, args) => {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@pay-echo.space";

    const displayToken = args.cryptoToken ?? "Unknown";

    console.log(`[sendClaimEmail] Sending to ${args.recipientEmail} for rule ${args.ruleId}`);

    // Create claim token first
    const token = await ctx.runMutation(internal.claims.createClaimToken, {
      ruleId: args.ruleId,
      recipientId: args.recipientId,
      senderName: args.senderName,
      recipientEmail: args.recipientEmail,
      amountUsdc: args.amountUsdc,
      cryptoToken: args.cryptoToken,
      voiceMessageId: args.voiceMessageId,
    });

    // Build the claim URL — production domain when APP_URL is set, localhost for dev
    const baseUrl = process.env.APP_URL ?? "https://dev.pay-echo.space";
    const claimUrl = `${baseUrl}/claim/${token}`;

    if (!resendKey) {
      console.log(`[DEV] Claim email for ${args.recipientEmail}:`);
      console.log(`[DEV] Claim URL: ${claimUrl}`);
      console.log(`[DEV] (Set RESEND_API_KEY to send real emails)`);
      // Mark as sent even in dev mode so retry doesn't re-fire
      if (args.transactionId) {
        await ctx.runMutation(internal.transactions.markNotificationSent, {
          transactionId: args.transactionId,
        });
      }
      return;
    }

    try {
      const hasVoice = !!args.voiceMessageId;
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: `Echo <${fromEmail}>`,
          to: [args.recipientEmail],
          subject: `${args.senderName} sent you ${args.amountUsdc} ${displayToken}${hasVoice ? " — and a message" : ""}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
              <h1 style="font-size: 24px; margin-bottom: 8px;">You received ${args.amountUsdc} ${displayToken}</h1>
              <p style="color: #666; font-size: 14px;">
                ${args.senderName} sent you money${hasVoice ? " — and a voice message" : ""} via Echo.
              </p>
              ${hasVoice ? '<p style="color: #666; font-size: 14px;">🎙 A voice message is waiting for you.</p>' : ""}
              <a href="${claimUrl}" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 12px; font-weight: 600;">
                Claim your funds
              </a>
              <p style="margin-top: 24px; color: #999; font-size: 11px;">
                Powered by Echo — voice-first remittance on Morph.
              </p>
            </div>
          `,
        }),
      });

      if (res.ok) {
        console.log(`[sendClaimEmail] Email sent successfully to ${args.recipientEmail}`);
        if (args.transactionId) {
          await ctx.runMutation(internal.transactions.markNotificationSent, {
            transactionId: args.transactionId,
          });
        }
      } else {
        const detail = await res.text();
        const errorMsg = `Resend ${res.status}: ${detail.slice(0, 200)}`;
        console.error(`[sendClaimEmail] ${errorMsg}`);
        if (args.transactionId) {
          await ctx.runMutation(internal.transactions.markNotificationFailed, {
            transactionId: args.transactionId,
            error: errorMsg,
          });
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[sendClaimEmail] Failed:`, errorMsg);
      if (args.transactionId) {
        await ctx.runMutation(internal.transactions.markNotificationFailed, {
          transactionId: args.transactionId,
          error: errorMsg,
        });
      }
    }
  },
});

export const retryPendingNotifications = internalAction({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.runQuery(internal.transactions.getPendingNotifications);

    if (pending.length === 0) return;
    console.log(`[retryPendingNotifications] Found ${pending.length} stuck notifications`);

    for (const tx of pending) {
      if (!tx.ruleId) continue;

      const rule = await ctx.runQuery(internal.rules.getInternal, { ruleId: tx.ruleId });
      if (!rule || !rule.recipientEmail) continue;

      console.log(`[retryPendingNotifications] Retrying notification for tx ${tx._id}, rule ${tx.ruleId}`);
      await ctx.scheduler.runAfter(0, internal.notify.sendClaimEmail, {
        ruleId: tx.ruleId,
        recipientId: tx.recipientId,
        recipientEmail: rule.recipientEmail,
        recipientName: rule.recipientName,
        senderName: rule.ownerName,
        amountUsdc: tx.amountUsdc,
        cryptoToken: tx.token,
        voiceMessageId: tx.voiceMessageId,
        transactionId: tx._id,
      });
    }
  },
});
