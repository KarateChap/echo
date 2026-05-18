import { useRef, useEffect, useCallback } from "react";

interface Props {
  level: number;
  active: boolean;
  recording?: boolean;
  size?: number;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  waiting?: boolean;
}

const TAU = Math.PI * 2;

export default function AudioVisualizer({
  level,
  active,
  recording = false,
  size = 280,
  onClick,
  disabled,
  label,
  waiting = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothLevelRef = useRef(0);
  const timeRef = useRef(0);
  const rafRef = useRef(0);
  // Smooth transition between circular (0) and horizontal (1) wave mode
  const modeMixRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const orbR = size * 0.38;
    const time = timeRef.current;
    timeRef.current += 0.016;

    // Smooth level
    const target = active ? level : 0;
    const speed = target > smoothLevelRef.current ? 0.55 : 0.08;
    smoothLevelRef.current += (target - smoothLevelRef.current) * speed;
    const sl = smoothLevelRef.current;

    // Blend between circular (idle) and horizontal (active) mode
    const targetMix = active ? 1 : 0;
    modeMixRef.current += (targetMix - modeMixRef.current) * 0.06;
    const mix = modeMixRef.current; // 0 = circular, 1 = horizontal

    // Idle breathing
    const idlePulse = waiting ? 0.03 + 0.02 * Math.sin(time * 1.2) : 0;
    const effectLevel = Math.max(sl, idlePulse);

    ctx.clearRect(0, 0, size, size);

    // ---- Deep outer atmosphere ----
    const atmoR = orbR * (1.8 + effectLevel * 1.2);
    const atmo = ctx.createRadialGradient(cx, cy, orbR * 0.3, cx, cy, atmoR);
    atmo.addColorStop(0, `rgba(80, 90, 220, ${0.15 + effectLevel * 0.25})`);
    atmo.addColorStop(0.3, `rgba(100, 80, 240, ${0.08 + effectLevel * 0.15})`);
    atmo.addColorStop(0.6, `rgba(60, 50, 180, ${0.04 + effectLevel * 0.08})`);
    atmo.addColorStop(1, "rgba(8, 12, 24, 0)");
    ctx.fillStyle = atmo;
    ctx.fillRect(0, 0, size, size);

    // ---- Sphere body ----
    const sphereGrad = ctx.createRadialGradient(
      cx - orbR * 0.3, cy - orbR * 0.3, orbR * 0.05,
      cx, cy, orbR,
    );
    sphereGrad.addColorStop(0, `rgba(130, 140, 255, ${0.4 + effectLevel * 0.2})`);
    sphereGrad.addColorStop(0.2, `rgba(90, 100, 240, ${0.3 + effectLevel * 0.15})`);
    sphereGrad.addColorStop(0.45, `rgba(60, 55, 200, ${0.25 + effectLevel * 0.1})`);
    sphereGrad.addColorStop(0.7, `rgba(30, 25, 130, ${0.2 + effectLevel * 0.08})`);
    sphereGrad.addColorStop(0.9, `rgba(15, 12, 80, ${0.18 + effectLevel * 0.05})`);
    sphereGrad.addColorStop(1, "rgba(8, 6, 40, 0.12)");

    ctx.beginPath();
    ctx.arc(cx, cy, orbR, 0, TAU);
    ctx.fillStyle = sphereGrad;
    ctx.fill();

    // ---- Glass rim highlight ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, orbR, 0, TAU);
    ctx.clip();

    const rimGrad = ctx.createRadialGradient(
      cx - orbR * 0.45, cy - orbR * 0.45, orbR * 0.05,
      cx - orbR * 0.15, cy - orbR * 0.15, orbR * 0.95,
    );
    rimGrad.addColorStop(0, `rgba(200, 210, 255, ${0.3 + effectLevel * 0.12})`);
    rimGrad.addColorStop(0.2, `rgba(160, 170, 255, ${0.12 + effectLevel * 0.05})`);
    rimGrad.addColorStop(0.5, "rgba(100, 110, 200, 0.04)");
    rimGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rimGrad;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // ---- Sphere edge ring ----
    ctx.beginPath();
    ctx.arc(cx, cy, orbR, 0, TAU);
    ctx.strokeStyle = `rgba(120, 130, 255, ${0.15 + effectLevel * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ---- Waves: blend between circular (border) and horizontal modes ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, orbR - 1, 0, TAU);
    ctx.clip();

    const waveConfigs = [
      { freq: 3.0, ampScale: 1.0, speed: 2.5, phase: 0, color: [255, 255, 255], width: 2.5, glow: 16 },
      { freq: 4.2, ampScale: 0.8, speed: 2.0, phase: 1.0, color: [180, 220, 255], width: 2.0, glow: 14 },
      { freq: 5.0, ampScale: 0.65, speed: 3.0, phase: 2.2, color: [140, 130, 255], width: 1.8, glow: 12 },
      { freq: 2.2, ampScale: 0.9, speed: 1.6, phase: 3.5, color: [180, 140, 255], width: 2.2, glow: 15 },
      { freq: 6.0, ampScale: 0.45, speed: 3.5, phase: 0.5, color: [100, 140, 255], width: 1.4, glow: 10 },
    ];

    const steps = 180;

    for (const wave of waveConfigs) {
      const baseAmp = waiting ? orbR * 0.04 : orbR * 0.02;
      const reactiveAmp = orbR * 0.4 * effectLevel * wave.ampScale;
      const amp = baseAmp + reactiveAmp;

      ctx.beginPath();

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;

        // Sine displacement for this point
        const sine = Math.sin(t * wave.freq * TAU + time * wave.speed + wave.phase)
          + Math.sin(t * wave.freq * 1.7 * TAU + time * wave.speed * 0.8 + wave.phase + 0.5) * 0.25;
        const displacement = sine * amp;

        // === CIRCULAR MODE (border waves) ===
        const angle = t * TAU;
        const circR = orbR - 4 + displacement;
        const circX = cx + circR * Math.cos(angle);
        const circY = cy + circR * Math.sin(angle);

        // === HORIZONTAL MODE (cross-section waves) ===
        const hx = (cx - orbR) + t * (orbR * 2);
        const distFromCenterH = Math.abs(hx - cx) / orbR;
        const envelope = Math.pow(Math.max(0, 1 - distFromCenterH * distFromCenterH), 0.7);
        const hy = cy + displacement * envelope;

        // Blend between the two modes
        const px = circX * (1 - mix) + hx * mix;
        const py = circY * (1 - mix) + hy * mix;

        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }

      // Close the path in circular mode for seamless loop
      if (mix < 0.5) ctx.closePath();

      const alpha = waiting ? 0.25 + effectLevel * 2 : 0.1 + effectLevel * 0.85;
      const [r, g, b] = wave.color;

      // Broad glow
      ctx.save();
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(alpha * 0.8, 0.7)})`;
      ctx.shadowBlur = wave.glow + effectLevel * 22;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.35})`;
      ctx.lineWidth = wave.width + effectLevel * 4;
      ctx.stroke();
      ctx.restore();

      // Mid glow
      ctx.save();
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`;
      ctx.shadowBlur = wave.glow * 0.5 + effectLevel * 8;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`;
      ctx.lineWidth = wave.width + effectLevel * 1.5;
      ctx.stroke();
      ctx.restore();

      // Sharp core
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(alpha * 1.1, 1)})`;
      ctx.lineWidth = wave.width;
      ctx.stroke();
    }

    // ---- Center glow ----
    const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 0.55);
    centerGlow.addColorStop(0, `rgba(220, 220, 255, ${0.06 + effectLevel * 0.15})`);
    centerGlow.addColorStop(0.3, `rgba(140, 140, 255, ${0.03 + effectLevel * 0.08})`);
    centerGlow.addColorStop(0.7, `rgba(80, 80, 200, ${0.01 + effectLevel * 0.03})`);
    centerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, size, size);

    ctx.restore();

    // ---- Recording indicator ----
    if (recording) {
      const dotX = cx + orbR * 0.55;
      const dotY = cy - orbR * 0.55;
      const pulse = 0.6 + 0.4 * Math.sin(time * 4);

      ctx.save();
      ctx.shadowColor = `rgba(239, 68, 68, ${pulse * 0.7})`;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 5, 0, TAU);
      ctx.fillStyle = `rgba(239, 68, 68, ${pulse})`;
      ctx.fill();
      ctx.restore();
    }

    // ---- Vignette mask ----
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const mask = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(0.65, "rgba(0,0,0,1)");
    mask.addColorStop(0.88, "rgba(0,0,0,0.4)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    rafRef.current = requestAnimationFrame(draw);
  }, [size, level, active, recording, waiting]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        disabled={disabled}
        className="relative cursor-pointer border-none bg-transparent p-0 outline-none focus:outline-none"
        style={{ width: size, height: size }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          className="block"
        />
      </button>
      {label && (
        <span className="text-sm text-white/60 text-center max-w-[240px]">{label}</span>
      )}
    </div>
  );
}
