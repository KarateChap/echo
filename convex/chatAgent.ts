import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

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

function buildChatSystemPrompt(context: {
  displayName?: string;
  walletAddress?: string;
  balanceSummary?: string;
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
Reply ONLY with valid JSON — no markdown, no explanation:

For general questions/answers:
{ "type": "answer", "text": "your response here" }

For payment/send commands (ONLY when the user explicitly commands a transfer like "send", "padala", "transfer"):
{
  "type": "payment_intent",
  "text": "confirmation readback",
  "intent": {
    "kind": "recurring" | "conditional" | "oneShot",
    "recipient": { "name": string, "hint": string },
    "amount": number | null,
    "amountFiat": number | null,
    "fiatCurrency": string | null,
    "token": "USDC" | "USDT" | "ETH" | "HTT",
    "schedule": { "kind": string, "value": string } | null,
    "condition": { "walletBelowUsdc": number, "topUpUsdc": number, "direction": "below" | "above" } | null,
    "durationMinutes": number | null,
    "totalOccurrences": number | null
  }
}

For exit/goodbye:
{ "type": "exit", "text": "goodbye message" }

IMPORTANT RULES:
- ONLY return "payment_intent" when the user explicitly says to SEND/PADALA/TRANSFER money (or the equivalent command in their language, e.g. "送って" in Japanese, "보내" in Korean, "enviar" in Spanish). Questions about past payments are "answer" type.
- When the user asks about balances, rules, transactions, or recipients, use the account data above to answer accurately.
- If the user says "cancel", "exit", "nevermind", "go back" (or the equivalent in their language), return type "exit".
- For payment intents, follow the same parsing rules as the main intent parser: require recipient + amount, default token to USDC if not specified.
- Keep "text" responses concise for TTS — max 2-3 sentences.
- ALWAYS respond in the same language the user is speaking. This is critical for TTS to sound natural.`;
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

    // Build system prompt with account context
    const systemPrompt = buildChatSystemPrompt({
      displayName: context.displayName ?? undefined,
      walletAddress: context.walletAddress ?? undefined,
      balanceSummary: balanceSummary ?? undefined,
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
      // If GPT didn't return valid JSON, wrap it as an answer
      parsed = { type: "answer", text: rawContent };
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
