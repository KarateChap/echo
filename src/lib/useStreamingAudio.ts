import { useCallback, useRef } from "react";

/**
 * Streaming audio playback hook.
 * Consumes a chunked audio response and begins playback as soon as the first
 * chunk arrives, rather than waiting for the full blob.
 *
 * Falls back to early-blob playback when MediaSource is unsupported (Safari/iOS).
 * Callback refs are used so returned functions are referentially stable.
 */

const supportsMediaSource =
  typeof window !== "undefined" &&
  typeof MediaSource !== "undefined" &&
  MediaSource.isTypeSupported("audio/mpeg");

interface StreamingAudioOptions {
  onStart?: (audio: HTMLAudioElement) => void;
  onEnd?: () => void;
  /** Call before audio.play() on iOS to force speaker routing */
  forceSpeakerRoute?: () => Promise<void>;
}

interface StreamingAudioControls {
  playStream: (response: Response) => Promise<void>;
  stop: () => void;
}

export function useStreamingAudio({
  onStart,
  onEnd,
  forceSpeakerRoute,
}: StreamingAudioOptions = {}): StreamingAudioControls {
  // Use refs for callbacks so returned functions stay stable across renders
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  const forceSpeakerRef = useRef(forceSpeakerRoute);
  onStartRef.current = onStart;
  onEndRef.current = onEnd;
  forceSpeakerRef.current = forceSpeakerRoute;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    cleanup();
    onEndRef.current?.();
  }, [cleanup]);

  const playStream = useCallback(
    async (response: Response) => {
      // Abort any previous playback
      if (abortRef.current) abortRef.current.abort();
      cleanup();

      abortRef.current = new AbortController();
      const ac = abortRef.current;

      if (!response.body) {
        // No stream — fall back to full blob
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audio.setAttribute("playsinline", "");
        audioRef.current = audio;
        onStartRef.current?.(audio);

        await forceSpeakerRef.current?.();
        await new Promise<void>((resolve) => {
          audio.addEventListener("ended", () => resolve(), { once: true });
          audio.addEventListener("error", () => resolve(), { once: true });
          audio.play().catch((e) => { console.warn("[useStreamingAudio] play failed:", e); resolve(); });
        });

        URL.revokeObjectURL(blobUrl);
        cleanup();
        onEndRef.current?.();
        return;
      }

      if (supportsMediaSource) {
        await playMediaSource(response, ac, audioRef, onStartRef, onEndRef, cleanup, forceSpeakerRef);
      } else {
        await playFallback(response, ac, audioRef, onStartRef, onEndRef, cleanup, forceSpeakerRef);
      }
    },
    [cleanup],
  );

  return { playStream, stop };
}

// ── MediaSource path (Chrome, Edge, Firefox desktop) ────────────────────────

async function playMediaSource(
  response: Response,
  ac: AbortController,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  onStartRef: React.MutableRefObject<((audio: HTMLAudioElement) => void) | undefined>,
  onEndRef: React.MutableRefObject<(() => void) | undefined>,
  cleanup: () => void,
  forceSpeakerRef: React.MutableRefObject<(() => Promise<void>) | undefined>,
) {
  const mediaSource = new MediaSource();
  const audio = new Audio();
  audio.setAttribute("playsinline", "");
  audioRef.current = audio;
  audio.src = URL.createObjectURL(mediaSource);

  await new Promise<void>((resolve) => {
    mediaSource.addEventListener("sourceopen", async () => {
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
      } catch {
        // SourceBuffer not supported — resolve and let onEnd fire
        resolve();
        return;
      }

      const reader = response.body!.getReader();
      let started = false;
      const pendingChunks: ArrayBuffer[] = [];
      let streamDone = false;

      const appendNext = () => {
        if (sourceBuffer.updating || pendingChunks.length === 0 || mediaSource.readyState !== "open")
          return;
        const chunk = pendingChunks.shift()!;
        try {
          sourceBuffer.appendBuffer(chunk);
        } catch {
          // QuotaExceededError or InvalidStateError — skip
        }
      };

      sourceBuffer.addEventListener("updateend", () => {
        if (pendingChunks.length > 0) {
          appendNext();
        } else if (streamDone && mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch {}
        }
      });

      try {
        while (true) {
          if (ac.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          pendingChunks.push(value.buffer as ArrayBuffer);
          appendNext();

          if (!started) {
            started = true;
            onStartRef.current?.(audio);
            await forceSpeakerRef.current?.();
            audio.play().catch((e) => console.warn("[useStreamingAudio] play failed:", e));
          }
        }
      } catch (e: any) {
        if (e.name !== "AbortError") console.warn("Stream read error:", e);
      }

      streamDone = true;
      if (!sourceBuffer.updating && pendingChunks.length === 0 && mediaSource.readyState === "open") {
        try { mediaSource.endOfStream(); } catch {}
      }

      resolve();
    }, { once: true });
  });

  // Wait for playback to finish
  if (audio && !audio.ended && !ac.signal.aborted) {
    await new Promise<void>((resolve) => {
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
      // Safety: if audio is already ended by the time we attach
      if (audio.ended) done();
    });
  }

  cleanup();
  onEndRef.current?.();
}

// ── Blob-accumulation fallback (Safari, iOS) ────────────────────────────────

async function playFallback(
  response: Response,
  ac: AbortController,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  onStartRef: React.MutableRefObject<((audio: HTMLAudioElement) => void) | undefined>,
  onEndRef: React.MutableRefObject<(() => void) | undefined>,
  cleanup: () => void,
  forceSpeakerRef: React.MutableRefObject<(() => Promise<void>) | undefined>,
) {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let started = false;
  const audio = new Audio();
  audio.setAttribute("playsinline", "");
  audioRef.current = audio;
  let blobUrl = "";

  const createAndPlay = async (final: boolean) => {
    const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);

    if (!started) {
      started = true;
      audio.src = blobUrl;
      audio.load();
      onStartRef.current?.(audio);
      await forceSpeakerRef.current?.();
      audio.play().catch((e) => console.warn("[useStreamingAudio] fallback play failed:", e));
    } else if (final && audio.ended) {
      // Only reset src if playback already stopped (ran out of data).
      // If still playing, don't touch src — it will finish naturally.
      const currentTime = audio.currentTime;
      audio.src = blobUrl;
      audio.currentTime = currentTime;
      audio.play().catch((e) => console.warn("[useStreamingAudio] fallback resume failed:", e));
    }
  };

  try {
    while (true) {
      if (ac.signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      totalBytes += value.byteLength;

      if (!started && totalBytes >= 4096) {
        await createAndPlay(false);
      }
    }
  } catch (e: any) {
    if (e.name !== "AbortError") console.warn("Stream read error:", e);
  }

  if (chunks.length > 0) {
    await createAndPlay(true);
  }

  // Wait for playback to finish
  if (audio && !audio.ended && !ac.signal.aborted) {
    await new Promise<void>((resolve) => {
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
      if (audio.ended) done();
    });
  }

  if (blobUrl) URL.revokeObjectURL(blobUrl);
  cleanup();
  onEndRef.current?.();
}
