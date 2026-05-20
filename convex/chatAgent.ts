import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { convertFiatToToken } from "./fiatConversion";
import { extractDelaySeconds } from "./delayExtractor";
import { extractTokenFromTranscript } from "./tokenExtractor";

// ── Fetch live crypto prices ────────────────────────────────────────────────

export async function fetchCryptoPrices(): Promise<string> {
  const tokens = ["ethereum", "usd-coin", "tether"];
  const currencies = "usd,php";
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokens.join(",")}&vs_currencies=${currencies}`
    );
    if (!res.ok) return "Price data unavailable.";
    const data = (await res.json()) as Record<string, Record<string, number>>;
    const lines: string[] = [];
    const nameMap: Record<string, string> = {
      ethereum: "ETH",
      "usd-coin": "USDC",
      tether: "USDT",
    };
    for (const [id, prices] of Object.entries(data)) {
      const symbol = nameMap[id] ?? id;
      const usd = prices.usd ? `$${prices.usd.toLocaleString()}` : "N/A";
      const php = prices.php ? `₱${prices.php.toLocaleString()}` : "N/A";
      lines.push(`${symbol}: ${usd} / ${php}`);
    }
    return lines.join(" | ");
  } catch {
    return "Price data unavailable.";
  }
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// ── Internal queries to gather user context ──────────────────────────────────

export const getUserContext = internalQuery({
  args: { privyId: v.string() },
  handler: async (ctx, { privyId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) return null;

    // Recipients
    const recipients = await ctx.db
      .query("recipients")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    // Rules with recipient names
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    const rulesWithNames = await Promise.all(
      rules.map(async (rule) => {
        const recipient = await ctx.db.get(rule.recipientId);
        return {
          kind: rule.kind,
          amountUsdc: rule.amountUsdc,
          token: rule.token ?? "USDC",
          status: rule.status,
          recipientName: recipient?.displayName ?? "Unknown",
          schedule: rule.schedule,
          condition: rule.condition,
          executionCount: rule.executionCount ?? 0,
          totalOccurrences: rule.totalOccurrences,
          nextRunAt: rule.nextRunAt,
        };
      }),
    );

    // Recent transactions (last 20)
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(20);
    const txsWithNames = await Promise.all(
      txs.map(async (tx) => {
        const recipient = await ctx.db.get(tx.recipientId);
        return {
          amountUsdc: tx.amountUsdc,
          token: tx.token ?? "USDC",
          status: tx.status,
          recipientName: recipient?.displayName ?? "Unknown",
          executedAt: tx.executedAt,
          txHash: tx.txHash,
        };
      }),
    );

    return {
      userId: user._id,
      displayName: user.displayName,
      email: user.email,
      walletAddress: user.walletAddress,
      voiceGender: user.voiceGender ?? "female",
      recipients: recipients.map((r) => ({
        name: r.displayName,
        email: r.contactEmail,
        relationship: r.relationship,
        walletAddress: r.walletAddress,
      })),
      rules: rulesWithNames,
      transactions: txsWithNames,
    };
  },
});

export const getActiveChatSession = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(1);
    const session = sessions[0];
    if (session && session.status === "active") return session;
    return null;
  },
});

export const upsertChatSession = internalMutation({
  args: {
    sessionId: v.optional(v.id("chatSessions")),
    userId: v.id("users"),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      timestamp: v.number(),
    })),
  },
  handler: async (ctx, { sessionId, userId, messages }) => {
    if (sessionId) {
      await ctx.db.patch(sessionId, { messages });
      return sessionId;
    }
    return await ctx.db.insert("chatSessions", {
      ownerId: userId,
      messages,
      status: "active",
    });
  },
});

// ── System prompt builder ────────────────────────────────────────────────────

export function buildChatSystemPrompt(context: {
  displayName?: string;
  walletAddress?: string;
  balanceSummary?: string;
  priceSummary?: string;
  recipients: Array<{ name: string; email?: string | null; relationship?: string | null }>;
  rules: Array<{
    kind: string; amountUsdc: number; token: string; status: string;
    recipientName: string; schedule?: { kind: string; value: string } | null;
    condition?: { walletBelowUsdc: number; topUpUsdc: number; direction?: string } | null;
    executionCount: number; totalOccurrences?: number | null;
  }>;
  transactions: Array<{
    amountUsdc: number; token: string; status: string;
    recipientName: string; executedAt?: number | null;
  }>;
}): string {
  const today = new Date().toISOString().split("T")[0];

  const activeRules = context.rules.filter((r) => ["active", "pending", "awaitingRecipient"].includes(r.status));
  const completedRules = context.rules.filter((r) => r.status === "completed");
  const pausedRules = context.rules.filter((r) => r.status === "paused");

  let rulesBlock = "None yet.";
  if (activeRules.length > 0) {
    rulesBlock = activeRules.map((r) => {
      let desc = `- ${r.amountUsdc.toLocaleString()} ${r.token} to ${r.recipientName}`;
      if (r.schedule) desc += ` (${r.schedule.kind}: ${r.schedule.value})`;
      if (r.condition) desc += ` (${r.condition.direction ?? "below"} ${r.condition.walletBelowUsdc} ${r.token})`;
      desc += ` [${r.status}, ${r.executionCount}${r.totalOccurrences ? `/${r.totalOccurrences}` : ""} done]`;
      return desc;
    }).join("\n");
  }

  let txBlock = "No transactions yet.";
  if (context.transactions.length > 0) {
    txBlock = context.transactions.slice(0, 10).map((tx) => {
      const date = tx.executedAt ? new Date(tx.executedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "pending";
      return `- ${tx.amountUsdc.toLocaleString()} ${tx.token} to ${tx.recipientName} (${tx.status}, ${date})`;
    }).join("\n");
  }

  let recipientsBlock = "No contacts yet.";
  if (context.recipients.length > 0) {
    recipientsBlock = context.recipients.map((r) => {
      let desc = `- ${r.name}`;
      if (r.relationship) desc += ` (${r.relationship})`;
      if (r.email) desc += ` — ${r.email}`;
      return desc;
    }).join("\n");
  }

  return `You are Echo, a friendly voice assistant for the Echo remittance app. You help users manage their crypto remittances.
Today is ${today}.

LANGUAGE: Always respond in the SAME language the user is speaking. Mirror their language exactly:
- If they speak Taglish (mixed Tagalog/English), reply in Taglish.
- If they speak English, reply in English.
- If they speak Japanese, reply in Japanese.
- If they speak Korean, reply in Korean.
- If they speak Chinese, reply in Chinese.
- If they speak Spanish, reply in Spanish.
- If they speak any other language, reply in that same language.
Detect the language from each message and match it. Do NOT default to English or Taglish.

Be warm, concise, and helpful.
Keep responses SHORT (1-3 sentences) since they will be read aloud via TTS.

=== USER ACCOUNT ===
Name: ${context.displayName ?? "User"}
Wallet: ${context.walletAddress ?? "Not set up"}
${context.balanceSummary ? `Balances: ${context.balanceSummary}` : "Balances: Loading..."}

=== LIVE CRYPTO PRICES (REAL-TIME, UPDATED NOW) ===
${context.priceSummary ?? "Unavailable"}
IMPORTANT: The prices above are REAL, LIVE data fetched just now from CoinGecko. You DO have access to current crypto prices. When users ask "how much is X", "magkano ang X", "what's the price of X", or any price/exchange-rate question, use ONLY the prices listed above. NEVER say you don't have access to live prices. NEVER guess or make up a price. If the data says "Unavailable", tell the user prices are temporarily unavailable and to try again shortly.

=== ACTIVE RULES (${activeRules.length}) ===
${rulesBlock}
${pausedRules.length > 0 ? `\nPaused rules: ${pausedRules.length}` : ""}
${completedRules.length > 0 ? `\nCompleted rules: ${completedRules.length}` : ""}

=== RECENT TRANSACTIONS (${context.transactions.length}) ===
${txBlock}

=== CONTACTS (${context.recipients.length}) ===
${recipientsBlock}

────────────────────────────────
RESPONSE FORMAT
────────────────────────────────
Reply ONLY with valid JSON — no markdown, no explanation.

There are exactly 3 response types:

TYPE 1 — "answer" (questions, greetings, info requests):
{ "type": "answer", "text": "your response here" }

TYPE 2 — "payment_intent" (ANY message that describes sending/transferring money):
{
  "type": "payment_intent",
  "text": "A short, natural, conversational confirmation sentence in the user's language. This text will be spoken aloud via TTS, so it MUST sound like a human speaking — e.g. 'Sige, magpapadala ng 1 USDT kay Junjun.' NEVER include JSON keys, field names, technical terms like 'intent', 'type', 'kind', 'oneShot', 'amountFiat', 'fiatCurrency', 'schedule', 'condition', 'recipient', 'hint', or any code-like syntax. Just a friendly spoken confirmation.",
  "intent": {
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
}

TYPE 3 — "exit" (user wants to leave chat):
{ "type": "exit", "text": "goodbye message" }

────────────────────────────────
CRITICAL: WHEN TO USE "payment_intent"
────────────────────────────────
Return "payment_intent" IMMEDIATELY when the user's message contains a recipient AND an amount AND a send-like intent. Do NOT ask for confirmation first. Do NOT respond with "answer" and then wait for them to say yes. Go straight to "payment_intent".

Send-like words in any language: send, padala, transfer, ipadala, magpadala, enviar, 送る, 보내다, 寄, envoyer, senden, etc.

If the message has a recipient + amount, it is a payment command. Return "payment_intent" directly.

Also: if in a PREVIOUS turn you responded with an "answer" that described a payment (e.g. "I'll send 1 USDT to Junjun"), and the user now says "yes", "okay", "sige", "go ahead", "confirm", "do it" — return "payment_intent" for that payment.

────────────────────────────────
EXAMPLES
────────────────────────────────
User: "send 1 USDT to Junjun"
→ {"type":"payment_intent","text":"Sending 1 USDT to Junjun.","intent":{"kind":"oneShot","recipient":{"name":"Junjun","hint":""},"amount":1,"amountFiat":null,"fiatCurrency":null,"token":"USDT","schedule":null,"condition":null,"durationMinutes":null,"totalOccurrences":null}}

User: "send 1 USDT to Junjun after 30 seconds"
→ {"type":"payment_intent","text":"Sending 1 USDT to Junjun after 30 seconds.","intent":{"kind":"oneShot","recipient":{"name":"Junjun","hint":""},"amount":1,"amountFiat":null,"fiatCurrency":null,"token":"USDT","schedule":{"kind":"seconds","value":"30"},"condition":null,"durationMinutes":null,"totalOccurrences":null}}

User: "send 5 USDC to Mama in 2 minutes"
→ {"type":"payment_intent","text":"Sending 5 USDC to Mama in 2 minutes.","intent":{"kind":"oneShot","recipient":{"name":"Mama","hint":""},"amount":5,"amountFiat":null,"fiatCurrency":null,"token":"USDC","schedule":{"kind":"seconds","value":"120"},"condition":null,"durationMinutes":null,"totalOccurrences":null}}

User: "padala 10k kay mama every month, 6 times"
→ {"type":"payment_intent","text":"Magpapadala ng 10,000 USDC kay Mama, monthly, 6 beses.","intent":{"kind":"recurring","recipient":{"name":"Mama","hint":""},"amount":10000,"amountFiat":null,"fiatCurrency":null,"token":"USDC","schedule":{"kind":"monthly","value":"1"},"condition":null,"durationMinutes":null,"totalOccurrences":6}}

User: "send 0.1 USDT to junjun every 30 seconds within 1 minute"
→ {"type":"payment_intent","text":"Sending 0.1 USDT to Junjun every 30 seconds for 1 minute.","intent":{"kind":"recurring","recipient":{"name":"Junjun","hint":""},"amount":0.1,"amountFiat":null,"fiatCurrency":null,"token":"USDT","schedule":{"kind":"seconds","value":"30"},"condition":null,"durationMinutes":1,"totalOccurrences":2}}

User: "what's my balance?"
→ {"type":"answer","text":"You have 0.5 ETH and 1,000 USDC."}

User: "how much did I send to mama?"
→ {"type":"answer","text":"You sent 5,000 USDC to Mama on May 1."}

User: "how much is 1 USDT right now?"
→ {"type":"answer","text":"1 USDT is currently worth about $1.00 or ₱56.18."}

User: "magkano ang presyo ng isang usdt ngayon?"
→ {"type":"answer","text":"Ang 1 USDT ngayon ay nasa ₱56.18 o $1.00."}

────────────────────────────────
SCHEDULE RULES for payment_intent
────────────────────────────────
- schedule.kind MUST be one of: "monthly", "weekly", "daily", "biweekly", "cron", "once", "seconds", "yearly". No other values allowed.
- "after N seconds", "in N seconds", "after N minutes", "in N minutes" → kind: "oneShot" with schedule: {"kind":"seconds","value":"<totalSeconds>"}. Convert minutes to seconds (e.g. "in 2 minutes" → value:"120"). This is a SINGLE delayed payment, NOT recurring.
- "every N seconds" or sub-minute recurring intervals → kind: "recurring" with schedule: {"kind":"seconds","value":"N"}
- "every N minutes" → kind: "cron", value: cron expression (e.g. "*/5 * * * *")
- "every day" → kind: "daily", value: "09:00"
- "every week on Monday" → kind: "weekly", value: "Monday"
- "every month on the 1st" → kind: "monthly", value: "1"
- Immediate one-time with NO delay → schedule: null (oneShot with no schedule)
- For recurring rules, totalOccurrences is REQUIRED and MUST be a positive integer. Calculate from duration ÷ interval.
  If the user does NOT specify how many times or for how long, do NOT return payment_intent.
  Instead return "answer" type asking them to specify (e.g. "How many times should I send this?" or "For how long?").
  NEVER set totalOccurrences to null for recurring rules.
- durationMinutes: set when user specifies duration (e.g. "within 1 minute" → 1)

OTHER RULES:
- When the user asks about balances, rules, transactions, or recipients → "answer" type using account data above.
- "cancel", "exit", "nevermind", "go back" (any language) → "exit" type.
- Default token to USDC if not specified. Default recipient hint to "".
- Keep "text" concise (1-2 sentences) for TTS.
- ALWAYS respond in the same language the user is speaking.`;
}

// ── Main chat action ─────────────────────────────────────────────────────────

export const chat = action({
  args: {
    privyId: v.string(),
    message: v.string(),
    balanceSummary: v.optional(v.string()),
  },
  handler: async (ctx, { privyId, message, balanceSummary }): Promise<{
    type: string;
    text: string;
    intent: any | null;
    chatSessionId: string;
    voiceGender: string;
  }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    // Gather user context
    const context = await ctx.runQuery(internal.chatAgent.getUserContext, { privyId }) as any;
    if (!context) throw new Error("User not found");

    // Get or create chat session
    const existingSession: any = await ctx.runQuery(internal.chatAgent.getActiveChatSession, {
      userId: context.userId,
    });

    const messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> =
      existingSession?.messages ?? [];

    // Add the new user message
    messages.push({
      role: "user" as const,
      content: message,
      timestamp: Date.now(),
    });

    // Fetch live crypto prices
    const priceSummary = await fetchCryptoPrices();

    // Build system prompt with account context
    const systemPrompt = buildChatSystemPrompt({
      displayName: context.displayName ?? undefined,
      walletAddress: context.walletAddress ?? undefined,
      balanceSummary: balanceSummary ?? undefined,
      priceSummary,
      recipients: context.recipients.map((r: any) => ({
        name: r.name,
        email: r.email,
        relationship: r.relationship,
      })),
      rules: context.rules,
      transactions: context.transactions,
    });

    // Build conversation for GPT (last 20 messages for context window)
    const conversationMessages = messages.slice(-20).map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    // Call GPT-4o-mini
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const rawContent = json.choices?.[0]?.message?.content ?? "";

    // Parse the structured response
    let parsed: { type: string; text: string; intent?: any };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // GPT sometimes returns natural text followed by a JSON blob.
      // Try to extract the JSON portion and use the preceding text as-is.
      const jsonStart = rawContent.indexOf("{");
      if (jsonStart > 0) {
        const textBefore = rawContent.slice(0, jsonStart).trim();
        try {
          const jsonPart = JSON.parse(rawContent.slice(jsonStart));
          parsed = {
            type: jsonPart.type ?? "answer",
            text: jsonPart.text ?? textBefore,
            intent: jsonPart.intent,
          };
        } catch {
          // Still can't parse — strip any JSON-like fragments from the text
          parsed = { type: "answer", text: textBefore || rawContent.replace(/\{[\s\S]*$/, "").trim() };
        }
      } else {
        parsed = { type: "answer", text: rawContent };
      }
    }

    // ── Safety net: detect if GPT returned "answer" but user clearly wanted a payment ──
    // GPT-4o-mini often fails to return payment_intent even with explicit instructions.
    // If the response is "answer" but the user message or GPT's text looks like a payment,
    // do a focused second call to extract a structured intent.
    if (parsed.type !== "payment_intent") {
      const lowerMsg = message.toLowerCase();
      const lowerText = (parsed.text ?? "").toLowerCase();
      const combined = lowerMsg + " " + lowerText;

      const hasSendWord = /\b(send|padala|ipadala|magpadala|transfer|bayad|enviar|kirim|送|보내|envoyer|senden)\b/i.test(combined);
      const hasConfirmWord = /\b(kumpirmasyon|confirmation|confirm|magpapadala|will send|i.ll send|sending|sige.*go|okay.*send|go ahead)\b/i.test(combined);
      const hasAmount = /\d/.test(lowerMsg);
      // Also check if user is confirming a previous payment description
      const isConfirming = /^(yes|okay|sige|go ahead|oo|confirm|do it|sure|tama|let.s go|push through|send it|go|oo na|sige na)\b/i.test(lowerMsg.trim());
      const prevAssistantMsg = messages.length >= 3 ? messages[messages.length - 3]?.content ?? "" : "";
      const prevDescribedPayment = /\b(send|padala|magpadala|transfer|kirim)\b/i.test(prevAssistantMsg.toLowerCase()) && /\d/.test(prevAssistantMsg);

      if ((hasSendWord && hasAmount) || (hasConfirmWord && hasAmount) || (isConfirming && prevDescribedPayment)) {
        // User clearly wants to send money — do a focused intent extraction call
        const intentPrompt = `Extract a payment intent from this conversation. The user wants to send crypto.
Return ONLY valid JSON with this exact schema:
{"kind":"recurring"|"conditional"|"oneShot","recipient":{"name":string,"hint":""},"amount":number|null,"amountFiat":number|null,"fiatCurrency":string|null,"token":"USDC"|"USDT"|"ETH"|"HTT","schedule":{"kind":"monthly"|"weekly"|"daily"|"biweekly"|"cron"|"once"|"seconds"|"yearly","value":string}|null,"condition":null,"durationMinutes":number|null,"totalOccurrences":number|null}

Rules:
- Default token to USDC if not specified.
- "after N seconds/minutes", "in N seconds/minutes" → kind: "oneShot" with schedule: {"kind":"seconds","value":"<totalSeconds>"}. This is a SINGLE delayed payment.
- "every N seconds" → kind: "recurring" with schedule: {"kind":"seconds","value":"N"}
- For recurring, totalOccurrences is required. Calculate from duration ÷ interval.
- If immediate/one-time with NO delay, set schedule to null and kind to "oneShot".
- Return ONLY the JSON object, nothing else.`;

        // Combine recent conversation for context
        const recentContext = messages.slice(-6).map((m: any) => `${m.role}: ${m.content}`).join("\n");

        const intentRes = await fetch(OPENAI_CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 300,
            messages: [
              { role: "system", content: intentPrompt },
              { role: "user", content: recentContext },
            ],
          }),
        });

        if (intentRes.ok) {
          const intentJson = (await intentRes.json()) as {
            choices: { message: { content: string } }[];
          };
          const intentRaw = intentJson.choices?.[0]?.message?.content ?? "";
          try {
            const intent = JSON.parse(intentRaw);
            if (intent.recipient?.name && (intent.amount || intent.amountFiat)) {
              // Successfully extracted intent — override to payment_intent
              parsed = {
                type: "payment_intent",
                text: parsed.text, // keep the original confirmation text for TTS
                intent,
              };
            }
          } catch {
            // Intent extraction failed, keep original answer
          }
        }
      }
    }

    // Post-process: fix GPT missing "after N seconds/minutes" delay in payment intents.
    if (parsed.type === "payment_intent" && parsed.intent?.kind === "oneShot" && !parsed.intent.schedule) {
      const delaySecs = extractDelaySeconds(message);
      if (delaySecs) {
        parsed.intent.schedule = { kind: "seconds", value: String(delaySecs) };
      }
    }

    // Post-process: fix GPT defaulting token to USDC when user explicitly named a different token.
    if (parsed.type === "payment_intent" && parsed.intent) {
      const extractedToken = extractTokenFromTranscript(message);
      if (extractedToken && (parsed.intent.token === "USDC" || !parsed.intent.token)) {
        parsed.intent.token = extractedToken;
      }
    }

    // Fiat-to-token conversion for payment intents (e.g., "20 pesos worth of USDT")
    if (parsed.type === "payment_intent" && parsed.intent?.amountFiat && parsed.intent?.fiatCurrency) {
      const token = parsed.intent.token ?? "USDC";
      const result = await convertFiatToToken(parsed.intent.amountFiat, parsed.intent.fiatCurrency, token);
      if ("error" in result) {
        // Fall back to answer with the error
        parsed = { type: "answer", text: result.error };
      } else {
        parsed.intent.amount = result.amount;
        parsed.intent.conversionRate = result.conversionRate;
      }
    }

    // Sanitize payment_intent text — if GPT included JSON-like terms, replace with a clean readback
    if (parsed.type === "payment_intent" && parsed.intent) {
      const jsonTerms = /\b(intent|oneShot|amountFiat|fiatCurrency|totalOccurrences|durationMinutes|"kind"|"type"|"hint"|"schedule"|"condition")\b/i;
      if (jsonTerms.test(parsed.text) || parsed.text.includes("{") || parsed.text.includes("}")) {
        const name = parsed.intent.recipient?.name ?? "recipient";
        const amount = (parsed.intent.amount ?? parsed.intent.amountUsdc)?.toLocaleString() ?? "?";
        const tok = parsed.intent.token ?? "USDC";
        parsed.text = `Sige, magpapadala ng ${amount} ${tok} kay ${name}. I-confirm mo lang.`;
      }
    }

    // Final safety: strip any JSON fragments from text (for all response types)
    if (parsed.text && (parsed.text.includes("{") || parsed.text.includes("}"))) {
      // Remove any JSON object substring from the text
      parsed.text = parsed.text.replace(/\{[^{}]*("type"|"kind"|"intent"|"recipient")[^{}]*\}/g, "").trim();
      // If nested JSON remains, strip everything from first { onward
      if (parsed.text.includes("{")) {
        parsed.text = parsed.text.replace(/\{[\s\S]*$/, "").trim();
      }
      // If text is now empty, provide a fallback
      if (!parsed.text) {
        parsed.text = parsed.type === "payment_intent" && parsed.intent
          ? `Sige, magpapadala ng ${(parsed.intent.amount ?? parsed.intent.amountUsdc)?.toLocaleString() ?? "?"} ${parsed.intent.token ?? "USDC"} kay ${parsed.intent.recipient?.name ?? "recipient"}. I-confirm mo lang.`
          : "Okay, noted.";
      }
    }

    // Require totalOccurrences for recurring payment intents — ask for clarification if missing
    if (parsed.type === "payment_intent" && parsed.intent?.kind === "recurring"
        && (!parsed.intent.totalOccurrences || parsed.intent.totalOccurrences <= 0)) {
      parsed = {
        type: "answer",
        text: "How many times should I send this, or for how long? For example, 'for 6 months' or '3 times'.",
      };
    }

    // Add assistant response to messages
    messages.push({
      role: "assistant" as const,
      content: parsed.text,
      timestamp: Date.now(),
    });

    // Save to chat session
    const chatSessionId: string = await ctx.runMutation(internal.chatAgent.upsertChatSession, {
      sessionId: existingSession?._id,
      userId: context.userId,
      messages,
    });

    return {
      type: parsed.type ?? "answer",
      text: parsed.text ?? rawContent,
      intent: parsed.intent ?? null,
      chatSessionId,
      voiceGender: context.voiceGender,
    };
  },
});

// ── Close chat session ──────────────────────────────────────────────────────

export const closeSession = internalMutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, { sessionId }) => {
    await ctx.db.patch(sessionId, { status: "closed" });
  },
});
