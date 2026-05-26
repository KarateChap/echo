import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sanitizeNumbersForTts } from "./numberSanitizer";
import { parseMonthDay } from "./dateUtils";

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
    detectedLanguage: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, transcript, detectedLanguage }) => {
    const session = await ctx.db.get(sessionId);

    // If speculative parse already completed (intent is set) and Whisper transcript
    // is similar to the pre-transcript, skip re-parsing — the speculative result is good.
    if (session?.speculativeParseDone && session.intent && session.preTranscript) {
      const similarity = computeSimilarity(session.preTranscript.toLowerCase(), transcript.toLowerCase());
      if (similarity >= 0.7) {
        // Transcripts are similar enough — promote speculative intent to final.
        // NOW set status="ready" so the confirm card appears and TTS plays once.
        await ctx.db.patch(sessionId, {
          transcript,
          status: "ready",
          ...(detectedLanguage ? { detectedLanguage } : {}),
        });

        // Schedule TTS now that intent is confirmed
        if (session.readbackText) {
          const owner = await ctx.db.get(session.ownerId);
          const voiceGender = owner?.voiceGender ?? "female";
          await ctx.scheduler.runAfter(0, internal.synthesize.synthesizeSpeech, {
            sessionId,
            text: session.readbackText,
            voiceGender,
          });
        }
        return;
      }
      // Transcripts diverged — need to re-parse with the more accurate Whisper transcript
    }

    await ctx.db.patch(sessionId, { transcript, status: "parsing", ...(detectedLanguage ? { detectedLanguage } : {}) });

    // Chain: kick off intent parsing with the accurate Whisper transcript.
    await ctx.scheduler.runAfter(0, internal.parseIntent.parseIntent, {
      sessionId,
      transcript,
      selectedToken: session?.selectedToken,
      detectedLanguage,
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
    readbackText: v.optional(v.string()),
    detectedLanguage: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, intent, readbackText: providedReadback, detectedLanguage }) => {
    // Use GPT-generated readback if provided, otherwise build a fallback.
    let readbackText: string | undefined = providedReadback;
    if (!readbackText) {
      try {
        const parsed = JSON.parse(intent);
        if (!parsed.error) {
          const session = await ctx.db.get(sessionId);
          const name = parsed.recipient?.name ?? "the recipient";
          const amount = (parsed.amount ?? parsed.amountUsdc)?.toLocaleString() ?? "?";
          const token = session?.selectedToken ?? parsed.token ?? "Unknown";

          const ordinal = (v: string) => {
            const n = parseInt(v);
            const s = ["th", "st", "nd", "rd"];
            const m = n % 100;
            return v + (s[(m - 20) % 10] || s[m] || s[0]);
          };

          let scheduleLabel = "";
          if (parsed.schedule) {
            const s = parsed.schedule;
            if (s.kind === "monthly") {
              if (s.value === "last") {
                scheduleLabel = "every month, on the last day";
              } else {
                scheduleLabel = `every month, on the ${ordinal(s.value)}`;
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
                const formatted = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                scheduleLabel = `on ${formatted}`;
              } else {
                scheduleLabel = `on ${s.value}`;
              }
            } else if (s.kind === "seconds") {
              const n = parseInt(s.value);
              if (parsed.kind === "oneShot") {
                const mins = Math.round(n / 60);
                scheduleLabel = n >= 60
                  ? `after ${mins} minute${mins === 1 ? "" : "s"}`
                  : `after ${n} second${n === 1 ? "" : "s"}`;
              } else {
                scheduleLabel = n === 1 ? "every second" : `every ${n} seconds`;
              }
            } else if (s.kind === "yearly") {
              const pd = parseMonthDay(s.value);
              if (pd) {
                const date = new Date(2000, pd.month - 1, pd.day);
                const monthName = date.toLocaleDateString("en-US", { month: "long" });
                scheduleLabel = `every year, on ${monthName} ${pd.day}`;
              } else {
                scheduleLabel = `every year, on ${s.value}`;
              }
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
                  scheduleLabel = "on your schedule";
                }
              } else {
                scheduleLabel = "on your schedule";
              }
            } else {
              scheduleLabel = "on your schedule";
            }
          }

          // Append duration or occurrence info
          if (parsed.totalOccurrences) {
            scheduleLabel += `, ${parsed.totalOccurrences} times`;
          } else if (parsed.durationMinutes) {
            const mins = parsed.durationMinutes;
            const hrs = Math.round(mins / 60);
            scheduleLabel += mins < 60
              ? `, for the next ${mins} minutes`
              : `, for the next ${hrs} hours`;
          }

          const thresholdLabel = parsed.condition?.thresholdFiat && parsed.condition?.thresholdFiatCurrency
            ? `${parsed.condition.thresholdFiat.toLocaleString()} ${parsed.condition.thresholdFiatCurrency} worth of ${token}`
            : `${parsed.condition?.walletBelowUsdc ?? "threshold"} ${token}`;

          const kindLabel =
            parsed.kind === "recurring" ? scheduleLabel || "on a recurring schedule"
            : parsed.kind === "conditional" && parsed.condition?.direction === "above"
              ? `when ${name}'s wallet goes above ${thresholdLabel}`
            : parsed.kind === "conditional"
              ? `when ${name}'s wallet goes below ${thresholdLabel}`
            : scheduleLabel ? scheduleLabel
            : "right now";
          readbackText = `Sending ${amount} ${token} to ${name}, ${kindLabel}. Please confirm to proceed.`;
        }
      } catch {
        // If JSON parse fails, skip readback
      }
    }

    // Ensure readback text mentions the correct token (session's selectedToken takes priority)
    if (readbackText) {
      const currentSess = await ctx.db.get(sessionId);
      const correctToken = currentSess?.selectedToken;
      if (correctToken) {
        readbackText = readbackText.replace(/\b(USDC|USDT|ETH|HTT)\b/g, (match) =>
          match !== correctToken ? correctToken : match
        );
      }
      // Ensure all numbers are Arabic numerals for TTS
      readbackText = sanitizeNumbersForTts(readbackText);
    }

    // Check if this is the speculative parse completing (session has preTranscript, Whisper hasn't finished yet)
    const currentSession = await ctx.db.get(sessionId);

    // Guard: if a non-error intent was already finalized, skip this late-arriving parse.
    // This prevents duplicate TTS when two parseIntent calls race (speculative + Whisper).
    if (currentSession?.status === "ready") {
      let existingHasError = true;
      try { existingHasError = !!JSON.parse(currentSession.intent ?? "{}").error; } catch { existingHasError = true; }
      let newHasError = true;
      try { newHasError = !!JSON.parse(intent).error; } catch { newHasError = true; }
      if (!existingHasError || newHasError) return;
      // existing is error + new is success → fall through to overwrite
    }

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

    if (isSpeculativeParse) {
      // Speculative parse succeeded — store intent but DON'T set status="ready" yet.
      // Wait for Whisper to confirm the transcript before showing the confirm card
      // and playing TTS. This prevents double-TTS when Whisper re-parses.
      await ctx.db.patch(sessionId, {
        intent,
        readbackText,
        speculativeParseDone: true,
        ...(detectedLanguage ? { detectedLanguage } : {}),
      });
      return;
    }

    // Final parse (from Whisper or non-speculative): mark ready and play TTS
    await ctx.db.patch(sessionId, {
      intent,
      status: "ready",
      readbackText,
      ...(detectedLanguage ? { detectedLanguage } : {}),
    });

    // Schedule background TTS synthesis for the Replay button (stored audio)
    if (readbackText) {
      const sess = currentSession ?? await ctx.db.get(sessionId);
      const owner = sess ? await ctx.db.get(sess.ownerId) : null;
      const voiceGender = owner?.voiceGender ?? "female";

      await ctx.scheduler.runAfter(0, internal.synthesize.synthesizeSpeech, {
        sessionId,
        text: readbackText,
        voiceGender,
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

export const createFromChatIntent = mutation({
  args: {
    privyId: v.string(),
    intent: v.string(),
    readbackText: v.string(),
    selectedToken: v.optional(v.string()),
  },
  handler: async (ctx, { privyId, intent, readbackText, selectedToken }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", privyId))
      .unique();
    if (!user) throw new Error("User not found");

    // Ensure all numbers are Arabic numerals for TTS
    const sanitizedReadback = sanitizeNumbersForTts(readbackText);

    const sessionId = await ctx.db.insert("voiceSessions", {
      ownerId: user._id,
      selectedToken,
      intent,
      readbackText: sanitizedReadback,
      status: "ready",
    });

    // Schedule background TTS synthesis for the Replay button
    const voiceGender = user.voiceGender ?? "female";
    await ctx.scheduler.runAfter(0, internal.synthesize.synthesizeSpeech, {
      sessionId,
      text: sanitizedReadback,
      voiceGender,
    });

    return sessionId;
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
