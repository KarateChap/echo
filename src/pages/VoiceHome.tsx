import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
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
import { useAutoStopDetection } from "@/lib/useAutoStopDetection";
import { usePortfolioValue } from "@/lib/usePortfolioValue";
import PortfolioValueDisplay from "@/components/PortfolioValueDisplay";
import FxRateTicker from "@/components/FxRateTicker";
import { useCurrency, formatFiatValue } from "@/lib/currencyConfig";
import { useConversationListener } from "@/lib/useConversationListener";
import { useVoiceEmail } from "@/lib/useVoiceEmail";
import { useConversationAgent } from "@/lib/useConversationAgent";
import { useStreamingAudio } from "@/lib/useStreamingAudio";
import { isMobile, isIOS } from "@/lib/isMobile";
import { useIOSAudioSession } from "@/lib/useIOSAudioSession";
import WithdrawModal from "@/components/WithdrawModal";
import type { Id } from "../../convex/_generated/dataModel";

type FlowStep = "idle" | "recording" | "processing" | "confirm" | "ask-email" | "ask-voice-msg" | "recording-msg" | "funding" | "done" | "error" | "chat-listening" | "chat-processing" | "chat-speaking";
type ProcessingSubStep = "uploading" | "transcribing" | "parsing";

const SPEECH_THRESHOLD = 0.25;
const MAX_NOISE_DISCARDS = 3;

/** Returns true if the transcript looks like garbage from background noise. */
function isGarbageTranscript(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (trimmed.length < 3) return true;
  // High ratio of non-Latin characters (Japanese, Chinese, Korean picked up from TV/videos)
  const nonLatin = trimmed.replace(/[\x00-\x7F\u00C0-\u024F]/g, "");
  if (nonLatin.length / trimmed.length > 0.5) return true;
  return false;
}

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
  const navigate = useNavigate();
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
  const portfolioValue = usePortfolioValue(balances);
  const { currency } = useCurrency();
  const { unseenActivity, unseenRules } = useUnseenCounts();
  const addCustomToken = useMutation(api.customTokens.add);
  const removeCustomToken = useMutation(api.customTokens.remove);
  const [showAddToken, setShowAddToken] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // User record (for voice gender preference)
  const dbUser = useQuery(api.users.getByPrivyId, user ? { privyId: user.id } : "skip");
  const updateVoiceGender = useMutation(api.users.updateVoiceGender);
  const voiceGender = dbUser?.voiceGender ?? "female";

  const generateUploadUrl = useMutation(api.voiceSessions.generateUploadUrl);
  const createSession = useMutation(api.voiceSessions.create);
  const createRule = useMutation(api.rules.createFromIntent);
  const generateMsgUploadUrl = useMutation(api.voiceMessages.generateUploadUrl);
  const createVoiceMessage = useMutation(api.voiceMessages.create);

  // iOS audio session: persistent mic, speaker routing, autoplay unlock
  const iosSession = useIOSAudioSession();

  const recorder = useVoiceRecorder({ persistentStream: iosSession.persistentStream });
  const msgRecorder = useVoiceRecorder({ persistentStream: iosSession.persistentStream });
  const msgStartRef = useRef<number>(0);

  const [ttsAudioEl, setTtsAudioEl] = useState<HTMLAudioElement | null>(null);
  const [ttsHasPlayed, setTtsHasPlayed] = useState(false);
  const micLevelRef = useAudioAnalyser(recorder.stream);
  const ttsLevelRef = useAudioAnalyser(ttsAudioEl);

  // Passive mic stream for voice-interactive steps (confirm, ask-email, etc.)
  // so the orb visualizer can respond to the user's voice even when not recording.
  const [passiveMicStream, setPassiveMicStream] = useState<MediaStream | null>(null);
  const passiveMicLevelRef = useAudioAnalyser(passiveMicStream);

  // Combined audio level ref — read by AudioVisualizer & ParticleWaveBackground in their RAF loops
  const { audioLevelRef } = useAudioLevelContext();
  // Sync mic+tts+passive levels into the shared ref via a lightweight RAF (no React state updates)
  useEffect(() => {
    let raf = 0;
    function sync() {
      audioLevelRef.current = Math.max(micLevelRef.current, ttsLevelRef.current, passiveMicLevelRef.current);
      raf = requestAnimationFrame(sync);
    }
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [audioLevelRef, micLevelRef, ttsLevelRef, passiveMicLevelRef]);

  const [step, setStep] = useState<FlowStep>("idle");

  // Open/close a passive mic stream during voice-interactive steps
  // so the orb visualizer responds to the user's voice.
  // On iOS: reuse the persistent stream from iosSession (no new getUserMedia call, no extra permission prompt).
  // On other mobile: skip passive mic — not worth the overhead.
  const needsPassiveMic = ["confirm", "ask-email", "ask-voice-msg", "done", "error", "chat-speaking"].includes(step);
  useEffect(() => {
    if (!needsPassiveMic) {
      setPassiveMicStream((prev) => {
        // Don't stop tracks on the iOS persistent stream — only stop desktop-acquired streams
        if (prev && !isIOS) prev.getTracks().forEach((t) => t.stop());
        return null;
      });
      return;
    }

    // iOS: reuse persistent stream (no new getUserMedia, no permission prompt)
    if (isIOS && iosSession.persistentStream) {
      setPassiveMicStream(iosSession.persistentStream);
      return;
    }

    // Non-iOS mobile: skip passive mic entirely
    if (isMobile) return;

    // Desktop: acquire fresh stream
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        setPassiveMicStream(stream);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setPassiveMicStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [needsPassiveMic, iosSession.persistentStream]);

  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<Id<"voiceSessions"> | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [_createdRuleId, setCreatedRuleId] = useState<Id<"rules"> | null>(null);
  const [createdRecipientName, setCreatedRecipientName] = useState("");
  const [msgElapsed, setMsgElapsed] = useState(0);
  const [copiedField, setCopiedField] = useState<"wallet" | "email" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [processingSubStep, setProcessingSubStep] = useState<ProcessingSubStep>("uploading");

  // Auto-stop: ref for the stop handler (defined later) so the hook can call it
  const handleStopRef = useRef<() => void>(() => {});

  const autoStop = useAutoStopDetection({
    enabled: step === "recording",
    audioLevelRef: micLevelRef,
    elapsedMs: recorder.elapsedMs,
    selectedToken,
    onAutoStop: () => handleStopRef.current(),
    convexUrl: import.meta.env.VITE_CONVEX_URL ?? "",
  });

  // Chat mode auto-stop: silence-only (no LLM completeness check)
  const chatAutoStopRef = useRef<() => void>(() => {});
  const chatAutoStop = useAutoStopDetection({
    enabled: step === "chat-listening",
    audioLevelRef: micLevelRef,
    elapsedMs: recorder.elapsedMs,
    selectedToken: null,
    onAutoStop: () => chatAutoStopRef.current(),
    convexUrl: import.meta.env.VITE_CONVEX_URL ?? "",
    skipCompletenessCheck: true,
  });

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
  const [showEmailTyping, setShowEmailTyping] = useState(false);

  // Derive Convex HTTP site URL for streaming TTS and email parsing
  const convexSiteUrl = (import.meta.env.VITE_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site");

  const createFromChatIntent = useMutation(api.voiceSessions.createFromChatIntent);

  // Build balance summary string for the chat agent
  const balanceSummary = useMemo(() => {
    if (balanceLoading || balances.length === 0) return undefined;
    const parts: string[] = balances
      .map((b) => {
        const val = parseFloat(b.formatted);
        if (val === 0) return "";
        const isEth = b.token.symbol === "ETH";
        return `${val.toLocaleString(undefined, { minimumFractionDigits: isEth ? 4 : 2, maximumFractionDigits: isEth ? 4 : 2 })} ${b.token.symbol}`;
      })
      .filter((s) => s.length > 0);
    const curr = portfolioValue.currencies[0] ?? "USD";
    const totalVal = portfolioValue.total[curr];
    if (totalVal) {
      parts.push(`(Total: ~${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr})`);
    }
    return parts.join(", ") || undefined;
  }, [balances, balanceLoading, portfolioValue]);

  // Ref to access chatAgent.reset() from within its own callbacks
  const chatAgentResetRef = useRef<() => void>(() => {});

  // Conversation agent hook for chat mode
  const chatAgent = useConversationAgent({
    convexSiteUrl,
    privyId: user?.id ?? "",
    voiceGender,
    onPaymentIntent: useCallback(async (intent: any, token?: string, aiReadbackText?: string) => {
      if (!user) return;
      // Safety net: block recurring intents without totalOccurrences
      if (intent.kind === "recurring" && (!intent.totalOccurrences || intent.totalOccurrences <= 0)) {
        setErrorMessage("Please specify how many times or for how long (e.g. 'for 6 months' or '3 times').");
        setStep("error");
        return;
      }
      try {
        const name = intent.recipient?.name ?? "recipient";
        const amount = (intent.amount ?? intent.amountUsdc)?.toLocaleString() ?? "?";
        const tok = token ?? intent.token ?? "USDC";
        // Use AI-generated readback (in user's language) if available, else fallback to Taglish
        const readbackText = aiReadbackText || `Sige. Magpapadala ng ${amount} ${tok} kay ${name}. I-confirm mo lang para mag-proceed.`;
        const sid = await createFromChatIntent({
          privyId: user.id,
          intent: JSON.stringify(intent),
          readbackText,
          selectedToken: token,
        });
        // Stop any chat audio, reset chat state
        chatAgentResetRef.current();
        // Reset TTS refs so confirm view can play its own readback
        hasPlayedRef.current = null;
        hasPlayedFallbackRef.current = null;
        elevenLabsPlayedRef.current = false;
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
        setTtsAudioEl(null);
        setTtsHasPlayed(false);
        setSessionId(sid);
        setSelectedToken(tok);
        setStep("confirm");
      } catch {
        setErrorMessage("Failed to process payment command.");
        setStep("error");
      }
    }, [user, createFromChatIntent]),
    onWithdraw: useCallback(() => {
      chatAgentResetRef.current();
      resetFlow();
      // Delay opening the modal to let VoiceHome's SpeechRecognition cleanup
      // effects run first — Chrome only supports one instance at a time
      setTimeout(() => setShowWithdraw(true), 300);
    }, []),
    onExit: useCallback(() => {
      resetFlow();
    }, []),
    onTtsStart: useCallback((audioEl: HTMLAudioElement) => {
      setTtsAudioEl(audioEl);
    }, []),
    onTtsEnd: useCallback(() => {
      setTtsAudioEl(null);
    }, []),
    forceSpeakerRoute: iosSession.forceSpeakerRoute,
  });

  // Keep chatAgent reset ref in sync
  chatAgentResetRef.current = chatAgent.reset;

  // Auto-resume listening after chat TTS finishes
  const recorderStartRef = useRef(recorder.startRecording);
  recorderStartRef.current = recorder.startRecording;
  useEffect(() => {
    if (step === "chat-speaking" && !chatAgent.isPlayingTts && !chatAgent.isProcessing) {
      // TTS just finished — add cooldown before resuming to avoid picking up echo/reverb
      const timer = setTimeout(() => {
        if (stepRef.current === "chat-speaking") {
          setStep("chat-listening");
          recorderStartRef.current();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [step, chatAgent.isPlayingTts, chatAgent.isProcessing]);

  // Voice email capture — active during ask-email step
  const voiceEmail = useVoiceEmail({
    enabled: step === "ask-email" && !showEmailTyping,
    convexSiteUrl,
  });

  // When voice email is parsed, auto-fill the email field for confirmation
  useEffect(() => {
    if (voiceEmail.parsedEmail && step === "ask-email") {
      setRecipientEmail(voiceEmail.parsedEmail);
    }
  }, [voiceEmail.parsedEmail, step]);

  // Auto-play readback via streaming ElevenLabs TTS (fast path)
  // Falls back to stored readbackUrl for Replay button
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef<string | null>(null);

  // Track whether ElevenLabs TTS succeeded so we know whether to fall back to stored audio
  const elevenLabsPlayedRef = useRef(false);
  const hasPlayedFallbackRef = useRef<string | null>(null);

  // Streaming audio helper for readback TTS
  const { playStream: playReadbackStream, stop: stopReadbackStream } = useStreamingAudio({
    onStart: (audio) => {
      audioRef.current = audio;
      setTtsAudioEl(audio);
    },
    onEnd: () => {
      setTtsAudioEl(null);
      setTtsHasPlayed(true);
      audioRef.current = null;
    },
    forceSpeakerRoute: iosSession.forceSpeakerRoute,
  });

  // Primary: fetch streaming ElevenLabs TTS as soon as readbackText is available
  useEffect(() => {
    const text = session?.readbackText;
    if (!text || text === hasPlayedRef.current || !convexSiteUrl) return;
    hasPlayedRef.current = text;
    elevenLabsPlayedRef.current = true;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; setTtsAudioEl(null); }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${convexSiteUrl}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: voiceGender }),
        });
        if (!res.ok || cancelled) return;
        await playReadbackStream(res);
      } catch {
        elevenLabsPlayedRef.current = false;
        setTtsHasPlayed(true);
      }
    })();

    return () => { cancelled = true; stopReadbackStream(); };
  }, [session?.readbackText, convexSiteUrl, voiceGender, playReadbackStream, stopReadbackStream]);

  // Fallback: if ElevenLabs TTS didn't play and stored readbackUrl becomes available, use it
  useEffect(() => {
    const url = session?.readbackUrl;
    if (!url || elevenLabsPlayedRef.current) return;
    if (url === hasPlayedFallbackRef.current) return;
    // Only play if we haven't already played via ElevenLabs
    if (audioRef.current && audioRef.current.currentTime > 0) return;
    hasPlayedFallbackRef.current = url;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; setTtsAudioEl(null); }
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.setAttribute("playsinline", "");
    audioRef.current = audio;
    setTtsAudioEl(audio);
    audio.addEventListener("ended", () => { setTtsAudioEl(null); setTtsHasPlayed(true); });
    audio.addEventListener("pause", () => { setTtsAudioEl(null); setTtsHasPlayed(true); });
    // Force speaker routing on iOS before playing
    (async () => {
      await iosSession.forceSpeakerRoute();
      audio.play().catch(() => { setTtsHasPlayed(true); });
    })();
  }, [session?.readbackUrl, iosSession.forceSpeakerRoute]);

  // Safety: unlock Approve button after 5s if TTS silently failed
  useEffect(() => {
    if (step !== "confirm" || ttsHasPlayed) return;
    const timer = setTimeout(() => setTtsHasPlayed(true), 5000);
    return () => clearTimeout(timer);
  }, [step, ttsHasPlayed]);

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
        // Safety net: block recurring intents without totalOccurrences
        if (intent.kind === "recurring" && (!intent.totalOccurrences || intent.totalOccurrences <= 0)) {
          setErrorMessage("Please specify how many times or for how long (e.g. 'for 6 months' or '3 times').");
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
    setShowEmailTyping(false);
    voiceEmail.retry();
    setProcessingSubStep("uploading");
    hasPlayedRef.current = null;
    hasPlayedFallbackRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setTtsAudioEl(null);
    setTtsHasPlayed(false);
    setStep("recording");
    await recorder.startRecording();
  }, [user, recorder]);

  // Handle orb tap — enter chat mode (no token selected)
  const noiseDiscardCountRef = useRef(0);
  const handleOrbTap = useCallback(async () => {
    if (!user || step !== "idle") return;
    noiseDiscardCountRef.current = 0;
    setStep("chat-listening");
    await recorder.startRecording();
  }, [user, step, recorder]);

  // Chat auto-stop handler
  const stepRef = useRef(step);
  stepRef.current = step;
  chatAutoStopRef.current = async () => {
    if (stepRef.current !== "chat-listening") return;
    const peakLevel = chatAutoStop.peakAudioLevel;
    const blob = await recorder.stopRecording();
    // Force speaker routing on iOS before TTS plays (replaces blind 400ms delay)
    if (isIOS) await iosSession.forceSpeakerRoute();
    else if (isMobile) await new Promise(r => setTimeout(r, 400));
    let transcript = chatAutoStop.interimTranscript;

    // Speech energy gate — if audio never reached speech level, discard
    // On mobile, peakLevel is always 0 (AudioContext disabled for mic to avoid
    // earpiece routing), so use blob size as a proxy for speech energy.
    const hasSpeechEnergy = isMobile
      ? blob != null && blob.size > 4000
      : peakLevel >= SPEECH_THRESHOLD;
    if (!hasSpeechEnergy) {
      noiseDiscardCountRef.current++;
      if (noiseDiscardCountRef.current >= MAX_NOISE_DISCARDS) {
        resetFlow();
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
      if (stepRef.current === "chat-listening") {
        await recorder.startRecording();
      }
      return;
    }

    // If Web Speech API failed to produce a transcript but we have audio,
    // fall back to Whisper transcription via the backend.
    // On mobile, peakLevel is always 0, so gate on blob size only (lower
    // threshold because mobile codecs like AAC produce smaller files).
    const whisperEligible = isMobile
      ? blob != null && blob.size > 4000
      : peakLevel >= SPEECH_THRESHOLD && blob != null && blob.size > 8000;
    if ((!transcript || transcript.trim().length < 2) && whisperEligible && blob) {
      try {
        setStep("chat-processing");
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        });
        const { storageId } = (await result.json()) as { storageId: string };
        // Use the Whisper transcription endpoint
        const whisperRes = await fetch(`${convexSiteUrl}/api/transcribeForChat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageId }),
        });
        if (whisperRes.ok) {
          const data = (await whisperRes.json()) as { transcript: string };
          if (data.transcript && data.transcript.trim().length >= 2) {
            transcript = data.transcript;
          }
        }
      } catch {
        // Fallback transcription failed — restart listening
      }
    }

    if (!transcript || transcript.trim().length < 2 || isGarbageTranscript(transcript)) {
      // Nothing meaningful captured — wait briefly then resume listening
      noiseDiscardCountRef.current++;
      if (noiseDiscardCountRef.current >= MAX_NOISE_DISCARDS) {
        resetFlow();
        return;
      }
      if ((stepRef.current as FlowStep) === "chat-processing") setStep("chat-listening");
      await new Promise((r) => setTimeout(r, 500));
      if ((stepRef.current as FlowStep) === "chat-listening") {
        await recorder.startRecording();
      }
      return;
    }
    noiseDiscardCountRef.current = 0;
    if ((stepRef.current as FlowStep) !== "chat-processing") setStep("chat-processing");
    await chatAgent.sendMessage(transcript, balanceSummary);
    // After sendMessage, TTS plays automatically via the hook
    setStep("chat-speaking");
  };

  // Keep auto-stop ref in sync
  handleStopRef.current = () => handleStopRecording();

  async function handleStopRecording() {
    if (!user) return;
    const blob = await recorder.stopRecording();
    if (!blob) return;
    // Force speaker routing on iOS before TTS plays (replaces blind 400ms delay)
    if (isIOS) await iosSession.forceSpeakerRoute();
    else if (isMobile) await new Promise(r => setTimeout(r, 400));
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
      // Pass the interim transcript from auto-stop detection for speculative parsing
      const preTranscript = autoStop.interimTranscript || undefined;
      const id = await createSession({ privyId: user.id, audioStorageId: storageId, selectedToken, preTranscript });
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

      // Stop any playing TTS so the conversation listener isn't suppressed on the next step
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      setTtsAudioEl(null);

      setCreatedRecipientName(intent.recipient?.name ?? "Unknown");

      // If we have a trusted recipient with email on file, skip the email step
      if (trustedRecipient?.contactEmail && !forceAskEmail) {
        setRecipientEmail(trustedRecipient.contactEmail);
        setStep("ask-voice-msg");
      } else {
        setShowEmailTyping(true);
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
    if (!session?.intent || !user) return;
    if (!recipientEmail) {
      setErrorMessage("Recipient email is missing. Please try again.");
      setStep("error");
      return;
    }
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
      const perPaymentAmount = intent.amount ?? intent.amountUsdc ?? 0;
      if (perPaymentAmount <= 0) {
        setErrorMessage("Invalid amount.");
        setStep("error");
        return;
      }
      const totalOccurrences = intent.totalOccurrences ?? 1;
      const fundingAmount = perPaymentAmount * totalOccurrences;

      setStep("funding");
      const fundingTxHash = await fundAgentWallet({ wallet, token: tokenInfo, amount: fundingAmount });

      // Compute expiration for time-bounded rules
      const expiresAt = intent.durationMinutes
        ? Date.now() + intent.durationMinutes * 60 * 1000
        : undefined;

      // Create the rule (triggers executePayment + sendClaimEmail)
      const result = await createRule({
        privyId: user.id,
        recipientName: intent.recipient?.name ?? "Unknown",
        recipientEmail,
        recipientHint: intent.recipient?.hint,
        kind: intent.kind,
        amountUsdc: perPaymentAmount,
        token: resolvedToken,
        schedule: intent.schedule ?? undefined,
        condition: intent.condition ?? undefined,
        fundingTxHash,
        expiresAt,
        totalOccurrences: (intent.kind === "conditional" || totalOccurrences > 1) ? totalOccurrences : undefined,
        totalFunded: (intent.kind === "conditional" || totalOccurrences > 1) ? fundingAmount : undefined,
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
      const raw = e instanceof Error ? e.message : String(e);
      // Detect user-rejected wallet prompts (Privy / viem)
      if (/user rejected|user denied|rejected the request/i.test(raw)) {
        setErrorMessage("Transaction was cancelled. No funds were sent.");
      } else {
        setErrorMessage("Something went wrong. Please try again.");
      }
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
    setShowEmailTyping(false);
    voiceEmail.retry();
    setProcessingSubStep("uploading");
    hasPlayedRef.current = null;
    hasPlayedFallbackRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setTtsAudioEl(null);
    setTtsHasPlayed(false);
    chatAgent.reset();
    noiseDiscardCountRef.current = 0;
    if (recorder.status === "recording") recorder.stopRecording();
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

  // Unified conversational voice listener — single SpeechRecognition instance
  // stays alive across all post-recording steps, no restart delays between steps
  useConversationListener({
    enabled: (
      ["confirm", "ask-voice-msg", "done", "error"].includes(step)
      || (step === "ask-email" && !!voiceEmail.parsedEmail && !showEmailTyping)
    ) && (step !== "confirm" || (!!parsedIntent && !parsedIntent.error)),
    currentStep: step === "ask-email" ? "ask-email-confirm" : step,
    ttsPlaying: !!ttsAudioEl,
    commandMap: {
      confirm: [
        { keywords: ["approve", "confirm", "proceed", "sige", "go ahead", "let's go", "lets go", "push through", "send it", "okay", "yes"], action: () => handleApprove() },
        { keywords: ["cancel", "nevermind", "never mind", "huwag", "wag na", "ayaw"], action: () => resetFlow() },
      ],
      "ask-email-confirm": [
        { keywords: ["yes", "correct", "confirm", "sige", "oo", "tama"], action: () => { setRecipientEmail(voiceEmail.parsedEmail!); setStep("ask-voice-msg"); } },
        { keywords: ["try again", "retry", "no", "hindi", "ulit"], action: () => { voiceEmail.retry(); setRecipientEmail(""); } },
      ],
      "ask-voice-msg": [
        { keywords: ["skip", "pass", "wag na", "huwag", "no thanks", "no", "hindi"], action: () => handleFinalize() },
        { keywords: ["record", "record message", "yes record"], action: () => handleRecordMessage() },
      ],
      error: [
        { keywords: ["try again", "retry", "ulit"], action: () => resetFlow() },
      ],
      done: [
        { keywords: ["new payment", "again", "try again", "ulit"], action: () => resetFlow() },
        { keywords: ["rules", "my rules"], action: () => navigate("/app/rules") },
        { keywords: ["activity", "transactions"], action: () => navigate("/app/activity") },
        { keywords: ["dismiss", "close", "go back", "uwi"], action: () => resetFlow() },
      ],
    },
  });

  const isOrbActive = step === "recording" || step === "processing" || step === "chat-listening" || step === "chat-processing";
  // Steps where voice commands are listening — show a compact orb as visual indicator
  const isVoiceListening = ["confirm", "ask-email", "ask-voice-msg", "done", "error"].includes(step);
  const isChatMode = step === "chat-listening" || step === "chat-processing" || step === "chat-speaking";
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
    <div className="mx-auto flex min-h-full max-w-md flex-col px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Echo</h1>
        <div className="flex items-center gap-2">
          {/* Voice gender segmented toggle */}
          <div
            className="relative flex items-center rounded-full p-0.5"
            style={{
              background: "rgba(140, 160, 255, 0.08)",
              border: "1px solid rgba(140, 160, 255, 0.12)",
            }}
          >
            {(["female", "male"] as const).map((g) => (
              <button
                key={g}
                onClick={() => {
                  if (user && voiceGender !== g) updateVoiceGender({ privyId: user.id, voiceGender: g });
                }}
                className="relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200"
                style={{
                  color: voiceGender === g ? "rgba(255,255,255,0.95)" : "rgba(180, 200, 255, 0.45)",
                  background: voiceGender === g ? "rgba(99, 102, 241, 0.35)" : "transparent",
                  boxShadow: voiceGender === g ? "0 0 8px rgba(99, 102, 241, 0.25)" : "none",
                }}
              >
                <span className="inline-flex items-center" style={{ fontSize: "13px", lineHeight: 1 }}>{g === "female" ? "♀" : "♂"}</span>
                {g === "female" ? "Female" : "Male"}
              </button>
            ))}
          </div>
          <button onClick={logout} className="glass-nav text-xs">Sign out</button>
        </div>
      </header>

      <FxRateTicker prices={portfolioValue.prices} loading={portfolioValue.loading} />

      <main className="flex flex-1 flex-col items-center justify-center gap-4 pt-6">

        {/* === ORB + TOKENS: shown during idle, recording, processing, and chat === */}
        {(step === "idle" || step === "recording" || step === "processing" || isChatMode) && (
          <>
            {step === "idle" && (
              <PortfolioValueDisplay
                total={portfolioValue.total}
                currencies={portfolioValue.currencies}
                loading={portfolioValue.loading || balanceLoading}
              />
            )}
            <div ref={containerRef} className="relative" style={{ width: CONTAINER, height: CONTAINER }}>
              {/* Center orb */}
              <div className="absolute inset-0 flex items-center justify-center">
                <AudioVisualizer
                  levelRef={audioLevelRef}
                  active={isOrbActive}
                  recording={step === "recording" || step === "chat-listening"}
                  size={160}
                  onClick={
                    step === "recording" ? handleStopRecording :
                    step === "idle" ? handleOrbTap :
                    step === "chat-listening" ? () => chatAutoStopRef.current() :
                    undefined
                  }
                  disabled={step === "processing" || step === "chat-processing"}
                  waiting={step === "idle"}
                />
              </div>

              {/* Drop target overlay — on top of canvas, below badges */}
              {!isChatMode && (
                <DropTargetOverlay
                  state={
                    step !== "idle" ? "hidden" :
                    drag.isOverDropZone ? "hovering" :
                    drag.isDragging ? "dragging" :
                    "idle"
                  }
                />
              )}

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
                      {(() => {
                        if (portfolioValue.loading || !portfolioValue.prices) return null;
                        const rate = portfolioValue.prices[token.symbol]?.[currency.toLowerCase()];
                        if (rate == null) return null;
                        const amount = parseFloat(formatted.replace(/,/g, ""));
                        if (isNaN(amount) || amount === 0) return null;
                        return <div className="text-[9px] tabular-nums text-white/25">{formatFiatValue(amount * rate, currency)}</div>;
                      })()}
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
                <div>
                  <span className="text-white/40">Drag a token to send, or tap the orb to chat</span>
                  {recorder.error && (
                    <p className="text-xs text-red-400/70 mt-1">{recorder.error}</p>
                  )}
                </div>
              )}
              {step === "recording" && (
                <div>
                  <span className={remaining <= 5 ? "text-accent" : "text-white/60"}>
                    {autoStop.isCheckingCompleteness
                      ? "Understanding..."
                      : `Recording — ${seconds}s ${remaining <= 5 ? `(${remaining}s left)` : ""}`}
                  </span>
                  {autoStop.interimTranscript && (
                    <p className="mt-1 text-xs text-white/30 italic max-w-xs mx-auto truncate">
                      "{autoStop.interimTranscript}"
                    </p>
                  )}
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

              {/* Chat mode status */}
              {step === "chat-listening" && (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-white/50 text-sm" style={{ animation: "text-pulse 2s ease-in-out infinite" }}>
                    Listening...
                  </span>
                  {chatAutoStop.interimTranscript && (
                    <p className="text-xs text-white/30 italic max-w-xs mx-auto truncate">
                      "{chatAutoStop.interimTranscript}"
                    </p>
                  )}
                </div>
              )}
              {step === "chat-processing" && (
                <div className="flex flex-col items-center">
                  <span className="text-white/50 text-sm" style={{ animation: "text-pulse 2s ease-in-out infinite" }}>
                    Thinking...
                  </span>
                </div>
              )}
              {step === "chat-speaking" && (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-white/40 text-xs">Speaking...</span>
                </div>
              )}
            </div>

            {/* Chat conversation area */}
            {isChatMode && (
              <div className="w-full max-w-sm mx-auto flex flex-col gap-3" style={{ animation: "fade-in-up 0.3s ease-out both" }}>
                {/* Message history */}
                {chatAgent.messages.length > 0 && (
                  <div
                    className="chat-hide-scrollbar flex flex-col gap-2 max-h-44 overflow-y-auto px-1 scroll-smooth"
                    ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                  >
                    {chatAgent.messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`text-[13px] leading-relaxed px-3.5 py-2 max-w-[85%] ${
                            msg.role === "user"
                              ? "rounded-2xl rounded-br-md bg-primary/15 text-white/70 border border-primary/20"
                              : "rounded-2xl rounded-bl-md bg-white/[0.06] text-white/60 border border-white/[0.08]"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* End chat button — always visible */}
                <div className="flex justify-center pt-1">
                  <button
                    onClick={resetFlow}
                    className="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all active:scale-95"
                    style={{
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      color: "rgba(252, 165, 165, 0.9)",
                    }}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    End chat
                  </button>
                  {step === "chat-speaking" && (
                    <button
                      onClick={() => { chatAgent.stopTts(); setStep("chat-listening"); recorder.startRecording(); }}
                      className="ml-2 flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all active:scale-95"
                      style={{
                        background: "rgba(140, 160, 255, 0.1)",
                        border: "1px solid rgba(140, 160, 255, 0.2)",
                        color: "rgba(180, 200, 255, 0.8)",
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                      </svg>
                      Interrupt
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* === Listening orb — shown during all voice-interactive steps === */}
        {isVoiceListening && (
          <div className="flex flex-col items-center mb-2" style={{ animation: "fade-in-up 0.3s ease-out both" }}>
            <AudioVisualizer
              levelRef={audioLevelRef}
              active
              recording={false}
              size={100}
              disabled={false}
              waiting={false}
            />
          </div>
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
                {parsedIntent.amountFiat && parsedIntent.fiatCurrency ? (
                  <>
                    <div className="text-xl font-bold tracking-tight">
                      {new Intl.NumberFormat(undefined, { style: "currency", currency: parsedIntent.fiatCurrency }).format(parsedIntent.amountFiat)}
                      <span className="mx-1.5 text-white/30">→</span>
                      <span className="text-primary/90">
                        {(parsedIntent.amount ?? 0) < 0.01
                          ? (parsedIntent.amount ?? 0).toFixed(6)
                          : (parsedIntent.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                        }
                      </span>{" "}
                      <span className="text-white/70">{selectedToken ?? parsedIntent.token ?? "Unknown"}</span>
                    </div>
                    {parsedIntent.conversionRate && (
                      <div className="mt-0.5 text-[11px] text-white/30">
                        @ {new Intl.NumberFormat(undefined, { style: "currency", currency: parsedIntent.fiatCurrency }).format(parsedIntent.conversionRate)}/{selectedToken ?? parsedIntent.token}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xl font-bold tracking-tight">
                    {(parsedIntent.amount ?? parsedIntent.amountUsdc)?.toLocaleString()}{" "}
                    <span className="text-white/70">{selectedToken ?? parsedIntent.token ?? "Unknown"}</span>
                  </div>
                )}
                <div className="mt-0.5 text-[13px] text-white/45">
                  to <span className="font-medium text-white/80">{parsedIntent.recipient?.name}</span>
                  <span className="mx-1.5 text-white/20">·</span>
                  <span className="text-white/40">
                    {parsedIntent.kind === "recurring" ? "Recurring" : parsedIntent.kind === "conditional" ? "Conditional" : "One-time"}
                  </span>
                </div>
                {parsedIntent.totalOccurrences && parsedIntent.totalOccurrences > 1 && (
                  <div className="mt-1 text-[12px] text-white/40">
                    {(parsedIntent.amount ?? parsedIntent.amountUsdc)?.toLocaleString()} × {parsedIntent.totalOccurrences} payments ={" "}
                    <span className="font-medium text-white/60">
                      {((parsedIntent.amount ?? parsedIntent.amountUsdc ?? 0) * parsedIntent.totalOccurrences).toLocaleString()}{" "}
                      {selectedToken ?? parsedIntent.token} total
                    </span>
                  </div>
                )}
                {trustedRecipient?.contactEmail && !forceAskEmail && (
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                    <span className="truncate text-green-400/70">{trustedRecipient.contactEmail}</span>
                    <button
                      type="button"
                      onClick={() => { setForceAskEmail(true); setShowEmailTyping(true); setStep("ask-email"); }}
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
                {formatSchedule(
                  parsedIntent.schedule,
                  parsedIntent.durationMinutes
                    ? Date.now() + parsedIntent.durationMinutes * 60000
                    : undefined,
                  parsedIntent.totalOccurrences ?? undefined,
                  parsedIntent.kind,
                )}
              </div>
            )}

            {/* Replay + actions */}
            <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
              {session?.readbackText && (
                <button
                  onClick={async () => {
                    const text = session?.readbackText;
                    if (!text || !convexSiteUrl) return;
                    stopReadbackStream();
                    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; setTtsAudioEl(null); }
                    try {
                      const res = await fetch(`${convexSiteUrl}/api/tts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text, voice: voiceGender }),
                      });
                      if (!res.ok) return;
                      await playReadbackStream(res);
                    } catch {}
                  }}
                  className="glass-nav mr-auto flex items-center gap-1.5 text-xs text-white/50 hover:text-white/70"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg>
                  Replay
                </button>
              )}
              <div className={`flex gap-3 ${session?.readbackText ? "" : "ml-auto"}`}>
                <button onClick={handleApprove} disabled={!ttsHasPlayed} className={`btn-primary px-6${!ttsHasPlayed ? " opacity-40 pointer-events-none" : ""}`}>Approve</button>
                <button onClick={resetFlow} disabled={!ttsHasPlayed} className={`btn-secondary${!ttsHasPlayed ? " opacity-40 pointer-events-none" : ""}`}>Cancel</button>
              </div>
            </div>

            {/* Voice hint */}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              Say "Approve", "Sige", or "Cancel"
            </div>
          </div>
        )}

        {/* === ASK EMAIL === */}
        {step === "ask-email" && (
          <div className="glass-card w-full space-y-4 p-5" style={{ animation: "fade-in-up 0.4s ease-out both" }}>
            <div className="text-sm font-medium">What's {parsedIntent?.recipient?.name}'s email?</div>

            {/* Voice email mode (default) */}
            {!showEmailTyping && !voiceEmail.parsedEmail && (
              <div className="space-y-3">
                <p className="text-xs text-white/40">
                  Say the email address, like "mama at gmail dot com"
                </p>

                {/* Live transcript */}
                {voiceEmail.spokenText && (
                  <p className="rounded-lg bg-white/[0.03] px-4 py-3 text-[13px] text-white/50 italic text-center">
                    "{voiceEmail.spokenText}"
                  </p>
                )}

                {/* Processing indicator */}
                {voiceEmail.isProcessing && (
                  <p className="text-xs text-primary/70 text-center animate-pulse">
                    Parsing email...
                  </p>
                )}

                {/* Mic listening indicator */}
                {!voiceEmail.spokenText && !voiceEmail.isProcessing && voiceEmail.supported && (
                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25">
                    <svg className="h-3 w-3 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                    Listening...
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowEmailTyping(true)}
                  className="text-[11px] text-white/30 underline underline-offset-2 hover:text-white/50 block mx-auto"
                >
                  Or type it instead
                </button>
              </div>
            )}

            {/* Parsed email confirmation */}
            {voiceEmail.parsedEmail && !showEmailTyping && (
              <div className="space-y-3">
                <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-center">
                  <p className="text-xs text-white/40 mb-1">Did you mean:</p>
                  <p className="text-sm font-medium text-white/90">{voiceEmail.parsedEmail}</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRecipientEmail(voiceEmail.parsedEmail!);
                      setStep("ask-voice-msg");
                    }}
                    className="btn-primary px-6"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      voiceEmail.retry();
                      setRecipientEmail("");
                    }}
                    className="btn-secondary"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailTyping(true);
                      setRecipientEmail("");
                    }}
                    className="btn-secondary"
                  >
                    Type it
                  </button>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                  Say "Yes" or "Try again"
                </div>
              </div>
            )}

            {/* Typing fallback */}
            {showEmailTyping && (
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <input
                  type="email"
                  required
                  autoFocus
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="mama@gmail.com"
                  className="glass-input"
                />
                <div className="flex gap-3">
                  <button type="submit" className="btn-primary">Continue</button>
                  <button type="button" onClick={resetFlow} className="btn-secondary">Cancel</button>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowEmailTyping(false); voiceEmail.retry(); }}
                  className="text-[11px] text-white/30 underline underline-offset-2 hover:text-white/50 block mx-auto"
                >
                  Use voice instead
                </button>
              </form>
            )}

            {/* Cancel button when in voice mode */}
            {!showEmailTyping && !voiceEmail.parsedEmail && (
              <div className="flex justify-center">
                <button type="button" onClick={resetFlow} className="btn-secondary text-xs">Cancel</button>
              </div>
            )}
          </div>
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
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              Say "Record" or "Skip"
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
              Transferring{" "}
              {parsedIntent?.totalOccurrences && parsedIntent.totalOccurrences > 1
                ? ((parsedIntent?.amount ?? parsedIntent?.amountUsdc ?? 0) * parsedIntent.totalOccurrences).toLocaleString()
                : (parsedIntent?.amount ?? parsedIntent?.amountUsdc)
              }{" "}
              {selectedToken} from your wallet to the payment agent
              {parsedIntent?.totalOccurrences && parsedIntent.totalOccurrences > 1
                ? ` (${parsedIntent.totalOccurrences} payments)`
                : ""
              }.
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
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              Say "New payment", "Rules", "Activity", or "Dismiss"
            </div>
          </div>
        )}

      </main>

      {step === "idle" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <button
            onClick={() => setShowWithdraw(true)}
            className="btn-secondary text-xs px-4 py-1.5"
          >
            Cash Out
          </button>
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
        <nav className="flex w-full justify-center gap-3">
          <Link to="/app/rules" className="glass-nav inline-flex flex-1 items-center justify-center gap-1.5">
            Rules
            {unseenRules > 0 && (
              <span className="glass-unseen-badge">
                {unseenRules > 99 ? "99+" : unseenRules}
              </span>
            )}
          </Link>
          <Link to="/app/activity" className="glass-nav inline-flex flex-1 items-center justify-center gap-1.5">
            Activity
            {unseenActivity > 0 && (
              <span className="glass-unseen-badge">
                {unseenActivity > 99 ? "99+" : unseenActivity}
              </span>
            )}
          </Link>
          <Link to="/app/recipients" className="glass-nav inline-flex flex-1 items-center justify-center gap-1.5">
            Recipients
          </Link>
        </nav>
      </footer>

      <WithdrawModal
        open={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        wallet={wallet}
        balances={balances}
        prices={portfolioValue.prices}
        currency={currency}
        privyId={user?.id ?? ""}
        voiceGender={voiceGender}
      />
    </div>
  );
}
