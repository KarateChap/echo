import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

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

export default http;
