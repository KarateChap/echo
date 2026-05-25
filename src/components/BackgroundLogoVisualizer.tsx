import { useRef, useEffect } from "react";
import { useAudioLevelContext } from "@/lib/AudioLevelContext";

const MAX_OPACITY = 0.15;
const ATTACK = 0.3;   // fast ramp-up
const RELEASE = 0.05; // slow fade-out

export default function BackgroundLogoVisualizer() {
  const { audioLevelRef } = useAudioLevelContext();
  const imgRef = useRef<HTMLImageElement>(null);
  const smoothRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 16.67, 3); // normalize to ~60fps
      prev = now;

      const target = audioLevelRef.current;
      const rate = target > smoothRef.current ? ATTACK : RELEASE;
      smoothRef.current += (target - smoothRef.current) * rate * dt;

      const opacity = smoothRef.current * MAX_OPACITY;
      const scale = 1 + smoothRef.current * 0.05;

      if (imgRef.current) {
        imgRef.current.style.opacity = String(opacity);
        imgRef.current.style.transform = `translate(-50%, -50%) scale(${scale})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioLevelRef]);

  return (
    <img
      ref={imgRef}
      src="/echo-icon.png"
      alt=""
      aria-hidden
      draggable={false}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "65vh",
        height: "auto",
        opacity: 0,
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 0,
        filter: "drop-shadow(0 0 80px rgba(var(--primary-rgb), 0.3))",
      }}
    />
  );
}
