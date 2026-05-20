import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { isMobile } from "./isMobile";
import { acquireSpeechLock, releaseSpeechLock } from "./speechRecognitionLock";

// --- Tuneable constants ---
const DEFAULT_STABLE_TRANSCRIPT_MS = isMobile ? 2500 : 1500; // ms transcript must be unchanged before checking completeness
const CHAT_STABLE_TRANSCRIPT_MS = isMobile ? 2000 : 1500; // silence detection for chat mode — longer on mobile where speech recognition gaps are wider
const MIN_RECORDING_MS = isMobile ? 3000 : 2000; // don't auto-stop before this
const MIN_TRANSCRIPT_LEN = 5; // need at least this many chars
const LLM_TIMEOUT_MS = 3000; // abort LLM call after this
const CHECK_INTERVAL_MS = isMobile ? 500 : 300; // how often to check transcript stability
const SILENCE_LEVEL = 0.12; // audio level below this = silence
const SILENCE_TIMEOUT_MS = isMobile ? 2500 : 2000; // auto-stop after this much continuous silence (fallback when SpeechRecognition produces no transcript)
const MAX_RECORDING_MS = 15_000; // absolute max — auto-stop regardless after 15 seconds

interface AutoStopOptions {
  enabled: boolean;
  audioLevelRef: MutableRefObject<number>;
  elapsedMs: number;
  selectedToken: string | null;
  onAutoStop: () => void;
  convexUrl: string;
  /** When true, auto-stop on transcript stability only — skip LLM completeness check */
  skipCompletenessCheck?: boolean;
}

interface AutoStopResult {
  interimTranscript: string;
  isCheckingCompleteness: boolean;
  supported: boolean;
  peakAudioLevel: number;
}

const SpeechRecognitionClass =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useAutoStopDetection({
  enabled,
  audioLevelRef: _audioLevelRef,
  elapsedMs,
  selectedToken,
  onAutoStop,
  convexUrl,
  skipCompletenessCheck,
}: AutoStopOptions): AutoStopResult {
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isCheckingCompleteness, setIsCheckingCompleteness] = useState(false);
  const supported = !!SpeechRecognitionClass;

  const recognitionRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const checkingRef = useRef(false); // prevents overlapping checks
  const elapsedRef = useRef(elapsedMs);
  const transcriptRef = useRef("");
  const lastTranscriptChangeRef = useRef<number>(0); // timestamp of last transcript change
  const lastCheckedTranscriptRef = useRef(""); // avoid re-checking same text
  const onAutoStopRef = useRef(onAutoStop);
  const lockIdRef = useRef(`autostop-${Math.random().toString(36).slice(2)}`);

  const skipCheckRef = useRef(skipCompletenessCheck);
  const lastLoudRef = useRef<number>(0); // timestamp of last above-silence audio level
  const hadAnyAudioRef = useRef(false); // true once audio level has been above silence
  const peakLevelRef = useRef(0); // tracks peak audio level during session

  elapsedRef.current = elapsedMs;
  onAutoStopRef.current = onAutoStop;
  skipCheckRef.current = skipCompletenessCheck;

  // Derive HTTP endpoint: https://xxx.convex.cloud → https://xxx.convex.site
  const httpUrl = convexUrl
    ? convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/api/checkCompleteness"
    : "";

  const checkCompleteness = useCallback(
    async (transcript: string) => {
      if (!httpUrl || stoppedRef.current || checkingRef.current) return;
      checkingRef.current = true;
      setIsCheckingCompleteness(true);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
        const res = await fetch(httpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, selectedToken }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = (await res.json()) as { complete: boolean };
        if (data.complete && !stoppedRef.current) {
          stoppedRef.current = true;
          onAutoStopRef.current();
        }
        // If not complete, the interval will re-check once transcript changes again
      } catch {
        // Network error or timeout — user can stop manually
      } finally {
        checkingRef.current = false;
        setIsCheckingCompleteness(false);
      }
    },
    [httpUrl, selectedToken],
  );

  useEffect(() => {
    if (!enabled) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      releaseSpeechLock(lockIdRef.current);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setInterimTranscript("");
      setIsCheckingCompleteness(false);
      stoppedRef.current = false;
      checkingRef.current = false;
      transcriptRef.current = "";
      lastTranscriptChangeRef.current = 0;
      lastCheckedTranscriptRef.current = "";
      lastLoudRef.current = 0;
      hadAnyAudioRef.current = false;
      peakLevelRef.current = 0;
      return;
    }

    stoppedRef.current = false;
    checkingRef.current = false;
    lastTranscriptChangeRef.current = Date.now();
    lastLoudRef.current = Date.now();
    hadAnyAudioRef.current = false;
    peakLevelRef.current = 0;

    // --- Web Speech API for real-time transcript ---
    if (SpeechRecognitionClass && acquireSpeechLock(lockIdRef.current)) {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-PH";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let full = "";
        for (let i = 0; i < event.results.length; i++) {
          full += event.results[i][0].transcript;
        }
        if (full !== transcriptRef.current) {
          transcriptRef.current = full;
          lastTranscriptChangeRef.current = Date.now();
          setInterimTranscript(full);
        }
      };

      recognition.onerror = () => {};

      recognition.onend = () => {
        // Some browsers auto-stop recognition; restart if still recording
        if (!stoppedRef.current && recognitionRef.current) {
          try { recognitionRef.current.start(); } catch {}
        }
      };

      try {
        recognition.start();
      } catch {}
      recognitionRef.current = recognition;
    }

    // --- Transcript stability polling + audio-level silence fallback ---
    intervalRef.current = window.setInterval(() => {
      if (stoppedRef.current || checkingRef.current) return;

      const elapsed = elapsedRef.current;
      const transcript = transcriptRef.current;
      const timeSinceChange = Date.now() - lastTranscriptChangeRef.current;
      const now = Date.now();

      // Track audio level for silence-based fallback
      const currentLevel = _audioLevelRef.current;
      if (currentLevel > peakLevelRef.current) {
        peakLevelRef.current = currentLevel;
      }
      if (currentLevel > SILENCE_LEVEL) {
        lastLoudRef.current = now;
        hadAnyAudioRef.current = true;
      }

      // On mobile, AudioContext is disabled for mic streams (to avoid earpiece
      // routing), so audio level is always 0.  Once we're past the minimum
      // recording time, assume speech was present so the silence-timeout
      // fallback can fire and hand off to Whisper.
      if (isMobile && elapsed >= MIN_RECORDING_MS && !hadAnyAudioRef.current) {
        hadAnyAudioRef.current = true;
        lastLoudRef.current = now;
      }

      // Guard: don't auto-stop too early
      if (elapsed < MIN_RECORDING_MS) return;

      // === Fallback 1: absolute max recording timeout ===
      if (elapsed >= MAX_RECORDING_MS) {
        stoppedRef.current = true;
        onAutoStopRef.current();
        return;
      }

      // === Fallback 2: audio-level silence (for when SpeechRecognition fails) ===
      // Applies in both chat and payment modes — if speech was detected but
      // SpeechRecognition produced no transcript, stop on silence and let
      // Whisper (backend) handle transcription.
      if (hadAnyAudioRef.current && transcript.length < MIN_TRANSCRIPT_LEN) {
        const silenceDuration = now - lastLoudRef.current;
        if (silenceDuration >= SILENCE_TIMEOUT_MS) {
          stoppedRef.current = true;
          onAutoStopRef.current();
          return;
        }
      }

      // === Primary: transcript stability detection ===
      if (transcript.length < MIN_TRANSCRIPT_LEN) return;
      if (transcript === lastCheckedTranscriptRef.current) return;
      const stableMs = skipCheckRef.current ? CHAT_STABLE_TRANSCRIPT_MS : DEFAULT_STABLE_TRANSCRIPT_MS;
      if (timeSinceChange < stableMs) return;

      // Transcript has been stable long enough
      lastCheckedTranscriptRef.current = transcript;
      if (skipCheckRef.current) {
        // Chat mode: auto-stop immediately on transcript stability
        stoppedRef.current = true;
        onAutoStopRef.current();
      } else {
        // Payment mode: check completeness via LLM
        checkCompleteness(transcript);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      releaseSpeechLock(lockIdRef.current);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, checkCompleteness]);

  return { interimTranscript, isCheckingCompleteness, supported, peakAudioLevel: peakLevelRef.current };
}
