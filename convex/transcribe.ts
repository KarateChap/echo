import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

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
      form.append("file", audioBlob, "audio.webm");
      form.append("model", "whisper-1");
      form.append("language", "tl"); // Tagalog hint; Whisper still handles English code-switching
      form.append("response_format", "json");

      const res = await fetch(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Whisper ${res.status}: ${detail.slice(0, 200)}`);
      }

      const json = (await res.json()) as { text: string };
      const transcript = json.text?.trim() ?? "";

      await ctx.runMutation(internal.voiceSessions.setTranscript, {
        sessionId,
        transcript,
      });
    } catch (e) {
      await ctx.runMutation(internal.voiceSessions.setError, {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
