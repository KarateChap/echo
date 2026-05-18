import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    privyId: v.string(),
    audioStorageId: v.id("_storage"),
    selectedToken: v.optional(v.string()),
  },
  handler: async (ctx, { privyId, audioStorageId, selectedToken }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    const sessionId = await ctx.db.insert("voiceSessions", {
      ownerId: user._id,
      audioStorageId,
      selectedToken,
      status: "transcribing",
    });

    // Fire off Whisper transcription asynchronously.
    await ctx.scheduler.runAfter(0, internal.transcribe.transcribeAudio, {
      sessionId,
      audioStorageId,
    });

    return sessionId;
  },
});

export const setTranscript = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    transcript: v.string(),
  },
  handler: async (ctx, { sessionId, transcript }) => {
    await ctx.db.patch(sessionId, { transcript, status: "parsing" });

    // Chain: kick off intent parsing immediately.
    const session = await ctx.db.get(sessionId);
    await ctx.scheduler.runAfter(0, internal.parseIntent.parseIntent, {
      sessionId,
      transcript,
      selectedToken: session?.selectedToken,
    });
  },
});

export const setReadback = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    readbackStorageId: v.string(),
  },
  handler: async (ctx, { sessionId, readbackStorageId }) => {
    await ctx.db.patch(sessionId, {
      readbackStorageId: readbackStorageId as any,
    });
  },
});

export const setIntent = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    intent: v.string(),
  },
  handler: async (ctx, { sessionId, intent }) => {
    await ctx.db.patch(sessionId, { intent, status: "ready" });

    // Build a human-friendly confirmation sentence for TTS readback.
    try {
      const parsed = JSON.parse(intent);
      if (parsed.error) return;
      const session = await ctx.db.get(sessionId);
      const name = parsed.recipient?.name ?? "the recipient";
      const amount = (parsed.amount ?? parsed.amountUsdc)?.toLocaleString() ?? "?";
      const token = session?.selectedToken ?? parsed.token ?? "USDC";

      let scheduleLabel = "";
      if (parsed.schedule) {
        const s = parsed.schedule;
        if (s.kind === "monthly") {
          if (s.value === "last") {
            scheduleLabel = "every month on the last day";
          } else {
            const ord = ["1","21","31"].includes(s.value) ? "st" : ["2","22"].includes(s.value) ? "nd" : ["3","23"].includes(s.value) ? "rd" : "th";
            scheduleLabel = `every month on the ${s.value}${ord}`;
          }
        } else if (s.kind === "weekly") {
          scheduleLabel = `every ${s.value}`;
        } else if (s.kind === "daily") {
          scheduleLabel = "every day";
        } else if (s.kind === "biweekly") {
          scheduleLabel = `every other ${s.value}`;
        } else if (s.kind === "once") {
          const d = new Date(s.value + "T00:00:00");
          if (!isNaN(d.getTime())) {
            scheduleLabel = `on ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
          } else {
            scheduleLabel = `on ${s.value}`;
          }
        } else {
          scheduleLabel = "on the schedule you described";
        }
      }

      const kindLabel =
        parsed.kind === "recurring" ? scheduleLabel || "on a recurring schedule"
        : parsed.kind === "conditional" ? `whenever ${name}'s wallet drops below the threshold`
        : scheduleLabel ? scheduleLabel  // future one-shot with "once" schedule
        : "right away";
      const sentence = `Got it. Sending ${amount} ${token} to ${name}, ${kindLabel}. Please confirm to proceed.`;

      await ctx.scheduler.runAfter(0, internal.synthesize.synthesizeSpeech, {
        sessionId,
        text: sentence,
      });
    } catch {
      // If JSON parse fails, skip readback
    }
  },
});

export const setError = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    error: v.string(),
  },
  handler: async (ctx, { sessionId, error }) => {
    await ctx.db.patch(sessionId, { status: "error", error });
  },
});

export const get = query({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const audioUrl = session.audioStorageId
      ? await ctx.storage.getUrl(session.audioStorageId)
      : null;
    const readbackUrl = session.readbackStorageId
      ? await ctx.storage.getUrl(session.readbackStorageId)
      : null;
    return { ...session, audioUrl, readbackUrl };
  },
});
