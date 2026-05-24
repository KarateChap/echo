import { useEffect, useRef, useState, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import AudioVisualizer from "@/components/AudioVisualizer";
import ParticleWaveBackground from "@/components/ParticleWaveBackground";
import { AudioLevelProvider, useAudioLevelContext } from "@/lib/AudioLevelContext";
import { useAudioAnalyser } from "@/lib/useAudioAnalyser";

/* ── Floating ambient particles (memoized — static content) ── */
const FloatingParticles = memo(function FloatingParticles() {
  const particles = useRef(
    Array.from({ length: 10 }).map((_, i) => ({
      w: 2 + Math.random() * 2,
      left: Math.random() * 100,
      top: Math.random() * 100,
      bg: i % 2 === 0 ? "rgba(99, 102, 241, 0.3)" : "rgba(168, 85, 247, 0.25)",
      delay: Math.random() * 6,
      duration: 8 + Math.random() * 6,
    })),
  ).current;

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {particles.map((p, i) => (
        <div
          key={i}
          className="showcase-particle absolute rounded-full"
          style={{
            width: p.w,
            height: p.w,
            left: `${p.left}%`,
            top: `${p.top}%`,
            background: p.bg,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
});

/* ── Responsive orb size: considers both width and height ── */
function useOrbSize() {
  const calc = () => {
    const w = window.innerWidth;
    // Desktop (≥1024px): allow a larger orb
    if (w >= 1024) return Math.min(w * 0.45, window.innerHeight * 0.7, 820);
    return Math.min(w * 0.82, window.innerHeight * 0.48, 620);
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const onResize = () => setSize(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/* ── Gradient heading style matching the orb aesthetic ── */
const HEADING_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(160,150,255,0.7) 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  filter: "drop-shadow(0 0 18px rgba(99, 102, 241, 0.35)) drop-shadow(0 0 40px rgba(168, 85, 247, 0.2))",
};

/* ── Static orb: lightweight CSS-only version for inactive sections ── */
function StaticOrb({ size }: { size: number }) {
  return (
    <div className="pointer-events-none" style={{ width: size, height: size }} aria-hidden>
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `
            radial-gradient(circle at 35% 35%,
              rgba(130, 140, 255, 0.4) 0%,
              rgba(90, 100, 240, 0.3) 20%,
              rgba(60, 55, 200, 0.25) 45%,
              rgba(30, 25, 130, 0.2) 70%,
              rgba(15, 12, 80, 0.18) 90%,
              rgba(8, 6, 40, 0.12) 100%
            )`,
          boxShadow: `
            0 0 80px rgba(80, 90, 220, 0.15),
            0 0 160px rgba(60, 50, 180, 0.08),
            inset 0 0 60px rgba(100, 110, 200, 0.06)`,
          border: "1px solid rgba(120, 130, 255, 0.15)",
        }}
      />
    </div>
  );
}

/* ── Section wrapper: renders real orb for active, static for others ── */
function SectionOrb({ isActive, micLevelRef, hasMic, size }: {
  isActive: boolean;
  micLevelRef: React.MutableRefObject<number>;
  hasMic: boolean;
  size: number;
}) {
  if (isActive) {
    return <AudioVisualizer levelRef={micLevelRef} active={hasMic} size={size} circularWaves />;
  }
  // On mobile, hide inactive orbs entirely to prevent bleed into adjacent sections
  if (window.innerWidth < 1024) return <div style={{ width: size, height: size }} />;
  return <StaticOrb size={size} />;
}

const PAYMENT_TYPES = [
  { icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8", label: "Instant" },
  { icon: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z", label: "Scheduled" },
  { icon: "M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3", label: "Recurring" },
  { icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", label: "Conditional" },
];

/* ── Bridge: syncs mic level ref into AudioLevelContext for ParticleWaveBackground ── */
function MicLevelBridge({ micLevelRef }: { micLevelRef: React.MutableRefObject<number> }) {
  const { audioLevelRef } = useAudioLevelContext();
  useEffect(() => {
    const id = setInterval(() => { audioLevelRef.current = micLevelRef.current; }, 50);
    return () => clearInterval(id);
  }, [audioLevelRef, micLevelRef]);
  return null;
}

export default function Showcase() {
  return (
    <AudioLevelProvider>
      <ShowcaseInner />
    </AudioLevelProvider>
  );
}

function ShowcaseInner() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  const orbSize = useOrbSize();
  const isSm = orbSize < 380;

  // Passive mic stream — single instance
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micLevelRef = useAudioAnalyser(micStream);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => { stream = s; setMicStream(s); })
      .catch(() => {});
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const TOTAL = 5;
  const hasMic = micStream !== null;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          entries.forEach((e) => {
            const idx = Number(e.target.getAttribute("data-idx"));
            if (e.isIntersecting) {
              next.add(idx);
              if (e.intersectionRatio > 0.5) setActive(idx);
            }
          });
          return next;
        });
      },
      { root: container, threshold: [0.1, 0.5] },
    );
    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Convert vertical mouse wheel to horizontal snap navigation
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let wheelCooldown = false;
    const onWheel = (e: WheelEvent) => {
      // Only redirect vertical scroll (mouse wheel); trackpad horizontal is already fine
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      if (wheelCooldown) return;
      // Determine direction and snap to next/prev section
      const direction = e.deltaY > 0 ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(TOTAL - 1, active + direction));
      if (nextIdx !== active) {
        sectionRefs.current[nextIdx]?.scrollIntoView({ behavior: "smooth", inline: "start" });
      }
      wheelCooldown = true;
      setTimeout(() => { wheelCooldown = false; }, 700);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [active]);

  const scrollTo = useCallback((idx: number) => {
    sectionRefs.current[idx]?.scrollIntoView({ behavior: "smooth", inline: "start" });
  }, []);

  const finish = useCallback(() => { navigate("/login"); }, [navigate]);

  // Responsive classes
  const headingCls = isSm ? "text-lg font-semibold" : "text-3xl font-semibold sm:text-4xl";
  const subCls = isSm ? "text-[11px]" : "text-[15px]";
  const iconBox = isSm ? "h-8 w-8" : "h-16 w-16";
  const iconSvg = isSm ? "h-4 w-4" : "h-7 w-7";
  const gapCls = isSm ? "gap-2" : "gap-6";
  const logoCls = isSm ? "h-10" : "h-24";
  const logoSmCls = isSm ? "h-7" : "h-16";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <MicLevelBridge micLevelRef={micLevelRef} />
      {/* Top particle wave */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ clipPath: "inset(0 0 50% 0)" }}>
        <ParticleWaveBackground lite />
      </div>
      {/* Bottom particle wave — mirrored, clipped to bottom half */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ clipPath: "inset(50% 0 0 0)", transform: "scaleY(-1)" }}>
        <ParticleWaveBackground lite />
      </div>
      <FloatingParticles />

      {/* Skip button */}
      <button onClick={finish} className="fixed right-5 top-5 z-50 text-xs font-medium text-white/30 transition hover:text-white/70">
        Skip
      </button>

      {/* Horizontal scroll container — orb inside each section */}
      <div
        ref={scrollRef}
        className="scrollbar-hide flex h-full snap-x snap-mandatory overflow-x-auto"
        style={{ scrollBehavior: "smooth" }}
      >
        {/* ──── Section 1: Hero ──── */}
        <section ref={(el) => { sectionRefs.current[0] = el; }} data-idx={0} className="relative flex h-full w-screen shrink-0 snap-start items-center justify-center overflow-hidden">
          <div className={`relative flex items-center justify-center transition-all duration-700 ${visible.has(0) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <SectionOrb isActive={active === 0} micLevelRef={micLevelRef} hasMic={hasMic} size={orbSize} />
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${isSm ? "gap-3 px-6" : "gap-5 px-8"}`}>
              <img src="/echo-icon.png" alt="Echo" className={`${logoCls} drop-shadow-[0_0_24px_rgba(99,102,241,0.5)]`} />
              <p className={`max-w-xs text-center ${isSm ? "text-sm" : "text-base"} leading-relaxed text-white/50`}>
                Send love home&thinsp;&mdash;&thinsp;not just money.
              </p>
            </div>
          </div>
          <div className={`absolute ${isSm ? "bottom-16" : "bottom-24"} left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/20 showcase-scroll-hint`}>
            <span className="text-[10px] uppercase tracking-widest">Scroll</span>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </section>

        {/* ──── Section 2: Voice ──── */}
        <section ref={(el) => { sectionRefs.current[1] = el; }} data-idx={1} className="relative flex h-full w-screen shrink-0 snap-start items-center justify-center overflow-hidden">
          <div className={`relative flex items-center justify-center transition-all duration-700 ${visible.has(1) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <SectionOrb isActive={active === 1} micLevelRef={micLevelRef} hasMic={hasMic} size={orbSize} />
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${gapCls} px-6`}>
              <div className={`flex ${iconBox} items-center justify-center rounded-full`} style={{ background: "rgba(99, 102, 241, 0.12)", border: "1px solid rgba(99, 102, 241, 0.2)" }}>
                <svg className={`${iconSvg} text-indigo-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </div>
              <h2 className={headingCls} style={HEADING_STYLE}>Just speak.</h2>
              <p className={`max-w-[220px] text-center ${subCls} leading-relaxed text-white/45`}>
                Say it in any language.<br />Echo understands.
              </p>
            </div>
          </div>
        </section>

        {/* ──── Section 3: Smart Payments ──── */}
        <section ref={(el) => { sectionRefs.current[2] = el; }} data-idx={2} className="relative flex h-full w-screen shrink-0 snap-start items-center justify-center overflow-hidden">
          <div className={`relative flex items-center justify-center transition-all duration-700 ${visible.has(2) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <SectionOrb isActive={active === 2} micLevelRef={micLevelRef} hasMic={hasMic} size={orbSize} />
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${isSm ? "gap-3 px-4" : "gap-5 px-8"}`}>
              <h2 className={`${headingCls} text-center`} style={HEADING_STYLE}>One voice.<br />Every payment.</h2>
              <div className={`grid grid-cols-2 ${isSm ? "gap-1" : "gap-2.5"} mt-1`}>
                {PAYMENT_TYPES.map(({ icon, label }) => (
                  <div key={label} className={`flex flex-col items-center ${isSm ? "gap-0.5 rounded-md px-2 py-1.5" : "gap-1.5 rounded-xl px-4 py-3"}`} style={{ background: "rgba(140, 160, 255, 0.06)", border: "1px solid rgba(140, 160, 255, 0.08)" }}>
                    <svg className={`${isSm ? "h-3 w-3" : "h-4 w-4"} text-purple-400/80`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={icon} />
                    </svg>
                    <span className={`${isSm ? "text-[8px]" : "text-[11px]"} font-medium text-white/55`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ──── Section 4: Voice Message ──── */}
        <section ref={(el) => { sectionRefs.current[3] = el; }} data-idx={3} className="relative flex h-full w-screen shrink-0 snap-start items-center justify-center overflow-hidden">
          <div className={`relative flex items-center justify-center transition-all duration-700 ${visible.has(3) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <SectionOrb isActive={active === 3} micLevelRef={micLevelRef} hasMic={hasMic} size={orbSize} />
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${gapCls} px-6`}>
              <div className={`flex ${iconBox} items-center justify-center rounded-full`} style={{ background: "rgba(168, 85, 247, 0.1)", border: "1px solid rgba(168, 85, 247, 0.18)" }}>
                <svg className={`${iconSvg} text-purple-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <h2 className={`${headingCls} text-center`} style={HEADING_STYLE}>Add your voice.</h2>
              <p className={`max-w-[240px] text-center ${subCls} leading-relaxed text-white/45`}>
                Record a message.<br />They'll hear you when they claim.
              </p>
            </div>
          </div>
        </section>

        {/* ──── Section 5: CTA ──── */}
        <section ref={(el) => { sectionRefs.current[4] = el; }} data-idx={4} className="relative flex h-full w-screen shrink-0 snap-start items-center justify-center overflow-hidden">
          <div className={`relative flex items-center justify-center transition-all duration-700 ${visible.has(4) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <SectionOrb isActive={active === 4} micLevelRef={micLevelRef} hasMic={hasMic} size={orbSize} />
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${gapCls} px-6`}>
              <img src="/echo-icon.png" alt="Echo" className={`${logoSmCls} drop-shadow-[0_0_20px_rgba(99,102,241,0.4)]`} />
              <h2 className={isSm ? "text-2xl font-semibold" : "text-5xl font-semibold sm:text-6xl"} style={HEADING_STYLE}>Ready?</h2>
              <button onClick={finish} className={`btn-accent rounded-2xl ${isSm ? "px-6 py-2 text-xs" : "mt-1 px-10 py-3.5 text-base"} tracking-wide`}>
                Get Started
              </button>
            </div>
          </div>
          <p className={`absolute ${isSm ? "bottom-16" : "bottom-24"} text-[11px] text-white/20`}>Powered by Morph</p>
        </section>
      </div>

      {/* Dot indicators */}
      <div className={`fixed ${isSm ? "bottom-5" : "bottom-8"} left-1/2 z-50 flex -translate-x-1/2 gap-2`}>
        {Array.from({ length: TOTAL }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            className="h-2 rounded-full transition-all duration-300"
            style={{
              width: i === active ? 24 : 8,
              background: i === active
                ? "linear-gradient(135deg, rgba(99,102,241,0.9), rgba(168,85,247,0.9))"
                : "rgba(255, 255, 255, 0.15)",
            }}
            aria-label={`Go to section ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
