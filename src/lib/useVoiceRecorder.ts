import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopping" | "error";

const SOFT_CAP_MS = 45_000;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  sampleRate: 16000,
};

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mt of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return "";
}

interface UseVoiceRecorderOptions {
  /** Persistent mic stream from useIOSAudioSession — cloned for each recording to avoid re-prompting */
  persistentStream?: MediaStream | null;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { persistentStream } = options;
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const stopCallbackRef = useRef<((blob: Blob) => void) | null>(null);

  const clearTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(() => () => clearTick(), []);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);
    setStatus("requesting");
    try {
      let micStream: MediaStream;

      // If a persistent stream is available and alive, clone it to avoid new getUserMedia call
      if (persistentStream && persistentStream.getAudioTracks().some(t => t.readyState === "live")) {
        micStream = new MediaStream(persistentStream.getAudioTracks().map(t => t.clone()));
      } else {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      }

      setStream(micStream);
      const stream = micStream;
      const mime = pickMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      const actualMime = recorder.mimeType || "audio/mp4";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Stop only the cloned tracks, not the persistent stream's tracks
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
        clearTick();
        const blob = new Blob(chunksRef.current, { type: actualMime });
        chunksRef.current = [];
        setStatus("idle");
        setElapsedMs(0);
        stopCallbackRef.current?.(blob);
        stopCallbackRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      tickRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= SOFT_CAP_MS && recorder.state === "recording") {
          recorder.stop();
        }
      }, 500);
    } catch (e) {
      console.error("[useVoiceRecorder] startRecording failed:", e);
      setStatus("error");
      setError(e instanceof Error ? e.message : "Mic permission denied");
    }
  }, [persistentStream]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        resolve(null);
        return;
      }
      setStatus("stopping");
      stopCallbackRef.current = (blob) => resolve(blob);
      recorder.stop();
    });
  }, []);

  return { status, error, elapsedMs, stream, startRecording, stopRecording };
}
