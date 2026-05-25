import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

export const synthesizeSpeech = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    text: v.string(),
    voiceGender: v.optional(v.union(v.literal("female"), v.literal("male"))),
  },
  handler: async (ctx, { sessionId, text, voiceGender }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return;
    }

    try {
      const res = await fetch(OPENAI_TTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          voice: voiceGender === "male" ? "echo" : "shimmer",
          input: text,
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error(`OpenAI TTS ${res.status}: ${detail.slice(0, 200)}`);
        return;
      }

      const audioBuffer = await res.arrayBuffer();
      const blob = new Blob([audioBuffer], { type: "audio/mpeg" });

      const uploadUrl = await ctx.storage.generateUploadUrl();
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "audio/mpeg" },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload readback audio");

      const { storageId } = (await uploadRes.json()) as { storageId: string };

      await ctx.runMutation(internal.voiceSessions.setReadback, {
        sessionId,
        readbackStorageId: storageId,
      });
    } catch (e) {
      console.error("Readback synthesis failed:", e);
    }
  },
});
