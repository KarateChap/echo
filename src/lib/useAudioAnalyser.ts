import { useEffect, useRef, type MutableRefObject } from "react";
import { isMobile } from "./isMobile";

/**
 * Connects to a MediaStream or HTMLAudioElement via Web Audio API
 * and writes a normalized audio level (0–1) into a ref every animation frame.
 * Returns a ref so consumers can read .current in their own RAF loops
 * without triggering React re-renders.
 *
 * On mobile: uses smaller FFT and only analyzes every 3rd frame to reduce CPU.
 */
export function useAudioAnalyser(
  source: MediaStream | HTMLAudioElement | null,
): MutableRefObject<number> {
  const levelRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!source) {
      levelRef.current = 0;
      return;
    }

    // On mobile, skip AudioContext for mic streams — connecting a MediaStream to
    // AudioContext puts the browser in "communication" audio session mode, routing
    // all playback through the earpiece instead of the speaker. TTS audio element
    // analysis still works (it's not a MediaStream).
    if (isMobile && source instanceof MediaStream) {
      levelRef.current = 0;
      return;
    }

    let cancelled = false;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = isMobile ? 256 : 1024;
    analyser.smoothingTimeConstant = 0.3;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -10;

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    let sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
    try {
      if (source instanceof MediaStream) {
        sourceNode = ctx.createMediaStreamSource(source);
      } else {
        sourceNode = ctx.createMediaElementSource(source);
        sourceNode.connect(ctx.destination);
      }
    } catch {
      // HTMLAudioElement can only bind to one AudioContext (StrictMode re-mount)
      ctx.close();
      ctxRef.current = null;
      return;
    }
    sourceNode.connect(analyser);

    let frameCount = 0;

    function tick() {
      if (cancelled) return;

      frameCount++;

      // On mobile, only run FFT analysis every 3rd frame (hold previous value)
      if (isMobile && frameCount % 3 !== 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      analyser.getByteFrequencyData(freqData);
      let freqSum = 0;
      for (let i = 0; i < freqData.length; i++) {
        freqSum += freqData[i];
      }
      const freqAvg = freqSum / freqData.length / 255;

      analyser.getByteTimeDomainData(timeData);
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const amplitude = Math.abs(timeData[i] - 128) / 128;
        if (amplitude > peak) peak = amplitude;
      }

      const binHz = ctx.sampleRate / analyser.fftSize;
      const lo = Math.floor(300 / binHz);
      const hi = Math.min(Math.ceil(3000 / binHz), freqData.length);
      let voiceSum = 0;
      for (let i = lo; i < hi; i++) voiceSum += freqData[i];
      const voiceAvg = voiceSum / (hi - lo) / 255;

      const raw = Math.max(freqAvg * 0.6 + voiceAvg * 0.4, peak * 0.85);
      const boosted = Math.pow(raw, 0.65) * 1.3;
      const clamped = Math.min(1, boosted);

      if (!cancelled) {
        levelRef.current = clamped;
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      sourceNode.disconnect();
      analyser.disconnect();
      ctx.close();
      ctxRef.current = null;
    };
  }, [source]);

  return levelRef;
}
