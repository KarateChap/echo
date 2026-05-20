import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

/** Map MIME type to file extension for Whisper filename hint. */
function mimeToExt(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

/** Map Whisper's full language name to ISO 639-1 code. */
const LANG_NAME_TO_CODE: Record<string, string> = {
  tagalog: "tl",
  english: "en",
  japanese: "ja",
  chinese: "zh",
  korean: "ko",
  cebuano: "ceb",
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  italian: "it",
  russian: "ru",
  arabic: "ar",
  hindi: "hi",
  thai: "th",
  vietnamese: "vi",
  indonesian: "id",
  malay: "ms",
  dutch: "nl",
  turkish: "tr",
};

export const transcribeAudio = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    audioStorageId: v.id("_storage"),
  },
  handler: async (ctx, { sessionId, audioStorageId }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.voiceSessions.setError, {
        sessionId,
        error: "OPENAI_API_KEY not set in Convex env",
      });
      return;
    }

    try {
      const audioBlob = await ctx.storage.get(audioStorageId);
      if (!audioBlob) throw new Error("Audio blob missing from storage");

      const form = new FormData();
      const ext = mimeToExt(audioBlob.type ?? "");
      form.append("file", audioBlob, `audio.${ext}`);
      form.append("model", "whisper-1");
      // No language hint — let Whisper auto-detect the spoken language
      form.append("response_format", "verbose_json");

      const res = await fetch(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Whisper ${res.status}: ${detail.slice(0, 200)}`);
      }

      const json = (await res.json()) as { text: string; language?: string };
      const transcript = json.text?.trim() ?? "";

      // Map Whisper's detected language name to ISO code
      const langName = (json.language ?? "").toLowerCase();
      const detectedLanguage = LANG_NAME_TO_CODE[langName] ?? "en";

      await ctx.runMutation(internal.voiceSessions.setTranscript, {
        sessionId,
        transcript,
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
