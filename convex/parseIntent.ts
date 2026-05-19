import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are Echo, a voice-first remittance assistant for Filipino OFWs.
The user just spoke a remittance instruction — possibly in Taglish (mixed Tagalog and English).
Parse it into a structured JSON intent.
Today is ${today}.

Output ONLY valid JSON matching this schema — no markdown, no explanation:
{
  "kind": "recurring" | "conditional" | "oneShot",
  "recipient": { "name": string, "hint": string },
  "amount": number,
  "token": "USDC" | "USDT" | "ETH" | "HTT",
  "schedule": { "kind": "monthly" | "weekly" | "daily" | "biweekly" | "cron" | "once", "value": string } | null,
  "condition": { "walletBelowUsdc": number, "topUpUsdc": number } | null,
  "durationMinutes": number | null,
  "totalOccurrences": number | null
}

"durationMinutes" — set ONLY when the user specifies a time-bounded duration:
- "for the next 5 minutes" → 5
- "for the next 1 hour" / "for 1 hour" → 60
- "for 30 minutes" → 30
- If no duration mentioned → null

"totalOccurrences" — the total number of payments for a recurring rule. REQUIRED for all recurring rules.
Calculate from either an explicit count or from durationMinutes ÷ interval:
- "5 times" / "5 payments" → 5
- "for 3 months" at monthly schedule → 3
- "for 5 minutes" at per-minute schedule → 5
- "for 1 hour" at every-5-minutes schedule → 12
- "for 6 hours" at every-2-hours schedule → 3
- "every month for a year" → 12
- "every week for 2 months" → 8
- If kind="recurring" and the user does NOT specify a count or duration, return:
  { "error": "Please specify how many times or for how long (e.g. 'for 5 minutes' or '3 times')" }
- For oneShot and conditional → null

────────────────────────────────
TOKEN RULES
────────────────────────────────
- "token" identifies which cryptocurrency/token the user wants to send:
  - USDC (USD Coin) — DEFAULT if user says "dollars", "pesos", "money", or doesn't specify a token
  - USDT (Tether) — if user says "USDT" or "Tether"
  - ETH (Ether) — if user says "ETH", "Ether", or "Ethereum"
  - HTT (Hoodi Test Token) — if user says "HTT", "Hoodi", or "test token"

────────────────────────────────
AMOUNT RULES
────────────────────────────────
- "amount" is the numeric value of the specified token. It MUST be a positive number (> 0).
- Parse shorthand: "10k" or "10K" = 10000, "1.5k" = 1500, "500k" = 500000
- Parse Tagalog numbers:
  - "sampung libo" = 10000, "dalawang libo" = 2000, "tatlong libo" = 3000
  - "limang daan" = 500, "isang libo" = 1000, "limang libo" = 5000
  - "dalawampung libo" = 20000, "tatlumpung libo" = 30000
- Parse English words: "twenty thousand" = 20000, "five hundred" = 500
- If amount is zero, negative, or missing, return: { "error": "Please specify the amount to send" }

────────────────────────────────
RECIPIENT RULES
────────────────────────────────
- "recipient.name" should be capitalized properly (e.g. "Mama", "Wife", "Maria", "Papa").
- "recipient.hint" is any extra info (email, relationship, phone) the user mentioned. Use "" if none.
- If no recipient is mentioned at all, return: { "error": "Please specify who to send to" }

────────────────────────────────
SCHEDULE & KIND RULES
────────────────────────────────

1. ONE-SHOT (immediate): No schedule words. User wants to send right now.
   → kind="oneShot", schedule=null, condition=null
   Examples: "send now", "padala", "transfer", "pay"

2. ONE-SHOT (future date): User specifies a single future date but NOT a recurring pattern.
   → kind="oneShot", schedule={ kind:"once", value:"YYYY-MM-DD" }
   Resolve relative dates using today (${today}):
   - "next Friday" → compute the actual date
   - "on June 15" → "${new Date().getFullYear()}-06-15" (use next year if date has passed)
   - "on Christmas" → "YYYY-12-25"
   - "tomorrow" → compute the actual date

3. RECURRING MONTHLY: User wants to send every month on a specific day.
   → kind="recurring", schedule={ kind:"monthly", value:"<day>" }
   - value is the day of month as a string: "1", "15", "28"
   - For "end of month" / "last day" / "katapusan ng buwan" → value="last"
   - If no day specified, default to "1"

4. RECURRING WEEKLY: User wants to send every week on a specific day.
   → kind="recurring", schedule={ kind:"weekly", value:"<DayName>" }
   - value is the full day name: "Monday", "Tuesday", etc.

5. RECURRING DAILY: User wants to send every day.
   → kind="recurring", schedule={ kind:"daily", value:"09:00" }
   - value is the time in HH:MM (24h format). Default "09:00" if no time specified.

6. RECURRING BIWEEKLY: User wants to send every two weeks / every other week.
   → kind="recurring", schedule={ kind:"biweekly", value:"<DayName>" }
   - Triggered by: "every two weeks", "every other week", "every other Friday", "biweekly"
   - value is the day name. Default "Friday" if no day specified.

7. RECURRING CRON (complex): Multiple days per month or complex patterns.
   → kind="recurring", schedule={ kind:"cron", value:"<5-field cron>" }
   - "every 1st and 15th" → { kind:"cron", value:"0 9 1,15 * *" }
   - "every Monday and Thursday" → { kind:"cron", value:"0 9 * * 1,4" }

7b. RECURRING SUB-DAILY: User wants to send more frequently than daily (every N minutes, every N hours).
   → kind="recurring", schedule={ kind:"cron", value:"<5-field cron>" }
   - "every minute" / "per minute" / "each minute" → { kind:"cron", value:"*/1 * * * *" }
   - "every 5 minutes" → { kind:"cron", value:"*/5 * * * *" }
   - "every 30 minutes" / "every half hour" → { kind:"cron", value:"*/30 * * * *" }
   - "every 2 hours" → { kind:"cron", value:"0 */2 * * *" }
   - "every hour" → { kind:"cron", value:"0 * * * *" }
   The minimum supported interval is 1 minute.
   If the user also specifies a duration ("for the next N minutes/hours"), set durationMinutes accordingly.

8. CONDITIONAL: User sets a balance threshold to auto-top-up.
   → kind="conditional", schedule=null, condition={ walletBelowUsdc:<threshold>, topUpUsdc:<amount> }
   - "If wallet drops below X, send Y"
   - "Pag bumaba below X, dagdagan ng Y"

If the instruction is too ambiguous (e.g. "send mama money regularly" without amount), return:
{ "error": "Please specify the amount and how often" }

────────────────────────────────
TAGLISH EXAMPLES
────────────────────────────────

IMMEDIATE (oneShot):
- "Padala 10k kay wife" → {"kind":"oneShot","recipient":{"name":"Wife","hint":""},"amount":10000,"token":"USDC","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Send mama 5000 now" → {"kind":"oneShot","recipient":{"name":"Mama","hint":""},"amount":5000,"token":"USDC","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Transfer 0.5 ETH to John" → {"kind":"oneShot","recipient":{"name":"John","hint":""},"amount":0.5,"token":"ETH","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Pay Maria 200 dollars" → {"kind":"oneShot","recipient":{"name":"Maria","hint":""},"amount":200,"token":"USDC","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Padala kay ate ng limang daan" → {"kind":"oneShot","recipient":{"name":"Ate","hint":""},"amount":500,"token":"USDC","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}

FUTURE ONE-SHOT (once):
- "Send mama 10k on June 15" → {"kind":"oneShot","recipient":{"name":"Mama","hint":""},"amount":10000,"token":"USDC","schedule":{"kind":"once","value":"<resolved YYYY-06-15>"},"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Padala 5000 on Christmas kay papa" → {"kind":"oneShot","recipient":{"name":"Papa","hint":""},"amount":5000,"token":"USDC","schedule":{"kind":"once","value":"<resolved YYYY-12-25>"},"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Send wife 3000 next Friday" → {"kind":"oneShot","recipient":{"name":"Wife","hint":""},"amount":3000,"token":"USDC","schedule":{"kind":"once","value":"<resolved date>"},"condition":null,"durationMinutes":null,"totalOccurrences":null}

MONTHLY:
- "Send mama 10k every 1st of the month for 6 months" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":10000,"token":"USDC","schedule":{"kind":"monthly","value":"1"},"condition":null,"durationMinutes":null,"totalOccurrences":6}
- "Padala 5000 kay ate every month for a year" → {"kind":"recurring","recipient":{"name":"Ate","hint":""},"amount":5000,"token":"USDC","schedule":{"kind":"monthly","value":"1"},"condition":null,"durationMinutes":null,"totalOccurrences":12}
- "Send 3000 to papa on the 15th monthly 3 times" → {"kind":"recurring","recipient":{"name":"Papa","hint":""},"amount":3000,"token":"USDC","schedule":{"kind":"monthly","value":"15"},"condition":null,"durationMinutes":null,"totalOccurrences":3}
- "Every end of month, send mama 10k" → {"error":"Please specify how many times or for how long (e.g. 'for 6 months' or '3 times')"}

WEEKLY:
- "Send wife 1000 every Monday for 4 weeks" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1000,"token":"USDC","schedule":{"kind":"weekly","value":"Monday"},"condition":null,"durationMinutes":null,"totalOccurrences":4}
- "Padala 500 every Friday kay mama" → {"error":"Please specify how many times or for how long (e.g. 'for 4 weeks' or '8 times')"}

DAILY:
- "Send mama 100 every day for 7 days" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":100,"token":"USDC","schedule":{"kind":"daily","value":"09:00"},"condition":null,"durationMinutes":null,"totalOccurrences":7}
- "Daily allowance ng 50 USDC para kay son for 30 days" → {"kind":"recurring","recipient":{"name":"Son","hint":""},"amount":50,"token":"USDC","schedule":{"kind":"daily","value":"09:00"},"condition":null,"durationMinutes":null,"totalOccurrences":30}

BIWEEKLY:
- "Send 5000 every two weeks kay mama for 3 months" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":5000,"token":"USDC","schedule":{"kind":"biweekly","value":"Friday"},"condition":null,"durationMinutes":null,"totalOccurrences":6}
- "Every other Friday, padala 3000 kay papa 4 times" → {"kind":"recurring","recipient":{"name":"Papa","hint":""},"amount":3000,"token":"USDC","schedule":{"kind":"biweekly","value":"Friday"},"condition":null,"durationMinutes":null,"totalOccurrences":4}

MULTI-DAY (cron):
- "Send 1000 every 1st and 15th kay mama for 3 months" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":1000,"token":"USDC","schedule":{"kind":"cron","value":"0 9 1,15 * *"},"condition":null,"durationMinutes":null,"totalOccurrences":6}

SUB-DAILY:
- "For the next 5 minutes, send 1 HTT per minute to my wife" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"HTT","schedule":{"kind":"cron","value":"*/1 * * * *"},"condition":null,"durationMinutes":5,"totalOccurrences":5}
- "Send mama 10 USDC every 5 minutes for 30 minutes" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":10,"token":"USDC","schedule":{"kind":"cron","value":"*/5 * * * *"},"condition":null,"durationMinutes":30,"totalOccurrences":6}
- "Every 2 hours, padala 100 kay wife for the next 6 hours" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":100,"token":"USDC","schedule":{"kind":"cron","value":"0 */2 * * *"},"condition":null,"durationMinutes":360,"totalOccurrences":3}
- "Send 1 HTT every minute to my wife 10 times" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"HTT","schedule":{"kind":"cron","value":"*/1 * * * *"},"condition":null,"durationMinutes":null,"totalOccurrences":10}
- "Send 1 HTT every minute to my wife" → {"error":"Please specify how many times or for how long (e.g. 'for 5 minutes' or '10 times')"}

CONDITIONAL:
- "Pag bumaba na below 2k yung wallet ni ate, dagdagan ng 3k" → {"kind":"conditional","recipient":{"name":"Ate","hint":""},"amount":3000,"token":"USDC","schedule":null,"condition":{"walletBelowUsdc":2000,"topUpUsdc":3000},"durationMinutes":null,"totalOccurrences":null}
- "If mama's wallet drops below 1000, top up 5000" → {"kind":"conditional","recipient":{"name":"Mama","hint":""},"amount":5000,"token":"USDC","schedule":null,"condition":{"walletBelowUsdc":1000,"topUpUsdc":5000},"durationMinutes":null,"totalOccurrences":null}

ERROR CASES:
- "Send money" (no recipient, no amount) → {"error":"Please specify who to send to and the amount"}
- "Padala kay mama" (no amount) → {"error":"Please specify the amount to send"}
- "Send some money regularly" (ambiguous) → {"error":"Please specify the amount and how often"}`;
}

export const parseIntent = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    transcript: v.string(),
    selectedToken: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, transcript, selectedToken }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.voiceSessions.setError, {
        sessionId,
        error: "OPENAI_API_KEY not set",
      });
      return;
    }

    try {
      let systemPrompt = buildSystemPrompt();
      if (selectedToken) {
        systemPrompt += `\n\nIMPORTANT: The user has pre-selected "${selectedToken}" as their token in the UI. If the user does not explicitly name a different token in their speech, you MUST use "${selectedToken}" as the token — do NOT default to USDC.`;
      }

      const res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`GPT ${res.status}: ${detail.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      const raw = json.choices?.[0]?.message?.content ?? "";

      // Validate parsed JSON structure
      const parsed = JSON.parse(raw);

      // Force-override token with UI selection so GPT can't default to USDC
      if (selectedToken && !parsed.error) {
        parsed.token = selectedToken;
      }

      // Validate that a token was determined
      if (!parsed.error && !parsed.token) {
        parsed.error = "Could not determine which token to send. Please try again.";
      }

      // If the model returned an error, pass it through
      if (!parsed.error) {
        const validKinds = ["recurring", "conditional", "oneShot"];
        const validScheduleKinds = ["monthly", "weekly", "daily", "biweekly", "cron", "once"];

        if (!validKinds.includes(parsed.kind)) {
          throw new Error("Invalid intent kind: " + parsed.kind);
        }
        const amount = parsed.amount ?? parsed.amountUsdc;
        if (typeof amount !== "number" || amount <= 0) {
          throw new Error("Amount must be a positive number");
        }
        if (!parsed.recipient?.name || parsed.recipient.name.trim() === "") {
          throw new Error("Recipient name is required");
        }
        if (parsed.schedule && !validScheduleKinds.includes(parsed.schedule.kind)) {
          throw new Error("Invalid schedule kind: " + parsed.schedule.kind);
        }
        if (parsed.schedule && (!parsed.schedule.value || parsed.schedule.value.trim() === "")) {
          throw new Error("Schedule value is required");
        }

        // Post-process: fix common GPT cron mistakes for sub-daily patterns.
        // GPT often generates "0 * * * *" (hourly) when "every minute" was intended.
        if (parsed.schedule?.kind === "cron") {
          const lower = transcript.toLowerCase();
          const wantsMinute = /\bper minute\b|\bevery minute\b|\beach minute\b|\bper.minute\b|\bminute.*to\b|\bminute\b.*\bsend\b/i.test(lower);
          const cronParts = parsed.schedule.value.trim().split(/\s+/);
          if (wantsMinute && cronParts.length === 5) {
            const [min, hour] = cronParts;
            // If GPT wrote "0 * * * *" (hourly) but user said "per minute", fix it
            if (min === "0" && hour === "*") {
              parsed.schedule.value = "*/1 * * * *";
            }
          }
        }

        // Require totalOccurrences for recurring rules
        if (parsed.kind === "recurring" && (!parsed.totalOccurrences || parsed.totalOccurrences <= 0)) {
          parsed.error = "Please specify how many times or for how long (e.g. 'for 5 minutes' or '3 times')";
        }
      }

      await ctx.runMutation(internal.voiceSessions.setIntent, {
        sessionId,
        intent: JSON.stringify(parsed),
      });
    } catch (e) {
      await ctx.runMutation(internal.voiceSessions.setError, {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
