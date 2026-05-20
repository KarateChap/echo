import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopping" | "error";

const SOFT_CAP_MS = 45_000;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  sampleRate: 16000,
};

export function useVoiceRecorder() {
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

  const prewarmedStreamRef = useRef<MediaStream | null>(null);

  // Pre-warm the microphone so there's no permission popup delay when recording starts
  const prewarmMic = useCallback(async () => {
    if (prewarmedStreamRef.current) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      prewarmedStreamRef.current = s;
    } catch {
      // Ignore — will be requested again in startRecording
    }
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);
    setStatus("requesting");
    try {
      // Reuse prewarmed stream if available, otherwise request fresh
      let micStream: MediaStream;
      if (prewarmedStreamRef.current) {
        micStream = prewarmedStreamRef.current;
        prewarmedStreamRef.current = null;
      } else {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      }
      setStream(micStream);
      const stream = micStream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
        clearTick();
        const blob = new Blob(chunksRef.current, { type: mimeType });
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
      setStatus("error");
      setError(e instanceof Error ? e.message : "Mic permission denied");
    }
  }, []);

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

  return { status, error, elapsedMs, stream, startRecording, stopRecording, prewarmMic };
}
