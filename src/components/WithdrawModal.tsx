import { useState, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SEA_COUNTRIES, type CountryConfig, type Destination } from "@/lib/seaDestinations";
import { formatFiatValue, CURRENCY_CONFIG } from "@/lib/currencyConfig";
import { fundAgentWallet } from "@/lib/fundAgentWallet";
import type { TokenBalance } from "@/lib/useTokenBalances";
import TokenIcon from "@/components/TokenIcon";

const EXPLORER = import.meta.env.VITE_MORPH_HOODI_EXPLORER;

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
}

export default function WithdrawModal({ open, onClose, wallet, balances, prices, currency, privyId }: Props) {
  const [step, setStep] = useState<Step>("select-token");
  const [selectedBalance, setSelectedBalance] = useState<TokenBalance | null>(null);
  const [amount, setAmount] = useState("");
  const [country, setCountry] = useState<CountryConfig | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destTab, setDestTab] = useState<"ewallet" | "bank">("ewallet");
  const [account, setAccount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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

  function reset() {
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

  function handleBack() {
    switch (step) {
      case "enter-amount": setStep("select-token"); break;
      case "select-country": setStep("enter-amount"); break;
      case "select-destination": setStep("select-country"); break;
      case "enter-account": setStep("select-destination"); break;
      case "confirm": setStep("enter-account"); break;
      case "error": setStep("confirm"); break;
      default: break;
    }
  }

  async function handleConfirm() {
    if (!wallet || !selectedBalance || !country || !destination) return;
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
        className="glass-card w-full max-w-sm space-y-4 p-6 max-h-[85dvh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {step !== "processing" && step !== "success" && (
          <div className="flex items-center gap-3">
            {step !== "select-token" && (
              <button onClick={handleBack} className="text-sm text-white/50 hover:text-white transition-colors">
                &larr;
              </button>
            )}
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
            <p className="text-xs text-white/40">Select token to withdraw</p>
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
            <button onClick={handleClose} className="btn-secondary w-full mt-2">Cancel</button>
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
                onChange={(e) => setAmount(e.target.value)}
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
            <p className="text-xs text-white/40">Where are you withdrawing to?</p>
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
            <p className="text-xs text-white/40">{country.flag} {country.name}</p>

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
                    onClick={() => { setDestination(d); setStep("enter-account"); }}
                    className="glass-card glass-card-hover flex w-full items-center gap-3 p-3 text-left"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-sm">
                      {d.type === "ewallet" ? "📱" : "🏦"}
                    </span>
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
              <span className="text-lg">{destination.type === "ewallet" ? "📱" : "🏦"}</span>
              <div>
                <div className="text-sm font-semibold">{destination.name}</div>
                <div className="text-[11px] text-white/40">{country?.flag} {country?.name}</div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-white/40">{destination.accountLabel}</label>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={destination.type === "ewallet" ? "09xxxxxxxxx" : "xxxx-xxxx-xxxx"}
                className="glass-input text-sm"
                autoFocus
              />
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
                <span className="font-mono text-xs">{maskAccount(account)}</span>
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

            <div className="flex gap-3">
              <button onClick={handleConfirm} className="btn-primary flex-1">
                Confirm Withdrawal
              </button>
              <button onClick={handleBack} className="btn-secondary flex-1">
                Back
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
                <span className="font-mono text-xs">{maskAccount(account)}</span>
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
              <p className="text-xs text-white/50 mt-2 max-w-[280px]">{errorMsg}</p>
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={handleBack} className="btn-primary flex-1">Try Again</button>
              <button onClick={handleClose} className="btn-secondary flex-1">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
