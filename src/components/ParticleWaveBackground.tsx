import { useRef, useEffect } from "react";
import { useAudioLevelContext } from "@/lib/AudioLevelContext";
import { isMobile } from "@/lib/isMobile";

/* ── Grid & camera ────────────────────────────────────────── */
const COLS = isMobile ? 25 : 50;
const ROWS = isMobile ? 35 : 70;
const SPACING = isMobile ? 32 : 16; // world-space gap between particles
const FOCAL = 260;
const CAM_TILT = 0.32; // radians – shallow angle so grid fills full viewport height
const CAM_Y = -340; // camera height above the plane
const CAM_Z_OFFSET = 60; // slight forward push to balance top/bottom coverage

/* ── Wave ─────────────────────────────────────────────────── */
const BASE_AMP = 28;
const MAX_AMP = 80;
const BASE_SPEED = 0.3;
const MAX_SPEED = 0.85;

/* ── Appearance ───────────────────────────────────────────── */
const BASE_ALPHA = 0.2;
const MAX_ALPHA = 0.78;
const SPRITE_RES = 64;
const MAX_DPR = 2;
const CENTER_FADE_R = 100; // px – fade particles near screen center for the orb

/* ── Mouse interaction ────────────────────────────────────── */
const MOUSE_RADIUS = 220; // px – influence radius around cursor
const MOUSE_AMP = 40; // extra wave displacement near cursor
const MOUSE_GLOW = 0.55; // extra alpha near cursor

/* ── Colour palette ───────────────────────────────────────── */
const COL_DEEP = [10, 24, 80]; // dark blue at troughs
const COL_MID = [30, 80, 180]; // mid blue
const COL_PEAK = [0, 220, 255]; // bright cyan at peaks
const COL_GLOW = [100, 240, 255]; // extra bright for highest peaks

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pre-render a soft glow dot sprite. */
function createGlowSprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SPRITE_RES;
  c.height = SPRITE_RES;
  const ctx = c.getContext("2d")!;
  const half = SPRITE_RES / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.7)");
  g.addColorStop(0.45, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_RES, SPRITE_RES);
  return c;
}

interface Particle {
  wx: number;
  wz: number;
}

export default function ParticleWaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { audioLevelRef: levelRef } = useAudioLevelContext();
  const smoothRef = useRef(0);
  const timeRef = useRef(0);
  const rafRef = useRef(0);
  const spriteRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<Particle[]>([]);
  const reducedMotion = useRef(false);
  // Mouse position in screen px; null = no mouse tracked yet
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const mouseActiveRef = useRef(0); // smoothed 0-1 "mouse is moving" signal

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Build grid
    const grid: Particle[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        grid.push({
          wx: (c - COLS / 2) * SPACING,
          wz: (r - ROWS / 2) * SPACING + CAM_Z_OFFSET,
        });
      }
    }
    gridRef.current = grid;
    spriteRef.current = createGlowSprite();

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;

    let w = 0;
    let h = 0;
    const dpr = Math.min(devicePixelRatio, MAX_DPR);

    function resize() {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    resize();

    // Mouse tracking
    let mouseTimeout = 0;
    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      mouseActiveRef.current = 1;
      clearTimeout(mouseTimeout);
      // Fade out mouse effect after 2s of no movement
      mouseTimeout = window.setTimeout(() => {
        mouseActiveRef.current = 0;
      }, 2000);
    }
    function onMouseLeave() {
      mouseActiveRef.current = 0;
    }
    // Touch support for mobile
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (t) {
        mouseRef.current = { x: t.clientX, y: t.clientY };
        mouseActiveRef.current = 1;
        clearTimeout(mouseTimeout);
        mouseTimeout = window.setTimeout(() => {
          mouseActiveRef.current = 0;
        }, 2000);
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    const cosTilt = Math.cos(CAM_TILT);
    const sinTilt = Math.sin(CAM_TILT);

    let lastFrameTime = 0;
    let smoothMouseActive = 0;
    let frameCount = 0;

    function frame(now: number) {
      if (reducedMotion.current) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // On mobile, skip every other frame when idle to save CPU
      frameCount++;
      if (isMobile && levelRef.current < 0.05 && frameCount % 2 !== 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0.016;
      lastFrameTime = now;

      // Smooth audio level (fast attack, slow decay)
      const target = levelRef.current;
      const curr = smoothRef.current;
      smoothRef.current =
        target > curr
          ? curr + (target - curr) * 0.18
          : curr + (target - curr) * 0.035;
      const lvl = smoothRef.current;

      // Smooth mouse activity (fades in/out)
      const mouseTarget = mouseActiveRef.current;
      smoothMouseActive += (mouseTarget - smoothMouseActive) * 0.08;
      // Mouse influence fades out when audio is active
      const mouseInfluence = smoothMouseActive * (1 - clamp01(lvl * 3));
      const mouse = mouseRef.current;

      const speed = lerp(BASE_SPEED, MAX_SPEED, lvl);
      timeRef.current += dt * speed;
      const t = timeRef.current;

      const amp = lerp(BASE_AMP, MAX_AMP, lvl);
      const alphaBase = lerp(BASE_ALPHA, MAX_ALPHA, lvl);

      ctx.clearRect(0, 0, w, h);

      const sprite = spriteRef.current!;
      const particles = gridRef.current;
      const cx = w / 2;
      const cy = h * 0.48; // projection centre slightly above middle

      // Iterate back-to-front (far rows first = small row indices since
      // grid is built with wz increasing, and after tilt, larger wz = further).
      // Actually with our tilt, we need to sort by projected depth.
      // Since rows go from far (r=0) to near (r=ROWS-1), iterate in order.
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = particles[r * COLS + c];

          // Multi-layered wave displacement (Y = up)
          const waveY =
            amp *
            (// Primary rolling wave
            Math.sin(p.wx * 0.014 + t * 0.9) *
              Math.cos(p.wz * 0.012 + t * 0.6) *
              0.5 +
              // Secondary cross-wave for peaks and valleys
              Math.sin(p.wz * 0.02 + t * 0.75 + p.wx * 0.008) * 0.35 +
              // Diagonal ripple
              Math.sin((p.wx + p.wz) * 0.01 + t * 1.2) * 0.2 +
              // Audio-reactive pulse (radial from center)
              Math.sin(
                Math.sqrt(p.wx * p.wx + p.wz * p.wz) * 0.015 - t * 2.0,
              ) *
                lvl *
                0.4);

          // Mouse interaction: displace particles near cursor
          let mouseDisp = 0;
          let mouseGlow = 0;
          if (mouse && mouseInfluence > 0.01) {
            // We need screen position to compare with mouse, but we haven't
            // projected yet. Use a rough pre-projection estimate: project the
            // particle without mouse displacement to get screen coords, then
            // compute distance to mouse cursor.
            const preWy = waveY + CAM_Y;
            const preRotY = preWy * cosTilt - p.wz * sinTilt;
            const preRotZ = preWy * sinTilt + p.wz * cosTilt;
            const preDepth = FOCAL + preRotZ;
            if (preDepth > 30) {
              const preScale = FOCAL / preDepth;
              const preSx = cx + p.wx * preScale;
              const preSy = cy + preRotY * preScale;
              const mdx = preSx - mouse.x;
              const mdy = preSy - mouse.y;
              const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
              if (mDist < MOUSE_RADIUS) {
                const proximity = 1 - mDist / MOUSE_RADIUS;
                // Smooth falloff (ease-out)
                const falloff = proximity * proximity;
                mouseDisp = MOUSE_AMP * falloff * mouseInfluence;
                mouseGlow = MOUSE_GLOW * falloff * mouseInfluence;
              }
            }
          }

          // Camera transform: rotate around X axis (tilt)
          const wy = waveY + mouseDisp + CAM_Y;
          const rotY = wy * cosTilt - p.wz * sinTilt;
          const rotZ = wy * sinTilt + p.wz * cosTilt;

          // Perspective projection
          const depth = FOCAL + rotZ;
          if (depth < 30) continue;
          const scale = FOCAL / depth;
          const sx = cx + p.wx * scale;
          const sy = cy + rotY * scale;

          // Cull off-screen
          if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

          // Depth-based sizing & alpha
          const scaleNorm = clamp01(scale);
          const size = lerp(0.8, 3.2, scaleNorm);
          const depthAlpha = Math.pow(scaleNorm, 1.2);

          // Height-based colour (normalise waveY to 0..1)
          const heightNorm = clamp01((waveY / amp + 1) * 0.5);
          // Audio + mouse push everything brighter
          const ht = clamp01(heightNorm + lvl * 0.25 + mouseGlow * 0.6);

          let red: number, green: number, blue: number;
          if (ht < 0.5) {
            // Deep → mid
            const lt = ht * 2;
            red = Math.round(lerp(COL_DEEP[0], COL_MID[0], lt));
            green = Math.round(lerp(COL_DEEP[1], COL_MID[1], lt));
            blue = Math.round(lerp(COL_DEEP[2], COL_MID[2], lt));
          } else if (ht < 0.85) {
            // Mid → peak cyan
            const lt = (ht - 0.5) / 0.35;
            red = Math.round(lerp(COL_MID[0], COL_PEAK[0], lt));
            green = Math.round(lerp(COL_MID[1], COL_PEAK[1], lt));
            blue = Math.round(lerp(COL_MID[2], COL_PEAK[2], lt));
          } else {
            // Peak → bright glow
            const lt = (ht - 0.85) / 0.15;
            red = Math.round(lerp(COL_PEAK[0], COL_GLOW[0], lt));
            green = Math.round(lerp(COL_PEAK[1], COL_GLOW[1], lt));
            blue = Math.round(lerp(COL_PEAK[2], COL_GLOW[2], lt));
          }

          // Center fade so the orb area stays clean
          const dx = sx - w / 2;
          const dy = sy - h / 2;
          const distFromCenter = Math.sqrt(dx * dx + dy * dy);
          const centerFade =
            distFromCenter < CENTER_FADE_R
              ? (distFromCenter / CENTER_FADE_R) * (distFromCenter / CENTER_FADE_R)
              : 1;

          const alpha = Math.min(1, (alphaBase + mouseGlow) * depthAlpha * centerFade);
          if (alpha < 0.004) continue;

          ctx.globalCompositeOperation = "lighter";

          // Solid dot core
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgb(${red},${green},${blue})`;
          ctx.beginPath();
          ctx.arc(sx, sy, size * 0.7, 0, Math.PI * 2);
          ctx.fill();

          // Glow halo (brighter at peaks)
          const glowSize = size * (3.5 + ht * 2.5);
          ctx.globalAlpha = alpha * (0.25 + ht * 0.3);
          ctx.drawImage(
            sprite,
            sx - glowSize / 2,
            sy - glowSize / 2,
            glowSize,
            glowSize,
          );
        }
      }

      // Subtle connecting lines between neighbours for the "fabric" look
      // Only draw for nearby rows (near camera) to save perf
      // Skip entirely on mobile for performance
      if (!isMobile) {
      ctx.globalCompositeOperation = "lighter";
      const lineStartRow = Math.max(0, ROWS - 20);
      for (let r = lineStartRow; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const i = r * COLS + c;
          const p = particles[i];
          const pRight = particles[i + 1];
          const pDown = particles[i + COLS];

          // Recompute screen positions for line endpoints
          // (we could cache these but keeping it simple)
          const positions: [number, number][] = [];
          for (const pt of [p, pRight, pDown]) {
            const waveYpt =
              amp *
              (Math.sin(pt.wx * 0.014 + t * 0.9) *
                Math.cos(pt.wz * 0.012 + t * 0.6) *
                0.5 +
                Math.sin(pt.wz * 0.02 + t * 0.75 + pt.wx * 0.008) * 0.35 +
                Math.sin((pt.wx + pt.wz) * 0.01 + t * 1.2) * 0.2 +
                Math.sin(
                  Math.sqrt(pt.wx * pt.wx + pt.wz * pt.wz) * 0.015 - t * 2.0,
                ) *
                  lvl *
                  0.4);
            const wy2 = waveYpt + CAM_Y;
            const rY = wy2 * cosTilt - pt.wz * sinTilt;
            const rZ = wy2 * sinTilt + pt.wz * cosTilt;
            const d = FOCAL + rZ;
            if (d < 30) {
              positions.push([-9999, -9999]);
              continue;
            }
            const s = FOCAL / d;
            positions.push([cx + pt.wx * s, cy + rY * s]);
          }

          const [p0, p1, p2] = positions;
          const scaleForLine = FOCAL / (FOCAL + (p.wz * sinTilt + (CAM_Y) * cosTilt + p.wz * cosTilt));
          const lineAlpha = alphaBase * clamp01(scaleForLine) * 0.08;

          if (lineAlpha < 0.003) continue;

          // Horizontal line
          if (p0[0] > -9000 && p1[0] > -9000) {
            const ddx = p0[0] - w / 2;
            const ddy = p0[1] - h / 2;
            const cFade = Math.sqrt(ddx * ddx + ddy * ddy) < CENTER_FADE_R ? 0 : 1;
            if (cFade > 0) {
              ctx.globalAlpha = lineAlpha;
              ctx.strokeStyle = `rgb(${COL_MID[0]},${COL_MID[1]},${COL_MID[2]})`;
              ctx.lineWidth = 0.5;
              ctx.beginPath();
              ctx.moveTo(p0[0], p0[1]);
              ctx.lineTo(p1[0], p1[1]);
              ctx.stroke();
            }
          }

          // Vertical line
          if (p0[0] > -9000 && p2[0] > -9000) {
            const ddx = p0[0] - w / 2;
            const ddy = p0[1] - h / 2;
            const cFade = Math.sqrt(ddx * ddx + ddy * ddy) < CENTER_FADE_R ? 0 : 1;
            if (cFade > 0) {
              ctx.globalAlpha = lineAlpha;
              ctx.strokeStyle = `rgb(${COL_DEEP[0]},${COL_DEEP[1]},${COL_DEEP[2]})`;
              ctx.lineWidth = 0.3;
              ctx.beginPath();
              ctx.moveTo(p0[0], p0[1]);
              ctx.lineTo(p2[0], p2[1]);
              ctx.stroke();
            }
          }
        }
      }
      } // end !isMobile connecting lines

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("touchmove", onTouchMove);
      clearTimeout(mouseTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
