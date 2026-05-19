import { useEffect, useRef, useCallback } from "react";

const STARTUP_DELAY_MS = 1500; // ignore results for this long after enabling
const START_RETRY_DELAY_MS = 500; // retry starting recognition if first attempt fails

export interface VoiceCommand {
  keywords: string[];
  action: () => void;
}

interface UseVoiceCommandsOptions {
  enabled: boolean;
  commands: VoiceCommand[];
}

const SpeechRecognitionClass =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useVoiceCommands({ enabled, commands }: UseVoiceCommandsOptions) {
  const recognitionRef = useRef<any>(null);
  const firedRef = useRef(false);
  const commandsRef = useRef(commands);
  const enabledAtRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  commandsRef.current = commands;

  const handleResult = useCallback((event: any) => {
    if (firedRef.current) return;

    // Ignore results during startup delay to avoid matching residual audio
    if (Date.now() - enabledAtRef.current < STARTUP_DELAY_MS) return;

    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();

      for (const cmd of commandsRef.current) {
        for (const keyword of cmd.keywords) {
          if (transcript.includes(keyword.toLowerCase())) {
            firedRef.current = true;
            try { recognitionRef.current?.stop(); } catch {}
            cmd.action();
            return;
          }
        }
      }
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (firedRef.current || !SpeechRecognitionClass) return;

    // Clean up any existing instance first
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
      // If we get a "not-allowed" or "aborted" error, retry after a short delay
      // This handles cases where a previous recognition instance hasn't fully released
      if (!firedRef.current && recognitionRef.current && (e.error === "aborted" || e.error === "not-allowed")) {
        retryTimerRef.current = setTimeout(() => {
          if (!firedRef.current && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch {}
          }
        }, START_RETRY_DELAY_MS);
      }
    };
    recognition.onend = () => {
      if (!firedRef.current && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    try {
      recognition.start();
    } catch {
      // If start fails immediately, retry after a delay (browser may still be releasing prev instance)
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
      firedRef.current = false;
      return;
    }

    firedRef.current = false;
    enabledAtRef.current = Date.now();

    // Delay start slightly to let any previous recognition instance fully release
    const startTimer = setTimeout(() => {
      startRecognition();
    }, 300);

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
    };
  }, [enabled, startRecognition]);
}
