import { useRef, useEffect, useState, useMemo, useCallback } from "react";

/* ── Deterministic waveform from URL ─────────────────────────── */

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function generateWaveform(seed: string, count: number): number[] {
  let s = hashString(seed);
  const next = () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  // raw amplitudes
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    raw.push(0.2 + next() * 0.8); // range 0.2–1.0
  }
  // smooth pass
  const smoothed: number[] = [];
  for (let i = 0; i < count; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const curr = raw[i];
    const nxt = raw[Math.min(count - 1, i + 1)];
    smoothed.push(prev * 0.25 + curr * 0.5 + nxt * 0.25);
  }
  return smoothed;
}

/* ── Single-player enforcement ───────────────────────────────── */

const PAUSE_ALL = "echo:voice:pauseAll";

/* ── Component ───────────────────────────────────────────────── */

const BAR_COUNT = 40;

export function VoicePlayer({ url, duration: durationProp }: { url: string; duration?: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);
  const idRef = useRef(Math.random());

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const totalDuration = durationProp ?? mediaDuration;
  const bars = useMemo(() => generateWaveform(url, BAR_COUNT), [url]);

  /* ── Audio event listeners ──────────────────────────────────── */

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
        setCurrentTime(audio.currentTime);
      }
    };
    const onMeta = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setMediaDuration(audio.duration);
      }
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  /* ── Pause-all listener ─────────────────────────────────────── */

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (id !== idRef.current) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    window.addEventListener(PAUSE_ALL, handler);
    return () => window.removeEventListener(PAUSE_ALL, handler);
  }, []);

  /* ── Play / Pause ───────────────────────────────────────────── */

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      window.dispatchEvent(new CustomEvent(PAUSE_ALL, { detail: idRef.current }));
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  /* ── Seek via pointer on waveform ───────────────────────────── */

  const seekTo = useCallback((clientX: number) => {
    const audio = audioRef.current;
    const container = waveRef.current;
    if (!audio || !container || !audio.duration || !isFinite(audio.duration)) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
    setCurrentTime(audio.currentTime);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    seekingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  }, [seekTo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!seekingRef.current) return;
    seekTo(e.clientX);
  }, [seekTo]);

  const onPointerUp = useCallback(() => {
    seekingRef.current = false;
  }, []);

  /* ── Format time ────────────────────────────────────────────── */

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
      style={{
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        boxShadow: "inset 0 1px 0 0 rgba(180,200,255,0.06), 0 2px 12px rgba(0,0,0,0.15)",
      }}
    >
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Play / Pause button */}
      <button
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150"
        style={{
          background: playing
            ? "rgba(var(--accent-rgb),0.25)"
            : "linear-gradient(135deg, rgba(var(--primary-rgb),0.3), rgba(var(--accent-rgb),0.3))",
          border: "1px solid rgba(var(--accent-rgb),0.25)",
          boxShadow: playing
            ? "0 0 12px rgba(var(--accent-rgb),0.3)"
            : "0 0 8px rgba(var(--primary-rgb),0.15)",
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-primary-glow">
            <rect x="2" y="2" width="3" height="8" rx="0.5" />
            <rect x="7" y="2" width="3" height="8" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-primary-glow">
            <path d="M3 1.5v9l7.5-4.5L3 1.5z" />
          </svg>
        )}
      </button>

      {/* Waveform bars */}
      <div
        ref={waveRef}
        className="flex flex-1 cursor-pointer items-center gap-[1.5px]"
        style={{ height: 28, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {bars.map((amp, i) => {
          const filled = i / BAR_COUNT < progress;
          return (
            <div
              key={i}
              className="shrink-0 transition-colors duration-150"
              style={{
                width: 2.5,
                borderRadius: 1.5,
                height: `${amp * 100}%`,
                background: filled
                  ? "linear-gradient(180deg, var(--color-accent), var(--color-primary))"
                  : "rgba(255, 255, 255, 0.1)",
                boxShadow: filled ? "0 0 4px rgba(var(--accent-rgb),0.25)" : "none",
              }}
            />
          );
        })}
      </div>

      {/* Time display */}
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/40">
        {fmt(currentTime)}{totalDuration != null ? ` / ${fmt(totalDuration)}` : ""}
      </span>
    </div>
  );
}
