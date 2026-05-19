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
    preTranscript: v.optional(v.string()),
  },
  handler: async (ctx, { privyId, audioStorageId, selectedToken, preTranscript }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    const sessionId = await ctx.db.insert("voiceSessions", {
      ownerId: user._id,
      audioStorageId,
      selectedToken,
      preTranscript: preTranscript || undefined,
      status: "transcribing",
    });

    // Fire off Whisper transcription asynchronously.
    await ctx.scheduler.runAfter(0, internal.transcribe.transcribeAudio, {
      sessionId,
      audioStorageId,
    });

    // Speculative parsing: if we have a pre-transcript from Web Speech API,
    // start intent parsing immediately in parallel with Whisper.
    // This saves 2-3s when the browser transcript is accurate enough.
    if (preTranscript && preTranscript.trim().length > 10) {
      await ctx.scheduler.runAfter(0, internal.parseIntent.parseIntent, {
        sessionId,
        transcript: preTranscript.trim(),
        selectedToken,
      });
    }

    return sessionId;
  },
});

export const setTranscript = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    transcript: v.string(),
  },
  handler: async (ctx, { sessionId, transcript }) => {
    const session = await ctx.db.get(sessionId);

    // If speculative parse already completed (intent is set) and Whisper transcript
    // is similar to the pre-transcript, skip re-parsing — the speculative result is good.
    if (session?.speculativeParseDone && session.intent && session.preTranscript) {
      const similarity = computeSimilarity(session.preTranscript.toLowerCase(), transcript.toLowerCase());
      if (similarity >= 0.7) {
        // Transcripts are similar enough — just update the transcript, keep existing intent
        await ctx.db.patch(sessionId, { transcript });
        return;
      }
      // Transcripts diverged — need to re-parse with the more accurate Whisper transcript
    }

    await ctx.db.patch(sessionId, { transcript, status: "parsing" });

    // Chain: kick off intent parsing with the accurate Whisper transcript.
    await ctx.scheduler.runAfter(0, internal.parseIntent.parseIntent, {
      sessionId,
      transcript,
      selectedToken: session?.selectedToken,
    });
  },
});

/** Simple word-overlap similarity (Jaccard index on words). */
function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

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
    // Build a human-friendly confirmation sentence for TTS readback.
    let readbackText: string | undefined;
    try {
      const parsed = JSON.parse(intent);
      if (!parsed.error) {
        const session = await ctx.db.get(sessionId);
        const name = parsed.recipient?.name ?? "the recipient";
        const amount = (parsed.amount ?? parsed.amountUsdc)?.toLocaleString() ?? "?";
        const token = session?.selectedToken ?? parsed.token ?? "Unknown";

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
          } else if (s.kind === "seconds") {
            const n = parseInt(s.value);
            scheduleLabel = n === 1 ? "every second" : `every ${n} seconds`;
          } else if (s.kind === "yearly") {
            const [month, day] = s.value.split("-").map(Number);
            const date = new Date(2000, month - 1, day);
            const monthName = date.toLocaleDateString("en-US", { month: "long" });
            scheduleLabel = `every year on ${monthName} ${day}`;
          } else if (s.kind === "cron") {
            const parts = s.value.trim().split(/\s+/);
            if (parts.length === 5) {
              const [min, hour] = parts;
              const minStep = min.match(/^\*\/(\d+)$/);
              const hourStep = hour.match(/^\*\/(\d+)$/);
              if (min === "*" && hour === "*") {
                scheduleLabel = "every minute";
              } else if (minStep) {
                const n = parseInt(minStep[1]);
                scheduleLabel = n === 1 ? "every minute" : `every ${n} minutes`;
              } else if (hourStep) {
                const n = parseInt(hourStep[1]);
                scheduleLabel = n === 1 ? "every hour" : `every ${n} hours`;
              } else {
                scheduleLabel = "on the schedule you described";
              }
            } else {
              scheduleLabel = "on the schedule you described";
            }
          } else {
            scheduleLabel = "on the schedule you described";
          }
        }

        // Append duration or occurrence info
        if (parsed.totalOccurrences) {
          scheduleLabel += `, ${parsed.totalOccurrences} times`;
        } else if (parsed.durationMinutes) {
          scheduleLabel += parsed.durationMinutes < 60
            ? `, for the next ${parsed.durationMinutes} minutes`
            : `, for the next ${Math.round(parsed.durationMinutes / 60)} hours`;
        }

        const kindLabel =
          parsed.kind === "recurring" ? scheduleLabel || "on a recurring schedule"
          : parsed.kind === "conditional" ? `whenever ${name}'s wallet drops below the threshold`
          : scheduleLabel ? scheduleLabel
          : "right away";
        readbackText = `Got it. Sending ${amount} ${token} to ${name}, ${kindLabel}. Please confirm to proceed.`;
      }
    } catch {
      // If JSON parse fails, skip readback
    }

    // Check if this is the speculative parse completing (session has preTranscript, Whisper hasn't finished yet)
    const currentSession = await ctx.db.get(sessionId);
    const isSpeculativeParse = !!currentSession?.preTranscript && currentSession.status === "transcribing";

    // If speculative parse returned an error, DON'T commit it — wait for Whisper's
    // more accurate transcript to re-parse. The interim transcript from Web Speech API
    // can be garbled, so we only accept speculative results that succeed.
    let parsedHasError = false;
    try { parsedHasError = !!JSON.parse(intent).error; } catch { parsedHasError = true; }

    if (isSpeculativeParse && parsedHasError) {
      // Mark that speculative parse ran but failed — Whisper will re-parse
      await ctx.db.patch(sessionId, { speculativeParseDone: false });
      return;
    }

    // Save intent + readbackText to the session immediately so frontend can start streaming TTS
    await ctx.db.patch(sessionId, {
      intent,
      status: "ready",
      readbackText,
      ...(isSpeculativeParse ? { speculativeParseDone: true } : {}),
    });

    // Schedule background TTS synthesis for the Replay button (stored audio)
    if (readbackText) {
      await ctx.scheduler.runAfter(0, internal.synthesize.synthesizeSpeech, {
        sessionId,
        text: readbackText,
      });
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
