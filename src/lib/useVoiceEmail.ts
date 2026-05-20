import { useCallback, useEffect, useRef, useState } from "react";
import { acquireSpeechLock, releaseSpeechLock } from "./speechRecognitionLock";

const STABLE_MS = 1200; // transcript must be unchanged for this long before parsing
const CHECK_INTERVAL_MS = 300;
const PARSE_TIMEOUT_MS = 5000;

interface UseVoiceEmailOptions {
  enabled: boolean;
  convexSiteUrl: string;
}

interface UseVoiceEmailResult {
  /** Live interim transcript from Web Speech API */
  spokenText: string;
  /** Parsed email address (null until successfully parsed) */
  parsedEmail: string | null;
  /** True while GPT is parsing the spoken email */
  isProcessing: boolean;
  /** Reset to try again */
  retry: () => void;
  /** Whether the browser supports speech recognition */
  supported: boolean;
}

const SpeechRecognitionClass =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useVoiceEmail({ enabled, convexSiteUrl }: UseVoiceEmailOptions): UseVoiceEmailResult {
  const [spokenText, setSpokenText] = useState("");
  const [parsedEmail, setParsedEmail] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const supported = !!SpeechRecognitionClass;

  const recognitionRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const transcriptRef = useRef("");
  const lastChangeRef = useRef(0);
  const lastCheckedRef = useRef("");
  const checkingRef = useRef(false);
  const doneRef = useRef(false);
  const lockIdRef = useRef(`voiceemail-${Math.random().toString(36).slice(2)}`);

  const httpUrl = convexSiteUrl ? `${convexSiteUrl}/api/parseEmail` : "";

  const parseEmail = useCallback(async (transcript: string) => {
    if (!httpUrl || doneRef.current || checkingRef.current) return;
    checkingRef.current = true;
    setIsProcessing(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
      const res = await fetch(httpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = (await res.json()) as { email: string | null };
      if (data.email && !doneRef.current) {
        doneRef.current = true;
        setParsedEmail(data.email);
        // Stop recognition once we have an email
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
          recognitionRef.current = null;
        }
      }
    } catch {
      // Parse failed — user can retry or type
    } finally {
      checkingRef.current = false;
      setIsProcessing(false);
    }
  }, [httpUrl]);

  const retry = useCallback(() => {
    doneRef.current = false;
    checkingRef.current = false;
    lastCheckedRef.current = "";
    transcriptRef.current = "";
    setParsedEmail(null);
    setSpokenText("");
    setIsProcessing(false);
  }, []);

  useEffect(() => {
    if (!enabled || !SpeechRecognitionClass) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      releaseSpeechLock(lockIdRef.current);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!acquireSpeechLock(lockIdRef.current)) return;

    doneRef.current = false;
    checkingRef.current = false;
    lastChangeRef.current = Date.now();
    lastCheckedRef.current = "";

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
        lastChangeRef.current = Date.now();
        setSpokenText(full);
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (!doneRef.current && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    try { recognition.start(); } catch {}
    recognitionRef.current = recognition;

    // Poll for transcript stability
    intervalRef.current = window.setInterval(() => {
      if (doneRef.current || checkingRef.current) return;
      const transcript = transcriptRef.current;
      const timeSinceChange = Date.now() - lastChangeRef.current;
      if (transcript.length < 5) return;
      if (transcript === lastCheckedRef.current) return;
      if (timeSinceChange < STABLE_MS) return;
      lastCheckedRef.current = transcript;
      parseEmail(transcript);
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
  }, [enabled, parseEmail]);

  return { spokenText, parsedEmail, isProcessing, retry, supported };
}
