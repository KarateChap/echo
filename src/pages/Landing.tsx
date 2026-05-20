import { usePrivy, useLoginWithEmail } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import ParticleWaveBackground from "@/components/ParticleWaveBackground";
import { AudioLevelProvider } from "@/lib/AudioLevelContext";

type Step = "email" | "otp";

export default function Landing() {
  const { ready, authenticated } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (ready && authenticated) navigate("/app", { replace: true });
  }, [ready, authenticated, navigate]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      await sendCode({ email: email.trim() });
      setStep("otp");
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      setError(err?.message || "Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;

    const next = [...otp];
    next[index] = value;
    setOtp(next);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (value && next.every((d) => d !== "")) {
      submitOtp(next.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = [...otp];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setOtp(next);
    if (pasted.length === 6) {
      submitOtp(next.join(""));
    } else {
      otpRefs.current[pasted.length]?.focus();
    }
  };

  const submitOtp = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      await loginWithCode({ code });
    } catch (err: any) {
      setError(err?.message || "Invalid code. Please try again.");
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AudioLevelProvider>
        <ParticleWaveBackground />
      </AudioLevelProvider>

      <div className="relative z-10 grid h-full place-items-center px-6">
        <div
          className="w-full max-w-sm"
          style={{ animation: "fade-in-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both" }}
        >
          {/* Glow behind card */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 mx-auto h-64 w-64 rounded-full opacity-30 blur-[80px]"
            style={{ background: "radial-gradient(circle, #6366f1 0%, #a855f7 50%, transparent 70%)" }}
          />

          <div className="glass-card relative space-y-7 px-5 py-8 sm:px-8 text-center">
            {/* Desktop browser pill badge */}
            <div className="flex justify-center">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-white/50"
                style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.15))" }}
              >
                <svg className="h-3 w-3 text-primary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Built for Desktop Browser
              </span>
            </div>

            {/* Echo icon */}
            <img src="/echo-icon.png" alt="Echo" className="mx-auto h-20" style={{ filter: "drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))" }} />

            {/* Branding */}
            <div className="space-y-2">
              <p className="text-balance text-[15px] leading-relaxed text-white/50">
                Voice-first remittance. Send love home&thinsp;&mdash;&thinsp;not just money.
              </p>
            </div>

            {/* Email step */}
            {step === "email" && (
              <form onSubmit={handleSendCode} className="space-y-4">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="glass-input px-4 py-3 text-center"
                  autoFocus
                  disabled={loading || !ready}
                />
                <button
                  type="submit"
                  disabled={loading || !ready || !email.trim()}
                  className="btn-primary w-full rounded-2xl px-6 py-3 text-[15px]"
                >
                  {loading ? "Sending code…" : "Continue with email"}
                </button>
              </form>
            )}

            {/* OTP step */}
            {step === "otp" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  {/* Mail icon */}
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <p className="break-all text-sm text-white/50">
                    Enter the 6-digit code sent to{" "}
                    <span className="font-medium text-white/80">{email}</span>
                  </p>
                </div>
                <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      disabled={loading}
                      className="glass-input h-12 w-10 min-w-0 text-center text-lg font-semibold tracking-wider"
                    />
                  ))}
                </div>
                <button
                  onClick={() => submitOtp(otp.join(""))}
                  disabled={loading || otp.some((d) => !d)}
                  className="btn-primary w-full rounded-2xl px-6 py-3 text-[15px]"
                >
                  {loading ? "Verifying…" : "Verify"}
                </button>
                <button
                  onClick={() => {
                    setStep("email");
                    setOtp(["", "", "", "", "", ""]);
                    setError("");
                  }}
                  className="text-sm text-white/40 transition-colors hover:text-white/70"
                >
                  ← Use a different email
                </button>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            {/* Divider */}
            <div className="border-t border-white/[0.06]" />

            {/* Feature highlights */}
            <div className="flex justify-center gap-6 text-[11px] text-white/30">
              <div className="flex flex-col items-center gap-1.5">
                <svg className="h-4 w-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                <span>Voice-first</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <svg className="h-4 w-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span>Instant</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <svg className="h-4 w-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Secure</span>
              </div>
            </div>

            {/* Mobile apps — Phase 2 */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/25">Mobile apps coming soon in Phase 2</p>
              <div className="flex items-center justify-center gap-2.5">
                {/* App Store badge */}
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 opacity-50">
                  <svg className="h-4 w-4 shrink-0 text-white/40" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                  <span className="text-[11px] font-medium text-white/40">App Store</span>
                </div>
                {/* Google Play badge */}
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 opacity-50">
                  <svg className="h-4 w-4 shrink-0 text-white/40" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3.18 1.52a1.16 1.16 0 0 0-.43.93v19.1c0 .37.16.72.43.93l.05.03L13.58 12 3.23 1.49l-.05.03zM17.55 15.95l-3.97-3.95 3.97-3.95 .04.02 4.71 2.68c1.34.76 1.34 2.01 0 2.78l-4.71 2.68-.04-.26zM14.14 12.56l-4.32 4.32L4.2 22.2c.44.25.98.22 1.4-.06l12.51-7.1-3.97-2.48zM14.14 11.44L17.55 8.96 5.6 1.86c-.42-.28-.96-.31-1.4-.06l5.62 5.32 4.32 4.32z" />
                  </svg>
                  <span className="text-[11px] font-medium text-white/40">Google Play</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-[11px] text-white/20">
            Powered by Morph
          </p>
        </div>
      </div>
    </>
  );
}
