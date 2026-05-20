import { useEffect, useRef, useCallback } from "react";
import { acquireSpeechLock, releaseSpeechLock } from "./speechRecognitionLock";

const STARTUP_DELAY_MS = 2000; // ignore results briefly after first enabling or after TTS ends
const START_RETRY_DELAY_MS = 500;

export interface VoiceCommand {
  keywords: string[];
  action: () => void;
}

interface UseConversationListenerOptions {
  /** True when the listener should be active (e.g. step is confirm/ask-email/ask-voice-msg/done/error) */
  enabled: boolean;
  /** Current flow step — determines which commands are active */
  currentStep: string;
  /** Map of step → commands. Only the current step's commands are matched. */
  commandMap: Record<string, VoiceCommand[]>;
  /** True while TTS audio is playing — suppresses matching to avoid picking up the AI's own voice */
  ttsPlaying: boolean;
}

const SpeechRecognitionClass =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

/**
 * Fuzzy keyword match: returns true if the transcript contains the keyword,
 * allowing for minor speech recognition errors (edit distance ≤ 2 for words ≥ 5 chars).
 */
function fuzzyMatch(transcript: string, keyword: string): boolean {
  const lower = transcript.toLowerCase().trim();
  const kw = keyword.toLowerCase();

  // Exact substring match (fast path)
  if (lower.includes(kw)) return true;

  // For short keywords, only accept exact match
  if (kw.length < 5) return false;

  // Check each word in the transcript for edit distance
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (editDistance(word, kw) <= 2) return true;
  }

  // Check consecutive word pairs for multi-word keywords
  if (kw.includes(" ")) {
    const kwWords = kw.split(/\s+/);
    for (let i = 0; i <= words.length - kwWords.length; i++) {
      const phrase = words.slice(i, i + kwWords.length).join(" ");
      if (editDistance(phrase, kw) <= 2) return true;
    }
  }

  return false;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function useConversationListener({
  enabled,
  currentStep,
  commandMap,
  ttsPlaying,
}: UseConversationListenerOptions) {
  const recognitionRef = useRef<any>(null);
  const firedRef = useRef(false);
  const enabledAtRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStepRef = useRef(currentStep);
  const commandMapRef = useRef(commandMap);
  const ttsPlayingRef = useRef(ttsPlaying);
  const pendingTranscriptsRef = useRef<string[]>([]);
  const lockIdRef = useRef(`convlistener-${Math.random().toString(36).slice(2)}`);

  // Keep refs in sync without restarting recognition
  currentStepRef.current = currentStep;
  commandMapRef.current = commandMap;
  ttsPlayingRef.current = ttsPlaying;

  // Reset fired flag and pending buffer when step changes so new commands can trigger
  useEffect(() => {
    firedRef.current = false;
    pendingTranscriptsRef.current = [];
  }, [currentStep]);

  // Discard buffered transcripts when TTS finishes — they came from the AI's
  // own voice being picked up by the microphone, not from the user speaking.
  // Also reset the startup delay so we ignore any lingering recognition results
  // for a brief window after TTS stops.
  useEffect(() => {
    if (!ttsPlaying) {
      pendingTranscriptsRef.current = [];
      enabledAtRef.current = Date.now();
    }
  }, [ttsPlaying]);

  const handleResult = useCallback((event: any) => {
    if (firedRef.current) return;

    // Buffer transcripts during TTS so we can check them after TTS ends
    if (ttsPlayingRef.current) {
      for (let i = 0; i < event.results.length; i++) {
        pendingTranscriptsRef.current.push(event.results[i][0].transcript);
      }
      return;
    }

    // Ignore results during startup delay
    if (Date.now() - enabledAtRef.current < STARTUP_DELAY_MS) return;

    const commands = commandMapRef.current[currentStepRef.current];
    if (!commands || commands.length === 0) return;

    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      for (const cmd of commands) {
        for (const keyword of cmd.keywords) {
          if (fuzzyMatch(transcript, keyword)) {
            firedRef.current = true;
            cmd.action();
            return;
          }
        }
      }
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognitionClass) return;
    if (!acquireSpeechLock(lockIdRef.current)) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-PH";
    recognition.maxAlternatives = 1;

    recognition.onresult = handleResult;
    recognition.onerror = (e: any) => {
      if (!firedRef.current && recognitionRef.current && (e.error === "aborted" || e.error === "not-allowed")) {
        retryTimerRef.current = setTimeout(() => {
          if (recognitionRef.current) {
            try { recognitionRef.current.start(); } catch {}
          }
        }, START_RETRY_DELAY_MS);
      }
    };
    recognition.onend = () => {
      // Auto-restart to keep listening across step transitions
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    try {
      recognition.start();
    } catch {
      retryTimerRef.current = setTimeout(() => {
        try { recognition.start(); } catch {}
      }, START_RETRY_DELAY_MS);
    }
    recognitionRef.current = recognition;
  }, [handleResult]);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!enabled || !SpeechRecognitionClass) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      releaseSpeechLock(lockIdRef.current);
      firedRef.current = false;
      return;
    }

    // Only start recognition if not already running
    if (!recognitionRef.current) {
      firedRef.current = false;
      enabledAtRef.current = Date.now();
      const startTimer = setTimeout(() => startRecognition(), 200);
      return () => {
        clearTimeout(startTimer);
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
          recognitionRef.current = null;
        }
        releaseSpeechLock(lockIdRef.current);
      };
    }

    // Already running — just clean up on unmount
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      releaseSpeechLock(lockIdRef.current);
    };
  }, [enabled, startRecognition]);
}
