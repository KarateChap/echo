import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { buildChatSystemPrompt, fetchCryptoPrices } from "./chatAgent";
import { convertFiatToToken } from "./fiatConversion";
import { extractDelaySeconds } from "./delayExtractor";
import { extractTokenFromTranscript } from "./tokenExtractor";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
} as const;

const SYSTEM_PROMPT = `You evaluate whether a spoken remittance instruction is semantically complete.
A complete instruction MUST have:
1. A recipient (a name or relationship like "wife", "mama", "ate", "papa", "John")
2. An amount (a number, e.g. "10", "1000", "10k", "sampung libo")

Optionally it may also include a schedule, condition, or token type — these are NOT required for completeness.

The transcript may be in Taglish (mixed Tagalog and English). It may contain filler words, stutters, or partial words from real-time speech recognition — focus on whether the core instruction (recipient + amount) is present.

Reply ONLY with the single word "yes" or "no". Nothing else.`;

const http = httpRouter();

http.route({
  path: "/api/checkCompleteness",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ complete: false }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    try {
      const { transcript, selectedToken } = (await request.json()) as {
        transcript: string;
        selectedToken: string | null;
      };

      if (!transcript || transcript.trim().length < 3) {
        return new Response(JSON.stringify({ complete: false }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const userMsg = selectedToken
        ? `Token: ${selectedToken}. Transcript: "${transcript}"`
        : `Transcript: "${transcript}"`;

      const res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 1,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
        }),
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ complete: false }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const json = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      const answer = (json.choices?.[0]?.message?.content ?? "").trim().toLowerCase();

      return new Response(JSON.stringify({ complete: answer === "yes" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    } catch {
      return new Response(JSON.stringify({ complete: false }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }),
});

// CORS preflight
http.route({
  path: "/api/checkCompleteness",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Voice Email Parsing ───────────────────────────────────────────────────────
const EMAIL_PARSE_PROMPT = `You extract email addresses from spoken text. The user dictated an email address out loud.
Common patterns:
- "mama at gmail dot com" → "mama@gmail.com"
- "john underscore doe at yahoo dot com" → "john_doe@yahoo.com"
- "maria 123 at hotmail dot com" → "maria123@hotmail.com"
- "r a l p h at gmail dot com" → "ralph@gmail.com"
- "mama dot garcia at gmail dot com" → "mama.garcia@gmail.com"
- "test at pay dash echo dot space" → "test@pay-echo.space"
- "mama at g mail dot com" → "mama@gmail.com"

Rules:
- "at" or "at sign" → @
- "dot" or "period" → .
- "underscore" → _
- "dash" or "hyphen" → -
- Spelled-out letters like "r a l p h" should be joined: "ralph"
- Numbers spoken as words should become digits: "one two three" → "123"

Reply ONLY with the email address. If you cannot extract a valid email, reply with "INVALID".`;

http.route({
  path: "/api/parseEmail",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ email: null }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    try {
      const { transcript } = (await request.json()) as { transcript: string };
      if (!transcript || transcript.trim().length < 3) {
        return new Response(JSON.stringify({ email: null }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
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
          max_tokens: 50,
          messages: [
            { role: "system", content: EMAIL_PARSE_PROMPT },
            { role: "user", content: transcript },
          ],
        }),
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ email: null }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const json = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      const answer = (json.choices?.[0]?.message?.content ?? "").trim();
      const email = answer === "INVALID" ? null : answer;

      return new Response(JSON.stringify({ email }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      return new Response(JSON.stringify({ email: null }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }),
});

http.route({
  path: "/api/parseEmail",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Fast TTS endpoint ─────────────────────────────────────────────────────────
// Tries ElevenLabs first (faster), falls back to OpenAI TTS if not configured.
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

http.route({
  path: "/api/tts",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    try {
      const { text, voice } = (await request.json()) as { text: string; voice?: "male" | "female" };
      if (!text) {
        return new Response(JSON.stringify({ error: "Missing text" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const isMale = voice === "male";

      // Try ElevenLabs first (faster turbo model)
      const elevenKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = isMale
        ? process.env.ELEVENLABS_VOICE_ID_MARK
        : process.env.ELEVENLABS_VOICE_ID_HOPE;

      if (elevenKey && voiceId) {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_22050_32&optimize_streaming_latency=3`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": elevenKey,
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_flash_v2_5",
              voice_settings: { stability: 0.4, similarity_boost: 0.9, style: 0.5, use_speaker_boost: true },
              chunk_length_schedule: [120, 160, 250, 290],
            }),
          },
        );

        if (res.ok && res.body) {
          return new Response(res.body, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Transfer-Encoding": "chunked",
              ...CORS_HEADERS,
            },
          });
        }
        console.warn(`ElevenLabs TTS failed (${res.status}), falling back to OpenAI TTS`);
      }

      // Fallback: OpenAI TTS
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return new Response(JSON.stringify({ error: "No TTS provider configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const res = await fetch(OPENAI_TTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          voice: isMale ? "echo" : "shimmer",
          input: text,
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error(`OpenAI TTS ${res.status}: ${detail.slice(0, 200)}`);
        return new Response(JSON.stringify({ error: "TTS generation failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const audioBuffer = await res.arrayBuffer();
      return new Response(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audioBuffer.byteLength),
          ...CORS_HEADERS,
        },
      });
    } catch (e) {
      console.error("TTS error:", e);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }),
});

http.route({
  path: "/api/tts",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Chat Agent ───────────────────────────────────────────────────────────────

http.route({
  path: "/api/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { privyId, message, balanceSummary } = (await request.json()) as {
        privyId: string;
        message: string;
        balanceSummary?: string;
      };

      if (!privyId || !message) {
        return new Response(JSON.stringify({ error: "Missing privyId or message" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const result = await ctx.runAction(api.chatAgent.chat, {
        privyId,
        message,
        balanceSummary,
      });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch (e: any) {
      console.error("Chat agent error:", e);
      return new Response(
        JSON.stringify({
          type: "answer",
          text: "Sorry, may problema ako ngayon. Try mo ulit.",
          intent: null,
          chatSessionId: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    }
  }),
});

http.route({
  path: "/api/chat",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Token Prices + FX Rates ──────────────────────────────────────────────────
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin&vs_currencies=usd,php,eur,gbp,jpy,sgd,krw,aud,cad,chf,cny,hkd,inr,idr,myr,nzd,thb,twd,vnd,aed,sar,brl,mxn,zar";

const SUPPORTED_CURRENCIES = [
  "PHP", "USD", "EUR", "GBP", "JPY", "SGD", "KRW",
  "AUD", "CAD", "CHF", "CNY", "HKD", "INR", "IDR",
  "MYR", "NZD", "THB", "TWD", "VND", "AED", "SAR",
  "BRL", "MXN", "ZAR",
];

let priceCache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 60_000; // 60 seconds

http.route({
  path: "/api/prices",
  method: "GET",
  handler: httpAction(async () => {
    try {
      // Return cached data if fresh
      if (priceCache && Date.now() - priceCache.ts < CACHE_TTL) {
        return new Response(JSON.stringify(priceCache.data), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      let eth: Record<string, number> = {};
      let usdCoin: Record<string, number> = {};

      // Try CoinGecko first
      const res = await fetch(COINGECKO_URL);
      if (res.ok) {
        const json = (await res.json()) as Record<string, Record<string, number>>;
        eth = json["ethereum"] ?? {};
        usdCoin = json["usd-coin"] ?? {};
      } else {
        console.warn(`CoinGecko /api/prices returned ${res.status}, trying fallbacks`);
      }

      // Fallback: if CoinGecko failed, try CryptoCompare for ETH + FX rates for stablecoins
      if (!eth.usd || !usdCoin.usd) {
        try {
          const ccCurrencies = SUPPORTED_CURRENCIES.join(",");
          // ETH prices
          const ethRes = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=${ccCurrencies}`);
          if (ethRes.ok) {
            const ethData = (await ethRes.json()) as Record<string, number>;
            for (const c of SUPPORTED_CURRENCIES) eth[c.toLowerCase()] = ethData[c] ?? 0;
          }
          // Stablecoin prices ≈ USD FX rates
          const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
          if (fxRes.ok) {
            const fxData = (await fxRes.json()) as { rates: Record<string, number> };
            for (const c of SUPPORTED_CURRENCIES) {
              usdCoin[c.toLowerCase()] = c === "USD" ? 1 : (fxData.rates?.[c] ?? 0);
            }
          }
        } catch (e) {
          console.warn("Fallback price fetch failed:", e);
        }
      }

      // If still empty after all fallbacks, return stale cache or null
      if (!eth.usd && !usdCoin.usd) {
        if (priceCache) {
          return new Response(JSON.stringify(priceCache.data), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }
        return new Response(JSON.stringify({ prices: null, currencies: SUPPORTED_CURRENCIES }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // Build price map — USDT mirrors USDC (both stablecoins), HTT = 0
      const zeroPrices: Record<string, number> = {};
      for (const c of SUPPORTED_CURRENCIES) zeroPrices[c.toLowerCase()] = 0;

      const result = {
        prices: {
          ETH: eth,
          USDC: usdCoin,
          USDT: usdCoin, // same as USDC (pegged stablecoin)
          HTT: zeroPrices,
        },
        currencies: SUPPORTED_CURRENCIES,
        updatedAt: Date.now(),
      };

      priceCache = { data: result, ts: Date.now() };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      if (priceCache) {
        return new Response(JSON.stringify(priceCache.data), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      return new Response(JSON.stringify({ prices: null, currencies: SUPPORTED_CURRENCIES }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }),
});

http.route({
  path: "/api/prices",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Streaming Chat (lower latency — inlines LLM call, uses OpenAI streaming) ─

http.route({
  path: "/api/chat-stream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { privyId, message, balanceSummary } = (await request.json()) as {
        privyId: string;
        message: string;
        balanceSummary?: string;
      };

      if (!privyId || !message) {
        return new Response(JSON.stringify({ error: "Missing privyId or message" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // Gather context (fast queries, ~100ms)
      const context = (await ctx.runQuery(internal.chatAgent.getUserContext, { privyId })) as any;
      if (!context) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const existingSession: any = await ctx.runQuery(internal.chatAgent.getActiveChatSession, {
        userId: context.userId,
      });

      const messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> =
        existingSession?.messages ?? [];

      messages.push({ role: "user" as const, content: message, timestamp: Date.now() });

      // Fetch live crypto prices so agent can answer price questions
      const priceSummary = await fetchCryptoPrices();

      const systemPrompt = buildChatSystemPrompt({
        displayName: context.displayName ?? undefined,
        walletAddress: context.walletAddress ?? undefined,
        balanceSummary: balanceSummary ?? undefined,
        priceSummary,
        recipients: context.recipients.map((r: any) => ({
          name: r.name, email: r.email, relationship: r.relationship,
        })),
        rules: context.rules,
        transactions: context.transactions,
      });

      const conversationMessages = messages.slice(-20).map((m: any) => ({
        role: m.role, content: m.content,
      }));

      // Stream from OpenAI — faster total response time than non-streaming
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
          stream: true,
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

      // Accumulate streamed tokens
      let rawContent = "";
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) rawContent += delta;
          } catch {
            // skip malformed chunks
          }
        }
      }

      // Parse the response
      let parsed: { type: string; text: string; intent?: any };
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        parsed = { type: "answer", text: rawContent };
      }

      // Safety net: detect missed payment intents
      if (parsed.type !== "payment_intent") {
        const lowerMsg = message.toLowerCase();
        const lowerText = (parsed.text ?? "").toLowerCase();
        const combined = lowerMsg + " " + lowerText;

        const hasSendWord = /\b(send|padala|ipadala|magpadala|transfer|bayad|enviar|kirim|送|보내|envoyer|senden)\b/i.test(combined);
        const hasConfirmWord = /\b(kumpirmasyon|confirmation|confirm|magpapadala|will send|i.ll send|sending|sige.*go|okay.*send|go ahead)\b/i.test(combined);
        const hasAmount = /\d/.test(lowerMsg);
        const isConfirming = /^(yes|okay|sige|go ahead|oo|confirm|do it|sure|tama|let.s go|push through|send it|go|oo na|sige na)\b/i.test(lowerMsg.trim());
        const prevAssistantMsg = messages.length >= 3 ? messages[messages.length - 3]?.content ?? "" : "";
        const prevDescribedPayment = /\b(send|padala|magpadala|transfer|kirim)\b/i.test(prevAssistantMsg.toLowerCase()) && /\d/.test(prevAssistantMsg);

        if ((hasSendWord && hasAmount) || (hasConfirmWord && hasAmount) || (isConfirming && prevDescribedPayment)) {
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
            const intentJson = (await intentRes.json()) as { choices: { message: { content: string } }[] };
            const intentRaw = intentJson.choices?.[0]?.message?.content ?? "";
            try {
              const intent = JSON.parse(intentRaw);
              if (intent.recipient?.name && (intent.amount || intent.amountFiat)) {
                parsed = { type: "payment_intent", text: parsed.text, intent };
              }
            } catch {
              // keep original answer
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

      // Fiat-to-token conversion
      if (parsed.type === "payment_intent" && parsed.intent?.amountFiat && parsed.intent?.fiatCurrency) {
        const token = parsed.intent.token ?? "USDC";
        const result = await convertFiatToToken(parsed.intent.amountFiat, parsed.intent.fiatCurrency, token);
        if ("error" in result) {
          parsed = { type: "answer", text: result.error };
        } else {
          parsed.intent.amount = result.amount;
          parsed.intent.conversionRate = result.conversionRate;
        }
      }

      // Sanitize payment_intent text
      if (parsed.type === "payment_intent" && parsed.intent) {
        const jsonTerms = /\b(intent|oneShot|amountFiat|fiatCurrency|totalOccurrences|durationMinutes|"kind"|"type"|"hint"|"schedule"|"condition")\b/i;
        if (jsonTerms.test(parsed.text) || parsed.text.includes("{") || parsed.text.includes("}")) {
          const name = parsed.intent.recipient?.name ?? "recipient";
          const amount = (parsed.intent.amount ?? parsed.intent.amountUsdc)?.toLocaleString() ?? "?";
          const tok = parsed.intent.token ?? "USDC";
          parsed.text = `Sige, magpapadala ng ${amount} ${tok} kay ${name}. I-confirm mo lang.`;
        }
      }

      // Add assistant response
      messages.push({ role: "assistant" as const, content: parsed.text, timestamp: Date.now() });

      // Save session (fire-and-forget — don't block the response)
      ctx.runMutation(internal.chatAgent.upsertChatSession, {
        sessionId: existingSession?._id,
        userId: context.userId,
        messages,
      });

      return new Response(
        JSON.stringify({
          type: parsed.type ?? "answer",
          text: parsed.text ?? rawContent,
          intent: parsed.intent ?? null,
          chatSessionId: existingSession?._id ?? null,
          voiceGender: context.voiceGender,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    } catch (e: any) {
      console.error("Chat stream error:", e);
      return new Response(
        JSON.stringify({
          type: "answer",
          text: "Sorry, may problema ako ngayon. Try mo ulit.",
          intent: null,
          chatSessionId: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    }
  }),
});

http.route({
  path: "/api/chat-stream",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Lightweight Whisper transcription for chat fallback ─────────────────────
// Used when Web Speech API fails on mobile — sends audio to Whisper directly.

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

http.route({
  path: "/api/transcribeForChat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { storageId } = (await request.json()) as { storageId: string };
      if (!storageId) {
        return new Response(JSON.stringify({ transcript: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ transcript: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const audioBlob = await ctx.storage.get(storageId as any);
      if (!audioBlob) {
        return new Response(JSON.stringify({ transcript: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const form = new FormData();
      form.append("file", audioBlob, "audio.webm");
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json");

      const res = await fetch(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ transcript: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const json = (await res.json()) as { text: string };
      return new Response(JSON.stringify({ transcript: json.text?.trim() ?? "" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      return new Response(JSON.stringify({ transcript: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }),
});

http.route({
  path: "/api/transcribeForChat",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

export default http;
