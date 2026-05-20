import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SEA_COUNTRIES, type CountryConfig, type Destination } from "@/lib/seaDestinations";
import { formatFiatValue, CURRENCY_CONFIG } from "@/lib/currencyConfig";
import { fundAgentWallet } from "@/lib/fundAgentWallet";
import type { TokenBalance } from "@/lib/useTokenBalances";
import TokenIcon from "@/components/TokenIcon";
import AudioVisualizer from "@/components/AudioVisualizer";
import { DestinationLogo } from "@/components/DestinationLogo";
import { useStreamingAudio } from "@/lib/useStreamingAudio";
import { useAudioAnalyser } from "@/lib/useAudioAnalyser";
import { useConversationListener, type VoiceCommand } from "@/lib/useConversationListener";

const EXPLORER = import.meta.env.VITE_MORPH_HOODI_EXPLORER;
const convexSiteUrl = (import.meta.env.VITE_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site");

type Step =
  | "select-token"
  | "enter-amount"
  | "select-country"
  | "select-destination"
  | "enter-account"
  | "confirm"
  | "processing"
  | "success"
  | "error";

function generateReferenceNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `ECH-${code}`;
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request"))
    return "You cancelled the transaction. No funds were sent.";
  if (lower.includes("insufficient funds") || lower.includes("insufficient balance"))
    return "Not enough balance to complete this withdrawal.";
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("etimedout"))
    return "Network issue — please check your connection and try again.";
  if (lower.includes("nonce"))
    return "Transaction conflict — please try again.";
  return "Something went wrong. Please try again or contact support.";
}

function maskAccount(value: string): string {
  if (value.length <= 4) return "****";
  return value.slice(0, 4) + "***" + value.slice(-4);
}

interface Props {
  open: boolean;
  onClose: () => void;
  wallet: {
    switchChain: (chainId: number) => Promise<void>;
    getEthereumProvider: () => Promise<any>;
  } | undefined;
  balances: TokenBalance[];
  prices: Record<string, Record<string, number>> | null;
  currency: string;
  privyId: string;
  voiceGender?: "male" | "female";
}

export default function WithdrawModal({ open, onClose, wallet, balances, prices, currency, privyId, voiceGender = "female" }: Props) {
  const [step, setStep] = useState<Step>("select-token");
  const [selectedBalance, setSelectedBalance] = useState<TokenBalance | null>(null);
  const [amount, setAmount] = useState("");
  const [country, setCountry] = useState<CountryConfig | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destTab, setDestTab] = useState<"ewallet" | "bank">("ewallet");
  const [account, setAccount] = useState("");
  const accountRef = useRef(account);
  accountRef.current = account;
  const [txHash, setTxHash] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // TTS state
  const [ttsAudioEl, setTtsAudioEl] = useState<HTMLAudioElement | null>(null);
  const isTtsPlaying = !!ttsAudioEl;
  const speakingRef = useRef(false);

  const { playStream, stop: stopTts } = useStreamingAudio({
    onStart: (audio) => setTtsAudioEl(audio),
    onEnd: () => setTtsAudioEl(null),
  });

  const ttsLevelRef = useAudioAnalyser(ttsAudioEl);
  const idleLevelRef = useRef(0);

  const createWithdrawal = useMutation(api.withdrawals.create);
  const markSuccess = useMutation(api.withdrawals.markSuccess);
  const markFailed = useMutation(api.withdrawals.markFailed);

  // Show all tokens, sorted: non-zero balances first
  const sortedBalances = useMemo(
    () => [...balances].sort((a, b) => (b.raw > 0n ? 1 : 0) - (a.raw > 0n ? 1 : 0)),
    [balances],
  );

  // FX rate for selected token → selected currency
  const tokenRate = useMemo(() => {
    if (!selectedBalance || !prices) return 0;
    const tp = prices[selectedBalance.token.symbol];
    if (!tp) return 0;
    return tp[currency.toLowerCase()] ?? 0;
  }, [selectedBalance, prices, currency]);

  const hasFxRate = tokenRate > 0;
  const parsedAmount = parseFloat(amount) || 0;
  const tokenAmount = hasFxRate ? parsedAmount / tokenRate : parsedAmount;
  const fee = hasFxRate ? parsedAmount * 0.015 : 0;
  const totalFiat = parsedAmount + fee;
  const totalTokenAmount = hasFxRate ? totalFiat / tokenRate : parsedAmount;
  const maxBalance = selectedBalance ? parseFloat(selectedBalance.formatted) : 0;
  const maxFiat = maxBalance * tokenRate;
  const isOverBalance = totalTokenAmount > maxBalance;

  // ── TTS speak helper ──────────────────────────────────────────────────────
  const speak = useCallback(async (text: string) => {
    if (!convexSiteUrl) return;
    // Stop any current TTS before speaking the new prompt
    stopTts();
    speakingRef.current = true;
    try {
      const res = await fetch(`${convexSiteUrl}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voiceGender }),
      });
      if (res.ok) await playStream(res);
    } catch {}
    speakingRef.current = false;
  }, [voiceGender, playStream, stopTts]);

  // ── Speak prompts on step transitions ──────────────────────────────────────
  // Use refs to avoid effect re-firing on data changes — only fire on step/open change
  const selectedBalanceRef = useRef(selectedBalance);
  const countryRef = useRef(country);
  const destinationRef = useRef(destination);
  const hasFxRateRef = useRef(hasFxRate);
  const parsedAmountRef = useRef(parsedAmount);
  const currencyRef = useRef(currency);
  selectedBalanceRef.current = selectedBalance;
  countryRef.current = country;
  destinationRef.current = destination;
  hasFxRateRef.current = hasFxRate;
  parsedAmountRef.current = parsedAmount;
  currencyRef.current = currency;

  useEffect(() => {
    if (!open) return;

    function getPrompt(s: Step): string {
      switch (s) {
        case "select-token":
          return "Which token would you like to withdraw?";
        case "enter-amount":
          return selectedBalanceRef.current
            ? `How much ${selectedBalanceRef.current.token.symbol} would you like to withdraw? Say max for the full balance.`
            : "";
        case "select-country":
          return "Which country are you withdrawing to?";
        case "select-destination":
          return countryRef.current
            ? `Choose an e-wallet or bank in ${countryRef.current.name}. Say the name to select it.`
            : "";
        case "enter-account":
          return destinationRef.current
            ? `Please type your ${destinationRef.current.accountLabel} for ${destinationRef.current.name}. Say next when done.`
            : "";
        case "confirm": {
          const bal = selectedBalanceRef.current;
          const amtStr = hasFxRateRef.current && bal
            ? `${formatFiatValue(parsedAmountRef.current, currencyRef.current)} worth of ${bal.token.symbol}`
            : `${parsedAmountRef.current} ${bal?.token.symbol ?? "tokens"}`;
          return `You're withdrawing ${amtStr} to ${destinationRef.current?.name}. Say confirm to proceed, or cancel to go back.`;
        }
        case "success":
          return `Withdrawal complete! Your funds are on the way to ${destinationRef.current?.name}.`;
        default:
          return "";
      }
    }

    const text = getPrompt(step);
    if (text) {
      const timer = setTimeout(() => speak(text), 400);
      return () => clearTimeout(timer);
    }
  // Only trigger on step change or modal open/close
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);

  // ── Voice command map ──────────────────────────────────────────────────────
  const commandMap = useMemo<Record<string, VoiceCommand[]>>(() => {
    const tokenCmds: VoiceCommand[] = sortedBalances
      .filter((b) => b.raw > 0n)
      .map((b) => ({
        keywords: [b.token.symbol.toLowerCase(), b.token.name.toLowerCase()],
        action: () => { setSelectedBalance(b); setStep("enter-amount"); },
      }));

    const countryCmds: VoiceCommand[] = SEA_COUNTRIES.map((c) => ({
      keywords: [c.name.toLowerCase(), c.name.toLowerCase().replace(/-/g, " ")].filter((v, i, a) => a.indexOf(v) === i),
      action: () => {
        setCountry(c);
        setDestTab(c.destinations.some((d) => d.type === "ewallet") ? "ewallet" : "bank");
        setStep("select-destination");
      },
    }));

    const destCmds: VoiceCommand[] = country
      ? [
          ...country.destinations.map((d) => ({
            keywords: [
              d.name.toLowerCase(),
              d.name.toLowerCase().replace(/-/g, " "),
              ...(d.voiceKeywords ?? []),
            ].filter((v, i, a) => a.indexOf(v) === i),
            action: () => {
              setDestination(d);
              setAccount(d.type === "ewallet" && country.phonePrefix ? country.phonePrefix : "");
              setStep("enter-account");
            },
          })),
          { keywords: ["e-wallets", "e wallets", "ewallets", "ewallet", "show e-wallets", "switch to e-wallets"], action: () => setDestTab("ewallet") },
          { keywords: ["banks", "show banks", "switch to banks"], action: () => setDestTab("bank") },
        ]
      : [];

    return {
      "select-token": [
        ...tokenCmds,
        { keywords: ["cancel", "close", "nevermind"], action: () => handleClose() },
      ],
      "enter-amount": [
        { keywords: ["max", "maximum", "all", "everything"], action: () => {
          if (hasFxRate) {
            const maxWithdraw = maxFiat / 1.015;
            setAmount(maxWithdraw > 0 ? maxWithdraw.toFixed(2) : "0");
          } else {
            setAmount(maxBalance > 0 ? maxBalance.toString() : "0");
          }
        }},
        { keywords: ["continue", "next", "proceed"], action: () => {
          if (parsedAmountRef.current > 0) setStep("select-country");
        }},
        { keywords: ["back", "go back", "navigate back", "previous", "cancel"], action: () => handleClose() },
      ],
      "select-country": [
        ...countryCmds,
        { keywords: ["back", "go back", "navigate back", "previous", "cancel"], action: () => handleClose() },
      ],
      "select-destination": [
        ...destCmds,
        { keywords: ["back", "go back", "navigate back", "previous", "cancel"], action: () => handleClose() },
      ],
      "enter-account": [
        { keywords: ["review", "next", "continue", "proceed"], action: () => {
          if (accountRef.current.trim().length >= 4) setStep("confirm");
        }},
        { keywords: ["back", "go back", "navigate back", "previous", "cancel"], action: () => handleClose() },
      ],
      "confirm": [
        { keywords: ["confirm", "yes", "approve", "proceed", "sige", "go ahead", "let's go"], action: () => handleConfirm() },
        { keywords: ["cancel", "back", "no", "nevermind", "huwag", "wag na"], action: () => handleClose() },
      ],
      "success": [
        { keywords: ["done", "close", "okay", "thanks"], action: () => handleClose() },
      ],
      "error": [
        { keywords: ["retry", "try again", "again"], action: () => { reset(); setStep("select-token"); } },
        { keywords: ["close", "cancel", "done"], action: () => handleClose() },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedBalances, country, hasFxRate, maxFiat, maxBalance, parsedAmount, isOverBalance, account]);

  // Voice listening — only enable after first TTS prompt finishes to avoid
  // SpeechRecognition fighting with audio playback on startup
  const [voiceReady, setVoiceReady] = useState(false);
  useEffect(() => {
    if (!open) { setVoiceReady(false); return; }
    // Enable voice listening 3s after modal opens (after first TTS prompt plays)
    const timer = setTimeout(() => setVoiceReady(true), 3000);
    return () => clearTimeout(timer);
  }, [open]);

  const isVoiceStep = voiceReady && step !== "processing";

  // Parse spoken numbers for the enter-amount step
  const lastVoiceAmountRef = useRef<string>("");
  const userIsTypingRef = useRef(false);

  const handleUnmatched = useCallback((transcript: string, currentStep: string) => {
    if (currentStep !== "enter-amount") return;
    if (userIsTypingRef.current) return; // Don't overwrite manual input
    const cleaned = transcript.replace(/,/g, "").toLowerCase().trim();
    if (cleaned === lastVoiceAmountRef.current) return; // Deduplicate
    // Remove common filler words: "pesos", "dollars", "php", etc.
    const stripped = cleaned.replace(/\b(pesos?|dollars?|php|usd|usdc|usdt|eth|htt|bucks?|worth)\b/g, "").trim();
    const num = parseFloat(stripped);
    if (!isNaN(num) && num > 0) {
      lastVoiceAmountRef.current = cleaned;
      setAmount(num.toString());
    }
  }, []);

  const { interimTranscript } = useConversationListener({
    enabled: isVoiceStep,
    currentStep: step,
    ttsPlaying: isTtsPlaying,
    commandMap,
    onUnmatched: handleUnmatched,
  });

  // ── Reset & cleanup ────────────────────────────────────────────────────────
  function reset() {
    stopTts();
    userIsTypingRef.current = false;
    lastVoiceAmountRef.current = "";
    setStep("select-token");
    setSelectedBalance(null);
    setAmount("");
    setCountry(null);
    setDestination(null);
    setDestTab("ewallet");
    setAccount("");
    setTxHash("");
    setRefNumber("");
    setErrorMsg("");
  }

  function handleClose() {
    if (step === "processing") return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    if (!wallet || !selectedBalance || !country || !destination) return;
    stopTts();
    setStep("processing");

    const ref = generateReferenceNumber();
    setRefNumber(ref);

    let withdrawalId: Awaited<ReturnType<typeof createWithdrawal>> | null = null;

    try {
      withdrawalId = await createWithdrawal({
        privyId,
        token: selectedBalance.token.symbol,
        tokenAmount: totalTokenAmount,
        fiatAmount: hasFxRate ? parsedAmount : 0,
        fiatCurrency: hasFxRate ? currency : "",
        country: country.code,
        destinationType: destination.type,
        destinationName: destination.name,
        accountIdentifier: maskAccount(account),
        referenceNumber: ref,
        fee,
      });

      const hash = await fundAgentWallet({
        wallet,
        token: selectedBalance.token,
        amount: totalTokenAmount,
      });

      setTxHash(hash);
      await markSuccess({ withdrawalId, txHash: hash });
      setStep("success");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setErrorMsg(msg.length > 200 ? msg.slice(0, 197) + "..." : msg);
      if (withdrawalId) {
        try { await markFailed({ withdrawalId, error: msg.slice(0, 500) }); } catch {}
      }
      setStep("error");
    }
  }

  if (!open) return null;

  const currencySymbol = CURRENCY_CONFIG[currency]?.symbol ?? currency;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6"
      onClick={handleClose}
    >
      <div
        className="glass-card w-full max-w-sm flex flex-col p-6 h-[85dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Audio Visualizer — always visible */}
        <div className="flex justify-center py-1 shrink-0">
          <AudioVisualizer
            levelRef={isTtsPlaying ? ttsLevelRef : idleLevelRef}
            active={isTtsPlaying}
            size={80}
          />
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-4 min-h-0">

        {/* Header */}
        {step !== "processing" && step !== "success" && (
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">
              {step === "select-token" && "Cash Out"}
              {step === "enter-amount" && "Enter Amount"}
              {step === "select-country" && "Select Country"}
              {step === "select-destination" && "Select Destination"}
              {step === "enter-account" && "Account Details"}
              {step === "confirm" && "Confirm Withdrawal"}
              {step === "error" && "Withdrawal Failed"}
            </h2>
          </div>
        )}

        {/* Step 1: Select Token */}
        {step === "select-token" && (
          <div className="space-y-2">
            <p className="text-xs text-white/40">Select token to withdraw, or say its name</p>
            {sortedBalances.length === 0 && (
              <p className="text-sm text-white/50 py-4 text-center">No tokens available.</p>
            )}
            {sortedBalances.map((b) => {
              const fiat = prices?.[b.token.symbol]?.[currency.toLowerCase()] ?? 0;
              const fiatVal = parseFloat(b.formatted) * fiat;
              const hasBalance = b.raw > 0n;
              return (
                <button
                  key={`${b.token.symbol}:${b.token.address}`}
                  onClick={() => { if (hasBalance) { setSelectedBalance(b); setStep("enter-amount"); } }}
                  disabled={!hasBalance}
                  className={`glass-card flex w-full items-center gap-3 p-3 text-left ${hasBalance ? "glass-card-hover" : "opacity-40 cursor-not-allowed"}`}
                >
                  <TokenIcon icon={b.token.icon} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{b.token.symbol}</div>
                    <div className="text-[11px] text-white/40">{b.token.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium tabular-nums">{parseFloat(b.formatted).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: b.token.symbol === "ETH" ? 4 : 2 })}</div>
                    {fiatVal > 0 && <div className="text-[11px] text-white/40">{formatFiatValue(fiatVal, currency)}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2: Enter Amount */}
        {step === "enter-amount" && selectedBalance && (
          <div className="space-y-3">
            <p className="text-xs text-white/40">
              Withdraw from <span className="text-white/70 font-medium">{selectedBalance.token.symbol}</span>
              {" "}&middot; Balance: {parseFloat(selectedBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </p>

            <div className="relative">
              {hasFxRate && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">{currencySymbol}</span>
              )}
              {!hasFxRate && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">{selectedBalance.token.symbol}</span>
              )}
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => { userIsTypingRef.current = true; setAmount(e.target.value); }}
                placeholder="0.00"
                className={`glass-input text-lg font-semibold tabular-nums ${hasFxRate ? "pl-8" : "pl-14"}`}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between text-xs text-white/40">
              <span>
                {hasFxRate && tokenAmount > 0
                  ? `${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selectedBalance.token.symbol}`
                  : !hasFxRate
                    ? "No exchange rate available"
                    : "\u00A0"}
              </span>
              <button
                onClick={() => {
                  if (hasFxRate) {
                    const maxWithdraw = maxFiat / 1.015;
                    setAmount(maxWithdraw > 0 ? maxWithdraw.toFixed(2) : "0");
                  } else {
                    setAmount(maxBalance > 0 ? maxBalance.toString() : "0");
                  }
                }}
                className="text-primary hover:text-primary-glow transition-colors"
              >
                Max
              </button>
            </div>

            {parsedAmount > 0 && (
              <div className="glass-card p-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/40">Amount</span>
                  <span>{hasFxRate ? formatFiatValue(parsedAmount, currency) : `${parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selectedBalance.token.symbol}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Fee (1.5%)</span>
                  <span>{hasFxRate ? formatFiatValue(fee, currency) : "N/A"}</span>
                </div>
                <div className="flex justify-between font-medium border-t border-white/[0.06] pt-1">
                  <span className="text-white/40">Total deducted</span>
                  <span>{totalTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedBalance.token.symbol}</span>
                </div>
              </div>
            )}

            {isOverBalance && parsedAmount > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/[0.06] px-3 py-2.5">
                <span className="text-xs text-red-400">Insufficient balance (including fee).</span>
              </div>
            )}

            <button
              onClick={() => setStep("select-country")}
              disabled={parsedAmount <= 0 || isOverBalance}
              className="btn-primary w-full"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 3: Select Country */}
        {step === "select-country" && (
          <div className="space-y-2">
            <p className="text-xs text-white/40">Where are you withdrawing to? Say the country name</p>
            <div className="space-y-1.5 max-h-[50dvh] overflow-y-auto scrollbar-thin pr-1">
              {SEA_COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => {
                    setCountry(c);
                    setDestTab(c.destinations.some((d) => d.type === "ewallet") ? "ewallet" : "bank");
                    setStep("select-destination");
                  }}
                  className={`glass-card glass-card-hover flex w-full items-center gap-3 p-3 text-left ${
                    c.currency === currency ? "border-primary/30" : ""
                  }`}
                >
                  <span className="text-xl">{c.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-white/40">{c.currency}</div>
                  </div>
                  {c.currency === currency && (
                    <span className="glass-badge text-[9px] bg-primary/15 text-primary border-primary/20">Current</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Select Destination */}
        {step === "select-destination" && country && (
          <div className="space-y-3">
            <p className="text-xs text-white/40">{country.flag} {country.name} &middot; Say the name to select</p>

            {/* Tabs */}
            <div className="flex gap-2">
              {(["ewallet", "bank"] as const).map((tab) => {
                const count = country.destinations.filter((d) => d.type === tab).length;
                if (count === 0) return null;
                return (
                  <button
                    key={tab}
                    onClick={() => setDestTab(tab)}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      destTab === tab
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08]"
                    }`}
                  >
                    {tab === "ewallet" ? "E-Wallets" : "Banks"} ({count})
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5 max-h-[40dvh] overflow-y-auto scrollbar-thin pr-1">
              {country.destinations
                .filter((d) => d.type === destTab)
                .map((d) => (
                  <button
                    key={d.name}
                    onClick={() => {
                      setDestination(d);
                      setAccount(d.type === "ewallet" && country?.phonePrefix ? country.phonePrefix : "");
                      setStep("enter-account");
                    }}
                    className="glass-card glass-card-hover flex w-full items-center gap-3 p-3 text-left"
                  >
                    <DestinationLogo destination={d} size="sm" />
                    <span className="text-sm font-medium">{d.name}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Step 5: Enter Account */}
        {step === "enter-account" && destination && (
          <div className="space-y-3">
            <div className="glass-card flex items-center gap-3 p-3">
              <DestinationLogo destination={destination} size="lg" />
              <div>
                <div className="text-sm font-semibold">{destination.name}</div>
                <div className="text-[11px] text-white/40">{country?.flag} {country?.name}</div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-white/40">{destination.accountLabel}</label>
              <input
                type="tel"
                inputMode="numeric"
                value={account}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  const max = destination.type === "ewallet"
                    ? (country?.phoneMaxDigits ?? 13)
                    : (country?.bankMaxDigits ?? 16);
                  setAccount(digits.slice(0, max));
                }}
                maxLength={destination.type === "ewallet"
                  ? (country?.phoneMaxDigits ?? 13)
                  : (country?.bankMaxDigits ?? 16)}
                placeholder={destination.type === "ewallet"
                  ? (country?.phonePrefix ?? "") + "x".repeat((country?.phoneMaxDigits ?? 11) - (country?.phonePrefix?.length ?? 0))
                  : "x".repeat(country?.bankMaxDigits ?? 12)}
                className="glass-input text-sm"
                autoFocus
              />
              <p className="text-[10px] text-white/30 mt-1">Say "next" when done</p>
            </div>

            <button
              onClick={() => setStep("confirm")}
              disabled={account.trim().length < 4}
              className="btn-primary w-full"
            >
              Review
            </button>
          </div>
        )}

        {/* Step 6: Confirm */}
        {step === "confirm" && selectedBalance && country && destination && (
          <div className="space-y-4">
            <div className="glass-card p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Withdraw</span>
                <span className="font-semibold">{hasFxRate ? formatFiatValue(parsedAmount, currency) : `${parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selectedBalance.token.symbol}`}</span>
              </div>
              {hasFxRate && (
                <div className="flex justify-between">
                  <span className="text-white/40">Token</span>
                  <span>{tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedBalance.token.symbol}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-white/40">Destination</span>
                <span>{destination.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Account</span>
                <span className="font-mono text-xs">{account}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Country</span>
                <span>{country.flag} {country.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Fee (1.5%)</span>
                <span>{hasFxRate ? formatFiatValue(fee, currency) : "N/A"}</span>
              </div>
              <div className="flex justify-between font-medium border-t border-white/[0.06] pt-2">
                <span className="text-white/40">Total deducted</span>
                <span>{totalTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedBalance.token.symbol}</span>
              </div>
            </div>

            <p className="text-[10px] text-white/30 text-center">Say "confirm" to proceed or "cancel" to go back</p>

            <div className="flex gap-3">
              <button onClick={handleConfirm} className="btn-primary flex-1">
                Confirm Withdrawal
              </button>
              <button onClick={handleClose} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 7: Processing */}
        {step === "processing" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">Processing withdrawal...</p>
              <p className="text-xs text-white/40 mt-1">Please wait while we process your transaction</p>
            </div>
          </div>
        )}

        {/* Step 8: Success */}
        {step === "success" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 border border-green-500/20">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">Withdrawal Successful</p>
              <p className="text-sm text-white/50 mt-1">
                {hasFxRate ? formatFiatValue(parsedAmount, currency) : `${parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selectedBalance?.token.symbol}`} to {destination?.name}
              </p>
            </div>

            <div className="glass-card w-full p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Reference</span>
                <span className="font-mono text-xs font-medium">{refNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Account</span>
                <span className="font-mono text-xs">{account}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Amount</span>
                <span>{totalTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedBalance?.token.symbol}</span>
              </div>
              {txHash && (
                <a
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11px] text-primary transition-colors hover:text-primary-glow pt-1"
                >
                  View on MorphScan &rarr;
                </a>
              )}
            </div>

            <p className="text-[10px] text-white/30">Say "done" to close</p>
            <button onClick={handleClose} className="btn-primary w-full">Done</button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 border border-red-500/20">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">Withdrawal Failed</p>
              <p className="text-xs text-white/50 mt-2 max-w-[280px]">{friendlyError(errorMsg)}</p>
            </div>
            <p className="text-[10px] text-white/30">Say "retry" or "close"</p>
            <div className="flex gap-3 w-full">
              <button onClick={() => { reset(); setStep("select-token"); }} className="btn-primary flex-1">Try Again</button>
              <button onClick={handleClose} className="btn-secondary flex-1">Close</button>
            </div>
          </div>
        )}
        </div>{/* end scrollable content */}

        {/* Fixed footer: Cancel + Transcript */}
        {!["processing", "success"].includes(step) && (
          <div className="shrink-0 pt-3 border-t border-white/[0.06] space-y-2">
            {!["confirm", "error"].includes(step) && (
              <button onClick={handleClose} className="text-xs text-white/40 hover:text-white/70 transition-colors w-full text-center py-1">
                Cancel Cash Out
              </button>
            )}
            {isVoiceStep && (
              <p className="text-xs text-white/30 text-center truncate min-h-[1.25rem]">
                {interimTranscript
                  ? <span className="text-white/50 italic">&ldquo;{interimTranscript}&rdquo;</span>
                  : <span>Listening...</span>}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
