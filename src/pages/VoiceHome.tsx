import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import { useAudioAnalyser } from "@/lib/useAudioAnalyser";
import { useTokenBalances } from "@/lib/useTokenBalances";
import { BUILTIN_TOKENS, type Token } from "@/lib/tokens";
import AudioVisualizer from "@/components/AudioVisualizer";
import DropTargetOverlay from "@/components/DropTargetOverlay";
import AddTokenModal from "@/components/AddTokenModal";
import CustomizeTokensModal from "@/components/CustomizeTokensModal";
import TokenIcon from "@/components/TokenIcon";
import { formatSchedule } from "@/lib/formatSchedule";
import { useUnseenCounts } from "@/lib/useUnseenCounts";
import { useDragToCenter } from "@/lib/useDragToCenter";
import { useAudioLevelContext } from "@/lib/AudioLevelContext";
import { useVisibleTokens } from "@/lib/useVisibleTokens";
import { fundAgentWallet } from "@/lib/fundAgentWallet";
import type { Id } from "../../convex/_generated/dataModel";

type FlowStep = "idle" | "recording" | "processing" | "confirm" | "ask-email" | "ask-voice-msg" | "recording-msg" | "funding" | "done" | "error";
type ProcessingSubStep = "uploading" | "transcribing" | "parsing";

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div
      className="rounded-full transition-all duration-500"
      style={{
        width: active ? 8 : 6,
        height: active ? 8 : 6,
        background: done
          ? "rgba(99, 102, 241, 0.8)"
          : active
            ? "rgba(99, 102, 241, 1)"
            : "rgba(140, 160, 255, 0.15)",
        boxShadow: active ? "0 0 8px rgba(99, 102, 241, 0.6)" : "none",
        animation: active ? "drop-target-pulse 1.5s ease-in-out infinite" : "none",
      }}
    />
  );
}

/** Compute positions for N items evenly spaced in a circle, starting from 12 o'clock clockwise */
function circlePositions(count: number, containerSize: number, radius: number, angleOffset = 0) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2 + angleOffset;
    const x = containerSize / 2 + radius * Math.cos(angle);
    const y = containerSize / 2 + radius * Math.sin(angle);
    return { left: x, top: y };
  });
}

const CONTAINER = 370;
const ORBIT_RADIUS = 148;

export default function VoiceHome() {
  const { user, logout } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy");

  // Custom tokens from Convex
  const customTokensRaw = useQuery(
    api.customTokens.listByUser,
    user ? { privyId: user.id } : "skip",
  );
  const customTokens: Token[] = (customTokensRaw ?? []).map((t) => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address as `0x${string}`,
    decimals: t.decimals,
    icon: t.icon ?? "🔷",
    isCustom: true,
    customTokenId: t._id,
  }));
  const allTokens = useMemo(() => [...BUILTIN_TOKENS, ...customTokens], [customTokens]);
  const { visibleTokens, hiddenTokens, hideToken, showToken, removeToken, MAX_VISIBLE } = useVisibleTokens(allTokens);

  const { balances, loading: balanceLoading } = useTokenBalances(wallet?.address, customTokens);
  const balanceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of balances) {
      const key = `${b.token.symbol}:${b.token.address}`;
      const isEth = b.token.symbol === "ETH";
      map.set(key, parseFloat(b.formatted).toLocaleString(undefined, {
        minimumFractionDigits: isEth ? 4 : 2,
        maximumFractionDigits: isEth ? 4 : 2,
      }));
    }
    return map;
  }, [balances]);
  const { unseenActivity, unseenRules } = useUnseenCounts();
  const addCustomToken = useMutation(api.customTokens.add);
  const removeCustomToken = useMutation(api.customTokens.remove);
  const [showAddToken, setShowAddToken] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);

  const generateUploadUrl = useMutation(api.voiceSessions.generateUploadUrl);
  const createSession = useMutation(api.voiceSessions.create);
  const createRule = useMutation(api.rules.createFromIntent);
  const generateMsgUploadUrl = useMutation(api.voiceMessages.generateUploadUrl);
  const createVoiceMessage = useMutation(api.voiceMessages.create);

  const recorder = useVoiceRecorder();
  const msgRecorder = useVoiceRecorder();
  const msgStartRef = useRef<number>(0);

  // Pre-warm the microphone on mount to eliminate permission popup delay during drag
  useEffect(() => { recorder.prewarmMic(); }, []);

  const [ttsAudioEl, setTtsAudioEl] = useState<HTMLAudioElement | null>(null);
  const micLevelRef = useAudioAnalyser(recorder.stream);
  const ttsLevelRef = useAudioAnalyser(ttsAudioEl);

  // Combined audio level ref — read by AudioVisualizer & ParticleWaveBackground in their RAF loops
  const { audioLevelRef } = useAudioLevelContext();
  // Sync mic+tts levels into the shared ref via a lightweight RAF (no React state updates)
  useEffect(() => {
    let raf = 0;
    function sync() {
      audioLevelRef.current = Math.max(micLevelRef.current, ttsLevelRef.current);
      raf = requestAnimationFrame(sync);
    }
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [audioLevelRef, micLevelRef, ttsLevelRef]);

  const [step, setStep] = useState<FlowStep>("idle");
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<Id<"voiceSessions"> | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [_createdRuleId, setCreatedRuleId] = useState<Id<"rules"> | null>(null);
  const [createdRecipientName, setCreatedRecipientName] = useState("");
  const [msgElapsed, setMsgElapsed] = useState(0);
  const [copiedField, setCopiedField] = useState<"wallet" | "email" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [processingSubStep, setProcessingSubStep] = useState<ProcessingSubStep>("uploading");

  const session = useQuery(
    api.voiceSessions.get,
    sessionId ? { sessionId } : "skip",
  );

  // Check if parsed recipient is already a trusted contact (has email on file)
  let parsedIntentForQuery: any = null;
  try { if (session?.intent) parsedIntentForQuery = JSON.parse(session.intent); } catch {}
  const trustedRecipient = useQuery(
    api.recipients.findTrusted,
    parsedIntentForQuery?.recipient?.name && user
      ? { privyId: user.id, name: parsedIntentForQuery.recipient.name }
      : "skip",
  );
  const [forceAskEmail, setForceAskEmail] = useState(false);

  // Auto-play readback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef<string | null>(null);
  useEffect(() => {
    const url = session?.readbackUrl;
    if (!url || url === hasPlayedRef.current) return;
    hasPlayedRef.current = url;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; setTtsAudioEl(null); }
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    setTtsAudioEl(audio);
    audio.addEventListener("ended", () => setTtsAudioEl(null));
    audio.addEventListener("pause", () => setTtsAudioEl(null));
    audio.play().catch(() => {});
    return () => { audio.pause(); audio.src = ""; setTtsAudioEl(null); };
  }, [session?.readbackUrl]);

  useEffect(() => {
    if (!session || step !== "processing") return;
    if (session.status === "error") {
      setErrorMessage(session.error ?? "Something went wrong. Please try again.");
      setStep("error");
    } else if (session.status === "parsing") {
      setProcessingSubStep("parsing");
    } else if (session.status === "ready") {
      // Wait for intent data before transitioning to confirm
      if (!session.intent) return;
      try {
        const intent = JSON.parse(session.intent);
        if (intent.error) {
          setErrorMessage(intent.error);
          setStep("error");
          return;
        }
      } catch {
        setErrorMessage("Failed to parse your instruction. Please try again.");
        setStep("error");
        return;
      }
      setStep("confirm");
    }
  }, [session?.status, session?.intent, step]);

  const handleTokenTap = useCallback(async (symbol: string) => {
    if (!user) return;
    setSelectedToken(symbol);
    setSessionId(null);
    setRecipientEmail("");
    setCreatedRuleId(null);
    setCreatedRecipientName("");
    setForceAskEmail(false);
    setProcessingSubStep("uploading");
    hasPlayedRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setTtsAudioEl(null);
    setStep("recording");
    await recorder.startRecording();
  }, [user, recorder]);

  async function handleStopRecording() {
    if (!user) return;
    const blob = await recorder.stopRecording();
    if (!blob) return;
    if (!selectedToken) {
      setErrorMessage("No token selected. Please tap a token first.");
      setStep("error");
      return;
    }
    setStep("processing");
    setProcessingSubStep("uploading");
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
      const id = await createSession({ privyId: user.id, audioStorageId: storageId, selectedToken });
      setSessionId(id);
      setProcessingSubStep("transcribing");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to upload recording. Please try again.");
      setStep("error");
    }
  }

  async function handleApprove() {
    if (!session?.intent || !user) return;
    try {
      const intent = JSON.parse(session.intent);
      if (intent.error) return;

      setCreatedRecipientName(intent.recipient?.name ?? "Unknown");

      // If we have a trusted recipient with email on file, skip the email step
      if (trustedRecipient?.contactEmail && !forceAskEmail) {
        setRecipientEmail(trustedRecipient.contactEmail);
        setStep("ask-voice-msg");
      } else {
        setStep("ask-email");
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to process approval. Please try again.");
      setStep("error");
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.intent || !user || !recipientEmail) return;
    setStep("ask-voice-msg");
  }

  async function handleRecordMessage() {
    setStep("recording-msg");
    msgStartRef.current = Date.now();
    await msgRecorder.startRecording();
  }

  async function handleFinalize(voiceBlob?: Blob) {
    if (!session?.intent || !user || !recipientEmail) return;
    try {
      const intent = JSON.parse(session.intent);

      const resolvedToken = selectedToken ?? intent.token;
      if (!resolvedToken) {
        setErrorMessage("Token could not be determined. Please try again.");
        setStep("error");
        return;
      }

      // Fund the agent wallet from the user's Privy wallet
      if (!wallet) {
        setErrorMessage("Wallet not ready. Please try again.");
        setStep("error");
        return;
      }
      const tokenInfo = allTokens.find((t) => t.symbol === resolvedToken);
      if (!tokenInfo) {
        setErrorMessage(`Token ${resolvedToken} not found.`);
        setStep("error");
        return;
      }
      const amount = intent.amount ?? intent.amountUsdc ?? 0;
      if (amount <= 0) {
        setErrorMessage("Invalid amount.");
        setStep("error");
        return;
      }

      setStep("funding");
      const fundingTxHash = await fundAgentWallet({ wallet, token: tokenInfo, amount });

      // Create the rule (triggers executePayment + sendClaimEmail)
      const result = await createRule({
        privyId: user.id,
        recipientName: intent.recipient?.name ?? "Unknown",
        recipientEmail,
        recipientHint: intent.recipient?.hint,
        kind: intent.kind,
        amountUsdc: amount,
        token: resolvedToken,
        schedule: intent.schedule ?? undefined,
        condition: intent.condition ?? undefined,
        fundingTxHash,
      });
      setCreatedRuleId(result.ruleId);
      setCreatedRecipientName(result.recipientName);

      // Attach voice message if recorded
      if (voiceBlob) {
        const uploadUrl = await generateMsgUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": voiceBlob.type },
          body: voiceBlob,
        });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await createVoiceMessage({
          privyId: user.id,
          ruleId: result.ruleId,
          storageId,
          durationSec: Math.floor(msgRecorder.elapsedMs / 1000),
        });
      }

      setStep("done");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setStep("error");
    }
  }

  async function handleStopMessage() {
    const blob = await msgRecorder.stopRecording();
    await handleFinalize(blob ?? undefined);
  }

  function resetFlow() {
    setSessionId(null);
    setStep("idle");
    setSelectedToken(null);
    setRecipientEmail("");
    setCreatedRuleId(null);
    setCreatedRecipientName("");
    setErrorMessage("");
    setForceAskEmail(false);
    setProcessingSubStep("uploading");
    hasPlayedRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setTtsAudioEl(null);
  }

  useEffect(() => {
    if (msgRecorder.status !== "recording") { setMsgElapsed(0); return; }
    const id = setInterval(() => setMsgElapsed(Date.now() - msgStartRef.current), 250);
    return () => clearInterval(id);
  }, [msgRecorder.status]);

  const seconds = Math.floor(recorder.elapsedMs / 1000);
  const remaining = Math.max(0, 30 - seconds);
  const msgSeconds = Math.floor(msgElapsed / 1000);

  const parsedIntentRef = useRef<any>(null);
  try {
    if (session?.intent) parsedIntentRef.current = JSON.parse(session.intent);
  } catch {}
  if (step === "idle") parsedIntentRef.current = null;
  const parsedIntent = parsedIntentRef.current;

  const isOrbActive = step === "recording" || step === "processing";
  const selectedTokenInfo = useMemo(() => allTokens.find((t) => t.symbol === selectedToken), [allTokens, selectedToken]);

  // 6 visible tokens + Add + Customize = 8 orbit slots
  const orbitSlots = visibleTokens.length + 2; // +1 Add, +1 Customize
  const positions = useMemo(() => circlePositions(orbitSlots, CONTAINER, ORBIT_RADIUS), [orbitSlots]);

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useDragToCenter({
    containerRef,
    containerSize: CONTAINER,
    dropRadius: 65,
    onDrop: (symbol) => handleTokenTap(symbol),
  });

  // Find the dragged token info for ghost clone rendering
  const dragActive = drag.isDragging || drag.phase === "snapping" || drag.phase === "returning";
  const draggedTokenInfo = useMemo(
    () => dragActive ? allTokens.find((t) => t.symbol === drag.draggedToken) : null,
    [dragActive, drag.draggedToken, allTokens],
  );
  const draggedFormatted = useMemo(() => {
    if (!draggedTokenInfo) return "0.00";
    const bal = balances.find((b) => b.token.symbol === draggedTokenInfo.symbol && b.token.address === draggedTokenInfo.address);
    if (!bal) return "0.00";
    return parseFloat(bal.formatted).toLocaleString(undefined, {
      minimumFractionDigits: draggedTokenInfo.symbol === "ETH" ? 4 : 2,
      maximumFractionDigits: draggedTokenInfo.symbol === "ETH" ? 4 : 2,
    });
  }, [draggedTokenInfo, balances]);

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-6 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Echo</h1>
        <button onClick={logout} className="glass-nav text-xs">Sign out</button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 pt-12">

        {/* === ORB + TOKENS: shown during idle, recording, processing === */}
        {(step === "idle" || step === "recording" || step === "processing") && (
          <>
            <div ref={containerRef} className="relative" style={{ width: CONTAINER, height: CONTAINER }}>
              {/* Center orb */}
              <div className="absolute inset-0 flex items-center justify-center">
                <AudioVisualizer
                  levelRef={audioLevelRef}
                  active={isOrbActive}
                  recording={step === "recording"}
                  size={160}
                  onClick={step === "recording" ? handleStopRecording : undefined}
                  disabled={step === "processing"}
                  waiting={step === "idle"}
                />
              </div>

              {/* Drop target overlay — on top of canvas, below badges */}
              <DropTargetOverlay
                state={
                  step !== "idle" ? "hidden" :
                  drag.isOverDropZone ? "hovering" :
                  drag.isDragging ? "dragging" :
                  "idle"
                }
              />

              {/* Token badges orbiting the orb */}
              {visibleTokens.map((token, i) => {
                const formatted = balanceMap.get(`${token.symbol}:${token.address}`) ?? (balanceLoading ? "…" : "0.00");

                const isSelected = selectedToken === token.symbol;
                const pos = positions[i];
                const isBeingDragged = drag.draggedToken === token.symbol && drag.isDragging;
                const anotherIsDragging = drag.isDragging && drag.draggedToken !== token.symbol;

                if (step !== "idle" && !isSelected) return null;

                return (
                  <button
                    key={token.symbol + token.address}
                    onClick={() => {
                      if (drag.suppressClick()) return;
                      if (step === "idle") handleTokenTap(token.symbol);
                    }}
                    disabled={step !== "idle"}
                    className={[
                      "absolute z-10 flex items-center gap-2 rounded-2xl px-3 py-2 transition-all duration-500 ease-out select-none",
                      step === "idle"
                        ? "border border-indigo-400/15 bg-white/[0.04] backdrop-blur-xl hover:border-indigo-400/30 hover:bg-white/[0.07] active:scale-95 cursor-grab"
                        : "border border-primary/30 bg-primary/10 backdrop-blur-xl pointer-events-none",
                    ].join(" ")}
                    style={{
                      ...(step === "idle"
                        ? { left: pos.left, top: pos.top, transform: "translate(-50%, -50%)" }
                        : { top: "2%", left: "50%", transform: "translate(-50%, 0)" }),
                      touchAction: step === "idle" ? "none" : undefined,
                      opacity: isBeingDragged ? 0.3 : anotherIsDragging ? 0.3 : 1,
                      scale: isBeingDragged ? "0.9" : undefined,
                      boxShadow: step === "idle" && !isBeingDragged && !anotherIsDragging
                        ? "0 0 14px rgba(99,102,241,0.1), 0 0 5px rgba(140,160,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)"
                        : undefined,
                    }}
                    {...(step === "idle" ? drag.bind(token.symbol, i, pos.left, pos.top) : {})}
                  >
                    <TokenIcon icon={token.icon} size={20} className="text-lg" />
                    <div className="text-left">
                      <div className="text-xs font-semibold leading-tight">{token.symbol}</div>
                      <div className="text-[10px] tabular-nums text-white/40">{formatted}</div>
                    </div>
                  </button>
                );
              })}

              {/* Add token button — in orbit */}
              {step === "idle" && (
                <button
                  onClick={() => setShowAddToken(true)}
                  className="absolute z-10 flex items-center gap-1.5 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2 backdrop-blur-xl transition-all hover:border-white/[0.2] hover:bg-white/[0.06] active:scale-95"
                  style={{
                    left: positions[visibleTokens.length]?.left ?? CONTAINER / 2,
                    top: positions[visibleTokens.length]?.top ?? CONTAINER - 20,
                    transform: "translate(-50%, -50%)",
                    opacity: drag.isDragging ? 0.3 : 1,
                  }}
                >
                  <span className="text-sm text-white/30" style={{ lineHeight: 0, position: 'relative', top: '-1.5px' }}>+</span>
                  <span className="text-[10px] leading-none text-white/30">Add</span>
                </button>
              )}

              {/* Customize button — in orbit */}
              {step === "idle" && (
                <button
                  onClick={() => setShowCustomize(true)}
                  className="absolute z-10 flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 backdrop-blur-xl transition-all hover:border-white/[0.18] hover:bg-white/[0.06] active:scale-95"
                  style={{
                    left: positions[visibleTokens.length + 1]?.left ?? CONTAINER / 2,
                    top: positions[visibleTokens.length + 1]?.top ?? CONTAINER - 20,
                    transform: "translate(-50%, -50%)",
                    opacity: drag.isDragging ? 0.3 : 1,
                  }}
                >
                  <svg className="h-4 w-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                  </svg>
                  <span className="text-[10px] text-white/30">Edit</span>
                  {hiddenTokens.length > 0 && (
                    <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/30 px-1 text-[9px] font-bold text-white/70">
                      {hiddenTokens.length}
                    </span>
                  )}
                </button>
              )}

              {/* Drag ghost clone */}
              {draggedTokenInfo && (drag.isDragging || drag.phase === "snapping" || drag.phase === "returning") && (
                <div
                  ref={drag.ghostRef}
                  className="absolute z-50 flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/15 px-3 py-2 backdrop-blur-xl pointer-events-none select-none"
                  style={{
                    left: drag.ghostPos?.x ?? CONTAINER / 2,
                    top: drag.ghostPos?.y ?? CONTAINER / 2,
                    transform: "translate(-50%, -50%) scale(1.1)",
                    filter: "drop-shadow(0 4px 16px rgba(99, 102, 241, 0.4))",
                  }}
                >
                  <TokenIcon icon={draggedTokenInfo.icon} size={20} className="text-lg" />
                  <div className="text-left">
                    <div className="text-xs font-semibold leading-tight">{draggedTokenInfo.symbol}</div>
                    <div className="text-[10px] tabular-nums text-white/40">{draggedFormatted}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Status text below the orb area */}
            <div className="text-center text-sm">
              {step === "idle" && (
                <span className="text-white/40">Drag a token to the orb to speak</span>
              )}
              {step === "recording" && (
                <div>
                  <span className={remaining <= 5 ? "text-accent" : "text-white/60"}>
                    Recording — {seconds}s {remaining <= 5 ? `(${remaining}s left)` : ""}
                  </span>
                  <div className="mt-1">
                    <button onClick={() => { recorder.stopRecording(); resetFlow(); }} className="glass-nav text-xs">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {step === "processing" && (
                <div className="flex flex-col items-center gap-2">
                  {/* Step indicator dots */}
                  <div className="flex items-center gap-2 mb-1">
                    <StepDot active={processingSubStep === "uploading"} done={processingSubStep !== "uploading"} />
                    <div className="w-4 h-px bg-white/10" />
                    <StepDot active={processingSubStep === "transcribing"} done={processingSubStep === "parsing"} />
                    <div className="w-4 h-px bg-white/10" />
                    <StepDot active={processingSubStep === "parsing"} done={false} />
                  </div>

                  {/* Status label */}
                  <span className="text-white/50 text-sm" style={{ animation: "text-pulse 2s ease-in-out infinite" }}>
                    {processingSubStep === "uploading" && "Sending audio…"}
                    {processingSubStep === "transcribing" && "Listening…"}
                    {processingSubStep === "parsing" && "Got it. Understanding your request…"}
                  </span>

                  {/* Early transcript reveal */}
                  {processingSubStep === "parsing" && session?.transcript && (
                    <p
                      className="mt-2 max-w-xs rounded-lg bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed text-white/50 italic text-center"
                      style={{ animation: "fade-in-up 0.4s ease-out both" }}
                    >
                      &ldquo;{session.transcript}&rdquo;
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* === CONFIRM: Intent card === */}
        {step === "confirm" && parsedIntent && !parsedIntent.error && (
          <div className="glass-card w-full max-w-sm mx-auto space-y-4 p-6 text-sm" style={{ animation: "fade-in-up 0.4s ease-out both" }}>
            {/* Transcript quote */}
            {session?.transcript && (
              <p className="rounded-lg bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed text-white/50 italic">
                "{session.transcript}"
              </p>
            )}

            {/* Amount + recipient */}
            <div className="flex items-center gap-4 py-1">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-2xl">
                <TokenIcon icon={selectedTokenInfo?.icon ?? allTokens.find((t) => t.symbol === parsedIntent.token)?.icon ?? "💰"} size={28} />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold tracking-tight">
                  {(parsedIntent.amount ?? parsedIntent.amountUsdc)?.toLocaleString()}{" "}
                  <span className="text-white/70">{selectedToken ?? parsedIntent.token ?? "Unknown"}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-white/45">
                  to <span className="font-medium text-white/80">{parsedIntent.recipient?.name}</span>
                  <span className="mx-1.5 text-white/20">·</span>
                  <span className="text-white/40">
                    {parsedIntent.kind === "recurring" ? "Recurring" : parsedIntent.kind === "conditional" ? "Conditional" : "One-time"}
                  </span>
                </div>
                {trustedRecipient?.contactEmail && !forceAskEmail && (
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                    <span className="truncate text-green-400/70">{trustedRecipient.contactEmail}</span>
                    <button
                      type="button"
                      onClick={() => { setForceAskEmail(true); setStep("ask-email"); }}
                      className="shrink-0 text-[11px] text-white/30 underline underline-offset-2 hover:text-white/50"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Schedule details */}
            {parsedIntent.schedule && (
              <div className="rounded-lg bg-white/[0.03] px-4 py-2.5 text-[13px] text-white/45">
                {formatSchedule(parsedIntent.schedule)}
              </div>
            )}

            {/* Replay + actions */}
            <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
              {session?.readbackUrl && (
                <button
                  onClick={() => {
                    const url = session?.readbackUrl;
                    if (!url) return;
                    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
                    const audio = new Audio(url);
                    audio.crossOrigin = "anonymous";
                    audioRef.current = audio;
                    setTtsAudioEl(audio);
                    audio.addEventListener("ended", () => setTtsAudioEl(null));
                    audio.play().catch(() => {});
                  }}
                  className="glass-nav mr-auto flex items-center gap-1.5 text-xs text-white/50 hover:text-white/70"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg>
                  Replay
                </button>
              )}
              <div className={`flex gap-3 ${session?.readbackUrl ? "" : "ml-auto"}`}>
                <button onClick={handleApprove} className="btn-primary px-6">Approve</button>
                <button onClick={resetFlow} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* === ASK EMAIL === */}
        {step === "ask-email" && (
          <form onSubmit={handleEmailSubmit} className="glass-card w-full space-y-3 p-5">
            <div className="text-sm font-medium">What's {parsedIntent?.recipient?.name}'s email?</div>
            <p className="text-xs text-white/40">We'll send them a claim link so they can receive the funds.</p>
            <input
              type="email"
              required
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="mama@gmail.com"
              className="glass-input"
            />
            <div className="flex gap-3">
              <button type="submit" className="btn-primary">Continue</button>
              <button type="button" onClick={resetFlow} className="btn-secondary">Cancel</button>
            </div>
          </form>
        )}

        {/* === VOICE MESSAGE PROMPT === */}
        {step === "ask-voice-msg" && (
          <div className="glass-card w-full space-y-3 p-5 text-center">
            <div className="text-sm font-medium">Want to leave a message for {createdRecipientName}?</div>
            <p className="text-xs text-white/40">Record up to 30 seconds. They'll hear your voice when they claim the funds.</p>
            <div className="flex justify-center gap-3">
              <button onClick={handleRecordMessage} className="btn-accent">Record message</button>
              <button onClick={() => handleFinalize()} className="btn-secondary">Skip</button>
            </div>
          </div>
        )}

        {/* === RECORDING VOICE MESSAGE === */}
        {step === "recording-msg" && (
          <div className="glass-card w-full space-y-3 p-5 text-center">
            <div className="text-sm font-medium">Recording for {createdRecipientName}…</div>
            <div className="text-3xl animate-pulse">🎙</div>
            <div className="text-sm text-white/60">{msgSeconds}s / 30s</div>
            <button onClick={handleStopMessage} className="btn-accent">Stop & save</button>
          </div>
        )}

        {/* === FUNDING === */}
        {step === "funding" && (
          <div className="glass-card w-full max-w-sm mx-auto space-y-4 p-6 text-center" style={{ animation: "fade-in-up 0.4s ease-out both" }}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-6 w-6 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div className="font-medium text-white/90">Funding payment...</div>
            <p className="text-[13px] leading-relaxed text-white/45">
              Transferring {parsedIntent?.amount ?? parsedIntent?.amountUsdc} {selectedToken} from your wallet to the payment agent.
            </p>
          </div>
        )}

        {/* === ERROR === */}
        {step === "error" && (
          <div className="glass-card w-full max-w-sm mx-auto space-y-4 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div className="font-medium text-white/90">Couldn't process that</div>
            <p className="text-[13px] leading-relaxed text-white/45">
              {errorMessage}
            </p>
            <button onClick={resetFlow} className="btn-primary">Try again</button>
          </div>
        )}

        {/* === DONE === */}
        {step === "done" && (
          <div className="glass-card w-full space-y-4 p-5 text-center">
            <div className="text-3xl">✓</div>
            <div className="font-medium">Payment created!</div>
            <p className="text-xs text-white/40">
              {createdRecipientName} will receive a claim link at their email.
            </p>
            <div className="flex justify-center gap-3">
              <button onClick={resetFlow} className="btn-primary">New payment</button>
              <Link to="/app/rules" className="btn-secondary">Rules</Link>
              <Link to="/app/activity" className="btn-secondary">Activity</Link>
            </div>
          </div>
        )}

      </main>

      {step === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-xs text-white/30">created by team murphy</span>
        </div>
      )}

      {/* Add Token Modal */}
      <AddTokenModal
        open={showAddToken}
        onClose={() => setShowAddToken(false)}
        existingAddresses={customTokens.map((t) => t.address)}
        onAdd={async (meta) => {
          if (!user) return;
          await addCustomToken({
            privyId: user.id,
            symbol: meta.symbol,
            name: meta.name,
            address: meta.address,
            decimals: meta.decimals,
            icon: meta.icon,
          });
          // Auto-show in orbit if there's room
          showToken({
            symbol: meta.symbol,
            name: meta.name,
            address: meta.address as `0x${string}`,
            decimals: meta.decimals,
            icon: meta.icon ?? "🔷",
            isCustom: true,
          });
        }}
      />

      {/* Customize Tokens Modal */}
      <CustomizeTokensModal
        open={showCustomize}
        onClose={() => setShowCustomize(false)}
        visibleTokens={visibleTokens}
        hiddenTokens={hiddenTokens}
        maxVisible={MAX_VISIBLE}
        onHide={hideToken}
        onShow={showToken}
        onDeleteToken={(token) => {
          if (token.isCustom && token.customTokenId) {
            removeToken(token);
            void removeCustomToken({ tokenId: token.customTokenId as any });
          }
        }}
      />

      <footer className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          <button
            onClick={() => {
              if (wallet?.address) {
                navigator.clipboard.writeText(wallet.address);
                setCopiedField("wallet");
                setTimeout(() => setCopiedField(null), 1500);
              }
            }}
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 font-mono transition hover:bg-white/10 active:scale-95"
            title="Copy wallet address"
          >
            <span className="truncate max-w-[120px]">{wallet?.address ?? "provisioning…"}</span>
            {copiedField === "wallet" ? (
              <svg className="h-3 w-3 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="h-3 w-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            )}
          </button>
          <button
            onClick={() => {
              if (user?.email?.address) {
                navigator.clipboard.writeText(user.email.address);
                setCopiedField("email");
                setTimeout(() => setCopiedField(null), 1500);
              }
            }}
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 transition hover:bg-white/10 active:scale-95 ml-auto"
            title="Copy email"
          >
            <span className="truncate max-w-[140px]">{user?.email?.address ?? "—"}</span>
            {copiedField === "email" ? (
              <svg className="h-3 w-3 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="h-3 w-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            )}
          </button>
        </div>
        <nav className="flex gap-5">
          <Link to="/app/rules" className="glass-nav inline-flex items-center gap-1.5">
            Rules
            {unseenRules > 0 && (
              <span className="glass-unseen-badge">
                {unseenRules > 99 ? "99+" : unseenRules}
              </span>
            )}
          </Link>
          <Link to="/app/activity" className="glass-nav inline-flex items-center gap-1.5">
            Activity
            {unseenActivity > 0 && (
              <span className="glass-unseen-badge">
                {unseenActivity > 99 ? "99+" : unseenActivity}
              </span>
            )}
          </Link>
          <Link to="/app/recipients" className="glass-nav inline-flex items-center gap-1.5">
            Recipients
          </Link>
        </nav>
      </footer>

    </div>
  );
}
