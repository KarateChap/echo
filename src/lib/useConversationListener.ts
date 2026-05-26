import { useEffect, useRef, useCallback, useState } from "react";
import { acquireSpeechLock, releaseSpeechLock } from "./speechRecognitionLock";

const STARTUP_DELAY_MS = 800; // ignore results briefly after first enabling or after TTS ends
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
  /** Called with the raw transcript when no keyword command matched. Useful for parsing numbers etc. */
  onUnmatched?: (transcript: string, step: string) => void;
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
  // Normalize both: lowercase, collapse whitespace, trim
  const lower = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  const kw = keyword.toLowerCase().replace(/\s+/g, " ").trim();

  // Exact substring match (fast path)
  if (lower.includes(kw)) return true;

  // Try with all non-alphanumeric removed — handles "grab pay" matching "grabpay",
  // "e-wallets" matching "e wallets", "dbs paylah!" matching "dbs paylah", etc.
  const normLower = lower.replace(/[^a-z0-9]/g, "");
  const normKw = kw.replace(/[^a-z0-9]/g, "");
  if (normLower.includes(normKw)) return true;

  // For short keywords, only accept exact match
  if (kw.length < 5) return false;

  // Check each word in the transcript for edit distance
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (editDistance(word, kw) <= 2) return true;
  }

  // Check consecutive word pairs/triples joined together — handles speech
  // splitting compound names like "grab pay" → "grabpay", "shopee pay" → "shopeepay"
  for (let n = 2; n <= Math.min(3, words.length); n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const joined = words.slice(i, i + n).join("");
      if (editDistance(joined, kw) <= 2) return true;
      // Also check with spaces for multi-word keywords
      const spaced = words.slice(i, i + n).join(" ");
      if (editDistance(spaced, kw) <= 2) return true;
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
  onUnmatched,
}: UseConversationListenerOptions) {
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const firedRef = useRef(false);
  const processedUpToRef = useRef(0); // track last processed result index
  const enabledAtRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStepRef = useRef(currentStep);
  const commandMapRef = useRef(commandMap);
  const ttsPlayingRef = useRef(ttsPlaying);
  const onUnmatchedRef = useRef(onUnmatched);
  const pendingTranscriptsRef = useRef<string[]>([]);
  const lockIdRef = useRef(`convlistener-${Math.random().toString(36).slice(2)}`);

  // Keep refs in sync without restarting recognition
  currentStepRef.current = currentStep;
  commandMapRef.current = commandMap;
  // Synchronously reset startup delay when TTS transitions playing → stopped,
  // preventing race where speech results arrive between ref update and useEffect
  if (ttsPlayingRef.current && !ttsPlaying) {
    pendingTranscriptsRef.current = [];
    enabledAtRef.current = Date.now();
  }
  ttsPlayingRef.current = ttsPlaying;
  onUnmatchedRef.current = onUnmatched;

  // Reset fired flag and pending buffer when step changes so new commands can trigger.
  // Also reset the startup delay to create a cooldown — prevents lingering transcripts
  // from the previous step from immediately firing on the new step.
  useEffect(() => {
    firedRef.current = false;
    processedUpToRef.current = 0;
    pendingTranscriptsRef.current = [];
    enabledAtRef.current = Date.now();
    setInterimTranscript("");
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
    // Always update interim transcript for display — even if a command already
    // fired or TTS is playing. This keeps the transcript responsive at all times.
    let latestTranscript = "";
    for (let i = 0; i < event.results.length; i++) {
      latestTranscript = event.results[i][0].transcript;
    }
    if (latestTranscript && !ttsPlayingRef.current) setInterimTranscript(latestTranscript);

    // Buffer transcripts during TTS so we can check them after TTS ends
    if (ttsPlayingRef.current) {
      for (let i = 0; i < event.results.length; i++) {
        pendingTranscriptsRef.current.push(event.results[i][0].transcript);
      }
      return;
    }

    // Ignore results during startup delay (for command matching only)
    if (Date.now() - enabledAtRef.current < STARTUP_DELAY_MS) return;

    const commands = commandMapRef.current[currentStepRef.current];
    if (!commands || commands.length === 0) return;

    // Only process results we haven't seen yet — continuous mode accumulates
    // old results, and re-processing them after firedRef resets causes ghost matches
    for (let i = processedUpToRef.current; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      // Skip already-processed final results
      if (i < processedUpToRef.current) continue;
      if (event.results[i].isFinal) processedUpToRef.current = i + 1;

      let matched = false;
      for (const cmd of commands) {
        if (matched) break;
        for (const keyword of cmd.keywords) {
          if (fuzzyMatch(transcript, keyword)) {
            matched = true;
            processedUpToRef.current = i + 1;
            setInterimTranscript("");
            cmd.action();
            return;
          }
        }
      }

      // No keyword matched — forward to onUnmatched handler
      if (!matched && event.results[i].isFinal && onUnmatchedRef.current) {
        onUnmatchedRef.current(transcript, currentStepRef.current);
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

    // Track whether we're already scheduling a restart to avoid duplicates
    let restartScheduled = false;
    const scheduleRestart = (delay: number) => {
      if (restartScheduled || !recognitionRef.current) return;
      restartScheduled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        restartScheduled = false;
        if (recognitionRef.current) {
          try { recognitionRef.current.start(); } catch {}
        }
      }, delay);
    };

    recognition.onerror = (e: any) => {
      // no-speech, aborted, network — all recoverable, just restart
      if (recognitionRef.current && (e.error === "aborted" || e.error === "not-allowed" || e.error === "no-speech" || e.error === "network")) {
        scheduleRestart(START_RETRY_DELAY_MS);
      }
    };

    recognition.onend = () => {
      // Always restart — Chrome stops recognition after silence, errors, or tab changes
      // Reset processed index since new recognition session produces fresh results
      processedUpToRef.current = 0;
      scheduleRestart(100);
    };

    try {
      recognition.start();
    } catch {
      scheduleRestart(START_RETRY_DELAY_MS);
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

  return { interimTranscript };
}
