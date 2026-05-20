import { useCallback, useEffect, useRef, useState } from "react";
import { isIOS } from "./isMobile";

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  sampleRate: 16000,
};

interface IOSAudioSession {
  /** Persistent mic stream acquired on first gesture — never stopped until page unload */
  persistentStream: MediaStream | null;
  /** True after first gesture + getUserMedia + speaker prime */
  isReady: boolean;
  /** Call before any audio playback to force speaker routing (plays silent buffer ~100ms) */
  forceSpeakerRoute: () => Promise<void>;
  /**
   * Pre-blessed Audio element created and .play()-ed during a user gesture.
   * Reuse this for all TTS playback on iOS — new Audio() elements created
   * outside a gesture handler will be blocked by iOS autoplay policy.
   */
  blessedAudio: HTMLAudioElement | null;
}

/**
 * Manages the iOS audio session lifecycle:
 * 1. Acquires mic once on first user gesture → persistent stream (no repeated permission prompts)
 * 2. Forces speaker routing via silent AudioContext playback (overrides earpiece from getUserMedia)
 * 3. Unlocks iOS autoplay policy on first gesture
 * 4. Re-acquires stream if tracks die (e.g. page backgrounded)
 *
 * On non-iOS platforms, this hook is a no-op — returns null stream and no-op forceSpeakerRoute.
 */
export function useIOSAudioSession(): IOSAudioSession {
  const [persistentStream, setPersistentStream] = useState<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(!isIOS); // non-iOS is always "ready"
  const [blessedAudio, setBlessedAudio] = useState<HTMLAudioElement | null>(null);
  const blessedAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const initializingRef = useRef(false);
  const forceInProgressRef = useRef(false);

  // Initialize: acquire mic + force speaker + unlock autoplay
  const initialize = useCallback(async () => {
    if (!isIOS || initializingRef.current) return;
    if (streamRef.current && streamRef.current.getAudioTracks().some(t => t.readyState === "live")) return;
    initializingRef.current = true;

    try {
      // 1. Acquire mic stream (triggers one permission prompt)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      streamRef.current = stream;
      setPersistentStream(stream);

      // Listen for track death (iOS backgrounding)
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          streamRef.current = null;
          setPersistentStream(null);
          setIsReady(false);
          initializingRef.current = false;
        };
      });

      // 2. Create AudioContext and force speaker routing
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      // Play silent buffer through speaker (AudioContext.destination always routes to speaker)
      const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.1)), ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();

      // 3. Create and bless a shared Audio element within this user gesture.
      // iOS Safari only allows audio.play() on elements that were first played
      // during a user gesture. By blessing one element now, we can reuse it for
      // all future TTS playback without needing another gesture.
      if (!blessedAudioRef.current) {
        const audio = new Audio();
        audio.setAttribute("playsinline", "");
        // Use a tiny silent MP3 to trigger the first play within the gesture
        audio.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwBHAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwBHAAAAAAAAAAAAAAAAAAAA";
        try {
          await audio.play();
        } catch {
          // Autoplay unlock failed — will retry on next gesture
        }
        // Pause and reset — the element is now "blessed" for future .play() calls
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        blessedAudioRef.current = audio;
        setBlessedAudio(audio);
      }

      setIsReady(true);
    } catch (e) {
      console.warn("[useIOSAudioSession] initialize failed:", e);
    } finally {
      initializingRef.current = false;
    }
  }, []);

  // Register gesture listener on mount for iOS
  useEffect(() => {
    if (!isIOS) return;

    const handler = () => { initialize(); };

    // Use both touchend and click to cover all gesture types
    document.addEventListener("touchend", handler, { passive: true });
    document.addEventListener("click", handler, { passive: true });

    return () => {
      document.removeEventListener("touchend", handler);
      document.removeEventListener("click", handler);
    };
  }, [initialize]);

  // Handle page visibility changes — resume AudioContext when returning to foreground
  useEffect(() => {
    if (!isIOS) return;

    const handler = () => {
      if (!document.hidden && audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Cleanup on unmount / page unload
  useEffect(() => {
    if (!isIOS) return;

    const cleanup = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };

    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, []);

  // Force speaker routing: play a silent buffer through AudioContext.destination
  // Call this before any audio playback on iOS
  const forceSpeakerRoute = useCallback(async () => {
    if (!isIOS) return;
    if (forceInProgressRef.current) return;
    forceInProgressRef.current = true;

    try {
      let ctx = audioCtxRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === "suspended") await ctx.resume();

      const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.1)), ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();

      // Wait for the buffer to finish playing
      await new Promise<void>(resolve => {
        source.onended = () => resolve();
        // Safety timeout
        setTimeout(resolve, 150);
      });
    } catch (e) {
      console.warn("[useIOSAudioSession] forceSpeakerRoute failed:", e);
    } finally {
      forceInProgressRef.current = false;
    }
  }, []);

  return { persistentStream, isReady, forceSpeakerRoute, blessedAudio };
}
