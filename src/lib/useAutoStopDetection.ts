import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

// --- Tuneable constants ---
const STABLE_TRANSCRIPT_MS = 1500; // ms transcript must be unchanged before checking completeness
const MIN_RECORDING_MS = 2000; // don't auto-stop before this
const MIN_TRANSCRIPT_LEN = 5; // need at least this many chars
const LLM_TIMEOUT_MS = 3000; // abort LLM call after this
const CHECK_INTERVAL_MS = 300; // how often to check transcript stability

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

  const skipCheckRef = useRef(skipCompletenessCheck);

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
      return;
    }

    stoppedRef.current = false;
    checkingRef.current = false;
    lastTranscriptChangeRef.current = Date.now();

    // --- Web Speech API for real-time transcript ---
    if (SpeechRecognitionClass) {
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

    // --- Transcript stability polling ---
    // Instead of audio-level silence detection, detect when the transcript
    // hasn't changed for STABLE_TRANSCRIPT_MS — a reliable signal that
    // the user stopped speaking.
    intervalRef.current = window.setInterval(() => {
      if (stoppedRef.current || checkingRef.current) return;

      const elapsed = elapsedRef.current;
      const transcript = transcriptRef.current;
      const timeSinceChange = Date.now() - lastTranscriptChangeRef.current;

      // Guards
      if (elapsed < MIN_RECORDING_MS) return;
      if (transcript.length < MIN_TRANSCRIPT_LEN) return;
      if (transcript === lastCheckedTranscriptRef.current) return; // already checked this exact text
      if (timeSinceChange < STABLE_TRANSCRIPT_MS) return;

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
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, checkCompleteness]);

  return { interimTranscript, isCheckingCompleteness, supported };
}
