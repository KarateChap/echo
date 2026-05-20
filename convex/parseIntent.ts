import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { convertFiatToToken } from "./fiatConversion";

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
  "amount": number | null,
  "amountFiat": number | null,
  "fiatCurrency": string | null,
  "token": "USDC" | "USDT" | "ETH" | "HTT",
  "schedule": { "kind": "monthly" | "weekly" | "daily" | "biweekly" | "cron" | "once" | "seconds" | "yearly", "value": string } | null,
  "condition": { "walletBelowUsdc": number, "topUpUsdc": number, "direction": "below" | "above" } | null,
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
  - USDC (USD Coin) — DEFAULT if user says "money" or doesn't specify a token AND is not using fiat mode
  - USDT (Tether) — if user says "USDT" or "Tether"
  - ETH (Ether) — if user says "ETH", "Ether", or "Ethereum"
  - HTT (Hoodi Test Token) — if user says "HTT", "Hoodi", or "test token"

────────────────────────────────
AMOUNT RULES (TOKEN vs FIAT)
────────────────────────────────
There are TWO modes for specifying amounts:

**MODE 1 — Token amount (direct):** The user specifies an amount of a specific token.
- Set "amount" to the numeric value. Set "amountFiat" and "fiatCurrency" to null.
- Examples: "send 0.5 ETH", "send 100 USDC", "padala 1 HTT"

**MODE 2 — Fiat amount (conversion needed):** The user specifies an amount in a fiat currency "worth of" a token.
- Set "amountFiat" to the fiat numeric value. Set "fiatCurrency" to the ISO currency code. Set "amount" to null.
- The system will convert the fiat amount to token units using live prices.
- Trigger phrases: "X pesos worth of", "X dollars worth of", "X PHP worth of", "X USD worth of",
  "X euros worth of", "worth", "halaga ng", "katumbas ng"
- Taglish: "piso", "pesos", "peso" → fiatCurrency="PHP"
  "dolyar", "dollars", "dollar" → fiatCurrency="USD"
  "euros", "euro" → fiatCurrency="EUR"
  "pounds", "pound" → fiatCurrency="GBP"
  "yen" → fiatCurrency="JPY"
- IMPORTANT: When the user says "pesos" or "dollars" AND also names a specific token (USDT, ETH, HTT),
  this is FIAT MODE. Example: "20 pesos worth of USDT" → amountFiat=20, fiatCurrency="PHP", token="USDT", amount=null
- When the user says "pesos" or "dollars" WITHOUT naming a specific token, default to USDC as the token
  and treat it as a direct token amount (since USDC ≈ $1): amount=X, token="USDC", amountFiat=null

General amount parsing (applies to both modes):
- Parse shorthand: "10k" or "10K" = 10000, "1.5k" = 1500, "500k" = 500000
- Parse Tagalog numbers:
  - "sampung libo" = 10000, "dalawang libo" = 2000, "tatlong libo" = 3000
  - "limang daan" = 500, "isang libo" = 1000, "limang libo" = 5000
  - "dalawampung libo" = 20000, "tatlumpung libo" = 30000
- Parse English words: "twenty thousand" = 20000, "five hundred" = 500
- If both amount and amountFiat are null/zero/missing, return: { "error": "Please specify the amount to send" }

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

2b. ONE-SHOT (delayed): User wants to send ONCE but AFTER a short delay — NOT recurring.
   → kind="oneShot", schedule={ kind:"seconds", value:"<totalSeconds>" }
   Triggered by: "after N seconds", "after N minutes", "in N seconds", "in N minutes",
     "pagkatapos ng N seconds", "mamaya after N minutes"
   - "after 30 seconds" → kind="oneShot", schedule={ kind:"seconds", value:"30" }
   - "in 2 minutes" → kind="oneShot", schedule={ kind:"seconds", value:"120" }
   - "after 1 minute" → kind="oneShot", schedule={ kind:"seconds", value:"60" }
   IMPORTANT: "after/in N seconds/minutes" means a SINGLE delayed payment.
   Only use kind="recurring" when the user explicitly says "every" (e.g. "every 30 seconds").

3. RECURRING MONTHLY: User wants to send every month on a specific day.
   → kind="recurring", schedule={ kind:"monthly", value:"<day>" }
   - value is the day of month as a string: "1", "15", "28"
   - Ordinal words map to day numbers: "first"→"1", "second"→"2", "third"→"3", "fourth"→"4", "fifth"→"5", etc.
   - "every 1st of the month" / "every first" → value="1"
   - "every 2nd of the month" / "every second of the month" → value="2"
   - "every 3rd" / "every third" → value="3"
   - "every 15th" → value="15"
   - IMPORTANT: "every second of the month" means the 2nd day, NOT every 1 second. The word "month" is the key indicator for monthly schedule.
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

6b. RECURRING YEARLY: User wants to send every year on a specific date (birthday, anniversary, holiday).
   → kind="recurring", schedule={ kind:"yearly", value:"MM-DD" }
   - "every birthday on Feb 1" / "every year on February 1" → { kind:"yearly", value:"02-01" }
   - "every Christmas" → { kind:"yearly", value:"12-25" }
   - "every anniversary on March 15" → { kind:"yearly", value:"03-15" }
   - "every New Year" → { kind:"yearly", value:"01-01" }
   - value is MM-DD format (zero-padded)
   - Triggered by: "every birthday", "every year", "yearly", "annually", "every anniversary", named holidays
   - IMPORTANT: If the user says "her birthday is <date>" or mentions a specific annual date + "every birthday/year", use yearly NOT monthly.

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
   If the user also specifies a duration ("for the next N minutes/hours"), set durationMinutes accordingly.

7c. RECURRING SUB-MINUTE (seconds): User wants to send every N seconds.
   → kind="recurring", schedule={ kind:"seconds", value:"<N>" }
   - "every 5 seconds" → { kind:"seconds", value:"5" }
   - "every 10 seconds" → { kind:"seconds", value:"10" }
   - "every second" / "per second" → { kind:"seconds", value:"1" }
   - "every 30 seconds" / "every half minute" → { kind:"seconds", value:"30" }
   - value is the number of seconds as a string.
   - If the user specifies a duration, convert to durationMinutes (e.g. "for 2 minutes" → durationMinutes=2).
   - Calculate totalOccurrences = durationMinutes × 60 ÷ seconds (or from explicit count).

8. CONDITIONAL: User sets a balance threshold to trigger a transfer.
   → kind="conditional", schedule=null, condition={ walletBelowUsdc:<threshold>, topUpUsdc:<amount>, direction:"below"|"above" }
   - direction="below": fires when recipient's wallet drops BELOW the threshold (auto-top-up).
     "If wallet drops below X, send Y" / "Pag bumaba below X, dagdagan ng Y"
   - direction="above": fires when recipient's wallet goes ABOVE the threshold.
     "If wallet exceeds X, send Y" / "Kapag tumaas sa X, send Y" / "When balance is more than X, send Y"
   - walletBelowUsdc is the threshold value regardless of direction (the name is legacy).
   - IMPORTANT: Detect direction from context — "drops below", "bumaba", "goes under" → "below";
     "exceeds", "tumaas", "goes above", "more than", "higher than", "rises above" → "above".

If the instruction is too ambiguous (e.g. "send mama money regularly" without amount), return:
{ "error": "Please specify the amount and how often" }

────────────────────────────────
TAGLISH EXAMPLES
────────────────────────────────

IMMEDIATE (oneShot):
- "Padala 10k kay wife" → {"kind":"oneShot","recipient":{"name":"Wife","hint":""},"amount":10000,"token":"USDC","amountFiat":null,"fiatCurrency":null,"schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Send mama 5000 now" → {"kind":"oneShot","recipient":{"name":"Mama","hint":""},"amount":5000,"token":"USDC","amountFiat":null,"fiatCurrency":null,"schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Transfer 0.5 ETH to John" → {"kind":"oneShot","recipient":{"name":"John","hint":""},"amount":0.5,"token":"ETH","amountFiat":null,"fiatCurrency":null,"schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Pay Maria 200 dollars" → {"kind":"oneShot","recipient":{"name":"Maria","hint":""},"amount":200,"token":"USDC","amountFiat":null,"fiatCurrency":null,"schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Padala kay ate ng limang daan" → {"kind":"oneShot","recipient":{"name":"Ate","hint":""},"amount":500,"token":"USDC","amountFiat":null,"fiatCurrency":null,"schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}

FIAT CONVERSION (oneShot):
- "Send wife 20 pesos worth of USDT now" → {"kind":"oneShot","recipient":{"name":"Wife","hint":""},"amount":null,"amountFiat":20,"fiatCurrency":"PHP","token":"USDT","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Padala 500 pesos worth of ETH kay mama" → {"kind":"oneShot","recipient":{"name":"Mama","hint":""},"amount":null,"amountFiat":500,"fiatCurrency":"PHP","token":"ETH","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Send 100 dollars worth of ETH to John" → {"kind":"oneShot","recipient":{"name":"John","hint":""},"amount":null,"amountFiat":100,"fiatCurrency":"USD","token":"ETH","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Transfer 50 USD worth of USDT to papa" → {"kind":"oneShot","recipient":{"name":"Papa","hint":""},"amount":null,"amountFiat":50,"fiatCurrency":"USD","token":"USDT","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}
- "Padala 1000 piso na halaga ng HTT kay ate" → {"kind":"oneShot","recipient":{"name":"Ate","hint":""},"amount":null,"amountFiat":1000,"fiatCurrency":"PHP","token":"HTT","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}

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

YEARLY:
- "My wife's birthday is February 1. Send 1 USDT every birthday for 5 years" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"USDT","schedule":{"kind":"yearly","value":"02-01"},"condition":null,"durationMinutes":null,"totalOccurrences":5}
- "Send mama 1000 every Christmas for 3 years" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":1000,"token":"USDC","schedule":{"kind":"yearly","value":"12-25"},"condition":null,"durationMinutes":null,"totalOccurrences":3}
- "Every anniversary on March 15, padala 5000 kay wife for 10 years" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":5000,"token":"USDC","schedule":{"kind":"yearly","value":"03-15"},"condition":null,"durationMinutes":null,"totalOccurrences":10}
- "Send papa 2000 every year on his birthday June 20" → {"error":"Please specify how many times or for how long (e.g. 'for 5 years' or '3 times')"}

MULTI-DAY (cron):
- "Send 1000 every 1st and 15th kay mama for 3 months" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":1000,"token":"USDC","schedule":{"kind":"cron","value":"0 9 1,15 * *"},"condition":null,"durationMinutes":null,"totalOccurrences":6}

SUB-DAILY:
- "For the next 5 minutes, send 1 HTT per minute to my wife" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"HTT","schedule":{"kind":"cron","value":"*/1 * * * *"},"condition":null,"durationMinutes":5,"totalOccurrences":5}
- "Send mama 10 USDC every 5 minutes for 30 minutes" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":10,"token":"USDC","schedule":{"kind":"cron","value":"*/5 * * * *"},"condition":null,"durationMinutes":30,"totalOccurrences":6}
- "Every 2 hours, padala 100 kay wife for the next 6 hours" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":100,"token":"USDC","schedule":{"kind":"cron","value":"0 */2 * * *"},"condition":null,"durationMinutes":360,"totalOccurrences":3}
- "Send 1 HTT every minute to my wife 10 times" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"HTT","schedule":{"kind":"cron","value":"*/1 * * * *"},"condition":null,"durationMinutes":null,"totalOccurrences":10}
- "Send 1 HTT every minute to my wife" → {"error":"Please specify how many times or for how long (e.g. 'for 5 minutes' or '10 times')"}

SUB-MINUTE (seconds):
- "Send 0.1 USDT to my wife every 5 seconds for 2 minutes" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":0.1,"token":"USDT","schedule":{"kind":"seconds","value":"5"},"condition":null,"durationMinutes":2,"totalOccurrences":24}
- "For the next 1 minute, send 1 HTT every 10 seconds to mama" → {"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":1,"token":"HTT","schedule":{"kind":"seconds","value":"10"},"condition":null,"durationMinutes":1,"totalOccurrences":6}
- "Send wife 1 USDC every second 5 times" → {"kind":"recurring","recipient":{"name":"Wife","hint":""},"amount":1,"token":"USDC","schedule":{"kind":"seconds","value":"1"},"condition":null,"durationMinutes":null,"totalOccurrences":5}
- "Send 1 HTT every 5 seconds to my wife" → {"error":"Please specify how many times or for how long (e.g. 'for 2 minutes' or '10 times')"}

CONDITIONAL (below — auto-top-up):
- "Pag bumaba na below 2k yung wallet ni ate, dagdagan ng 3k" → {"kind":"conditional","recipient":{"name":"Ate","hint":""},"amount":3000,"token":"USDC","schedule":null,"condition":{"walletBelowUsdc":2000,"topUpUsdc":3000,"direction":"below"},"durationMinutes":null,"totalOccurrences":null}
- "If mama's wallet drops below 1000, top up 5000" → {"kind":"conditional","recipient":{"name":"Mama","hint":""},"amount":5000,"token":"USDC","schedule":null,"condition":{"walletBelowUsdc":1000,"topUpUsdc":5000,"direction":"below"},"durationMinutes":null,"totalOccurrences":null}

CONDITIONAL (above — send when balance exceeds):
- "Kapag tumaas sa 5 USDT ang balance ni wife, sendan mo siya ng 1 USDT" → {"kind":"conditional","recipient":{"name":"Wife","hint":""},"amount":1,"token":"USDT","schedule":null,"condition":{"walletBelowUsdc":5,"topUpUsdc":1,"direction":"above"},"durationMinutes":null,"totalOccurrences":null}
- "If wife's balance exceeds 10, send her 1 USDT" → {"kind":"conditional","recipient":{"name":"Wife","hint":""},"amount":1,"token":"USDT","schedule":null,"condition":{"walletBelowUsdc":10,"topUpUsdc":1,"direction":"above"},"durationMinutes":null,"totalOccurrences":null}

ERROR CASES:
- "Send money" (no recipient, no amount) → {"error":"Please specify who to send to and the amount"}
- "Padala kay mama" (no amount) → {"error":"Please specify the amount to send"}
- "Send some money regularly" (ambiguous) → {"error":"Please specify the amount and how often"}`;
}

/** ISO 639-1 code → full language name for prompting. */
const LANG_CODE_TO_NAME: Record<string, string> = {
  tl: "Tagalog/Taglish",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  ceb: "Cebuano/Bisaya",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  nl: "Dutch",
  tr: "Turkish",
};

function buildLanguageAddendum(detectedLanguage: string): string {
  const langName = LANG_CODE_TO_NAME[detectedLanguage] ?? detectedLanguage;
  return `

────────────────────────────────
LANGUAGE AWARENESS
────────────────────────────────
The user is speaking in: ${langName}.
- Parse the intent into the SAME JSON schema regardless of the input language.
- All JSON field names and enum values (kind, schedule kind, token names, direction) remain in English.
- The "recipient.name" should be preserved as the user spoke it, with proper capitalization.
- Interpret numbers in the user's language (e.g., Japanese 五千 = 5000, Chinese 一万 = 10000, Korean 만 = 10000).
- Map relationship terms to a proper capitalized name (e.g., お母さん → "Mama", 妈妈 → "Mama", nanay → "Mama", inahan → "Mama").
- Interpret schedule keywords in the user's language (e.g., 毎月 = monthly, 毎日 = daily, cada mes = monthly).

────────────────────────────────
READBACK TEXT (REQUIRED)
────────────────────────────────
In addition to the intent fields, you MUST include a "readbackText" field in your JSON output.
This is a natural, friendly confirmation sentence in ${langName} — the SAME language the user spoke.
It should summarize the parsed intent: amount, token, recipient, and schedule/condition.
End with a phrase inviting the user to confirm.

Examples by language:
- Taglish: "Sige. Magpapadala ng 10,000 USDC kay Mama, every month, tuwing ika-1, 6 beses. I-confirm mo lang para mag-proceed."
- English: "Got it. Sending 10,000 USDC to Mama, every month on the 1st, 6 times. Please confirm to proceed."
- Japanese: "了解です。Mamaに10,000 USDCを毎月1日に6回送金します。確認してください。"
- Cebuano/Bisaya: "Sige. Magpadala og 10,000 USDC kang Mama, kada bulan sa ika-1, 6 ka beses. I-confirm lang para mapadayon."
- Chinese: "好的。将向Mama发送10,000 USDC，每月1日，共6次。请确认以继续。"
- Korean: "알겠습니다. Mama에게 매월 1일에 10,000 USDC를 6회 송금합니다. 확인해 주세요."

Adapt naturally for ${langName}. The readbackText must be in ${langName}, NOT in English (unless the user spoke English).
If there is an error, do NOT include readbackText.`;
}

export const parseIntent = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    transcript: v.string(),
    selectedToken: v.optional(v.string()),
    detectedLanguage: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, transcript, selectedToken, detectedLanguage }) => {
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

      // Append language-awareness instructions + readback generation
      if (detectedLanguage) {
        systemPrompt += buildLanguageAddendum(detectedLanguage);
      }

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

      // Fiat-to-token conversion: if GPT detected a fiat amount, fetch live price and convert
      if (!parsed.error && parsed.amountFiat && parsed.fiatCurrency) {
        const result = await convertFiatToToken(parsed.amountFiat, parsed.fiatCurrency, parsed.token);
        if ("error" in result) {
          parsed.error = result.error;
        } else {
          parsed.amount = result.amount;
          parsed.conversionRate = result.conversionRate;
        }
      }

      // If the model returned an error, pass it through
      if (!parsed.error) {
        const validKinds = ["recurring", "conditional", "oneShot"];
        const validScheduleKinds = ["monthly", "weekly", "daily", "biweekly", "cron", "once", "seconds", "yearly"];

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

      // Extract GPT-generated readbackText from parsed response (don't store it in the intent JSON)
      const readbackText = parsed.readbackText;
      delete parsed.readbackText;

      await ctx.runMutation(internal.voiceSessions.setIntent, {
        sessionId,
        intent: JSON.stringify(parsed),
        readbackText: readbackText || undefined,
        detectedLanguage,
      });
    } catch (e) {
      await ctx.runMutation(internal.voiceSessions.setError, {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
