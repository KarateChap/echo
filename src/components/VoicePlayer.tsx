import { useRef, useEffect, useState } from "react";

export function VoicePlayer({ url, duration: durationProp }: { url: string; duration?: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const totalDuration = durationProp ?? mediaDuration;

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

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().catch(() => {}); setPlaying(true); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
      style={{
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        boxShadow: "inset 0 1px 0 0 rgba(180,200,255,0.06), 0 2px 12px rgba(0,0,0,0.15)",
      }}
    >
      <audio ref={audioRef} src={url} preload="metadata" />

      <button
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150"
        style={{
          background: playing
            ? "rgba(168,85,247,0.25)"
            : "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(168,85,247,0.3))",
          border: "1px solid rgba(168,85,247,0.25)",
          boxShadow: playing
            ? "0 0 12px rgba(168,85,247,0.3)"
            : "0 0 8px rgba(99,102,241,0.15)",
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-purple-300">
            <rect x="2" y="2" width="3" height="8" rx="0.5" />
            <rect x="7" y="2" width="3" height="8" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-purple-300">
            <path d="M3 1.5v9l7.5-4.5L3 1.5z" />
          </svg>
        )}
      </button>

      <div className="flex-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{
              width: `${progress * 100}%`,
              background: "linear-gradient(90deg, #6366f1, #a855f7)",
              boxShadow: progress > 0 ? "0 0 6px rgba(168,85,247,0.4)" : "none",
            }}
          />
        </div>
      </div>

      <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/40">
        {fmt(currentTime)}{totalDuration != null ? ` / ${fmt(totalDuration)}` : ""}
      </span>
    </div>
  );
}
