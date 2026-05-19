import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

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
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": elevenKey,
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_turbo_v2",
              voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true },
            }),
          },
        );

        if (res.ok) {
          const audioBuffer = await res.arrayBuffer();
          return new Response(audioBuffer, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Length": String(audioBuffer.byteLength),
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

export default http;
