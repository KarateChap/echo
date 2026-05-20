import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useUnseenCounts } from "@/lib/useUnseenCounts";
import { FilterBar } from "@/components/FilterBar";
import { VoicePlayer } from "@/components/VoicePlayer";
import { useCurrency, formatFiatValue } from "@/lib/currencyConfig";
import { usePortfolioValue } from "@/lib/usePortfolioValue";
import { EchoLoader } from "@/components/EchoLoader";

const EXPLORER = import.meta.env.VITE_MORPH_HOODI_EXPLORER;
const PAGE_SIZE = 10;

function tokenToFiat(
  amount: number,
  token: string,
  prices: Record<string, Record<string, number>> | null,
  currency: string,
): string | null {
  if (!prices) return null;
  const tokenPrices = prices[token];
  if (!tokenPrices) return null;
  const rate = tokenPrices[currency.toLowerCase()];
  if (!rate) return null;
  return formatFiatValue(amount * rate, currency);
}

export default function Activity() {
  const { user } = usePrivy();
  const { currency } = useCurrency();
  const { prices, loading: pricesLoading } = usePortfolioValue([]);
  const txs = useQuery(
    api.transactions.listByUser,
    user ? { privyId: user.id } : "skip",
  );
  const { markActivitySeen } = useUnseenCounts();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const TX_STATUSES = ["success", "failed", "submitted", "pending", "withdrawal"];

  const filteredTxs = useMemo(() => {
    if (!txs) return undefined;
    const q = search.toLowerCase();
    // Ensure newest first (backend already sorts but guard against edge cases)
    const sorted = [...txs].sort((a, b) => (b.executedAt ?? b._creationTime) - (a.executedAt ?? a._creationTime));
    return sorted.filter((tx) => {
      if (q) {
        const matchesRecipient = tx.recipientName?.toLowerCase().includes(q);
        const matchesSender = tx.senderName?.toLowerCase().includes(q);
        if (!matchesRecipient && !matchesSender) return false;
      }
      if (statusFilter === "withdrawal") {
        if (tx._type !== "withdrawal") return false;
      } else if (statusFilter) {
        if (tx._type === "withdrawal" || tx.status !== statusFilter) return false;
      }
      const ts = tx.executedAt ?? tx._creationTime;
      if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        if (ts < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo).getTime() + 86_400_000;
        if (ts >= to) return false;
      }
      return true;
    });
  }, [txs, search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    markActivitySeen();
  }, [markActivitySeen]);

  const loadMore = useCallback(() => {
    if (filteredTxs) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredTxs.length));
    }
  }, [filteredTxs]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visibleTxs = filteredTxs?.slice(0, visibleCount);
  const hasMore = filteredTxs ? visibleCount < filteredTxs.length : false;

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col px-6">
      <header className="flex shrink-0 items-center gap-3 py-6">
        <Link to="/app" className="glass-nav text-sm">← Back</Link>
        <h1 className="text-xl font-semibold">Activity</h1>
      </header>

      {(txs === undefined || pricesLoading) && <EchoLoader message="Fetching activity…" />}

      {!pricesLoading && txs && txs.length === 0 && <p className="text-sm text-white/50">No payments yet.</p>}

      {!pricesLoading && txs && txs.length > 0 && (
        <>
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by name…"
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            statuses={TX_STATUSES}
            activeStatus={statusFilter}
            onStatusChange={setStatusFilter}
            filteredCount={filteredTxs?.length ?? 0}
            totalCount={txs.length}
          />

          {filteredTxs && filteredTxs.length === 0 && (
            <p className="text-sm text-white/50">No transactions match your filters.</p>
          )}

          {visibleTxs && visibleTxs.length > 0 && (
            <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6" style={{ maskImage: "linear-gradient(to bottom, transparent 0%, black 2%, black 95%, transparent 100%)" }}>
              <div className="space-y-3">
                {visibleTxs.map((tx) => (
                  <TxCard key={tx._id} tx={tx} prices={prices} currency={currency} />
                ))}

                {hasMore && (
                  <div ref={sentinelRef} className="flex justify-center py-4">
                    <span className="text-xs text-white/40">Loading more…</span>
                  </div>
                )}

                {!hasMore && filteredTxs && filteredTxs.length > PAGE_SIZE && (
                  <p className="py-4 text-center text-xs text-white/30">
                    All {filteredTxs.length} transactions loaded
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TxCard({ tx, prices, currency }: { tx: any; prices: Record<string, Record<string, number>> | null; currency: string }) {
  // Withdrawal card
  if (tx._type === "withdrawal") {
    return (
      <div className="glass-card glass-card-hover space-y-1 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <TruncatedText
              text={`↓ Withdrew to ${tx.destinationName}`}
              className="block truncate font-medium"
            />
            <span className="text-[10px] text-white/40">
              Cash out to {tx.destinationType === "ewallet" ? "e-wallet" : "bank"}
            </span>
          </div>
          <span className={`shrink-0 glass-badge ${
            tx.status === "success" ? "bg-teal-500/15 text-teal-400 border-teal-500/20" :
            tx.status === "failed" ? "bg-red-500/15 text-red-400 border-red-500/20" :
            "bg-amber-500/15 text-amber-400 border-amber-500/20"
          }`}>
            {tx.status === "success" ? "withdrawn" : tx.status}
          </span>
        </div>

        <div>
          <div className="text-xl font-bold">
            {tx.fiatCurrency
              ? formatFiatValue(tx.fiatAmount, tx.fiatCurrency)
              : `${tx.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tx.token}`}
          </div>
          {tx.fiatCurrency && (
            <div className="text-xs text-white/50">{tx.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {tx.token}</div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-white/40">
          <span>{tx.country}</span>
          <span>&middot;</span>
          <span className="font-mono">{tx.accountIdentifier}</span>
          <span>&middot;</span>
          <span className="font-mono">{tx.referenceNumber}</span>
        </div>

        {tx.executedAt && (
          <div className="text-[10px] text-white/40">
            {new Date(tx.executedAt).toLocaleString()}
          </div>
        )}

        {tx.txHash && (
          <a
            href={`${EXPLORER}/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[10px] text-primary transition-colors duration-150 hover:text-primary-glow"
          >
            View on MorphScan &rarr;
          </a>
        )}

        {tx.error && (
          <div className="mt-1 overflow-hidden rounded-lg bg-red-500/8 border border-red-500/15 px-3 py-2">
            <span className="text-[11px] text-red-400 leading-relaxed">{tx.error}</span>
          </div>
        )}
      </div>
    );
  }

  // Regular transaction card
  const isRefund = tx.error === "REFUND";
  const isAwaitingClaim = tx.status === "failed" && tx.error?.includes("claim email sent");
  const fiatDisplay = tokenToFiat(tx.amountUsdc, tx.token ?? "USDC", prices, currency);
  return (
    <div className="glass-card glass-card-hover space-y-1 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <TruncatedText
            text={isRefund ? "← Refund" : tx.isSender ? `→ ${tx.recipientName}` : `← from ${tx.senderName}`}
            className="block truncate font-medium"
          />
          <span className="text-[10px] text-white/40">
            {isRefund ? "Rule cancelled — unspent tokens returned" : isAwaitingClaim ? "Awaiting recipient signup" : tx.isSender ? "Sent" : "Received"}
          </span>
        </div>
        <span className={`shrink-0 glass-badge ${
          isRefund ? "bg-purple-500/15 text-purple-400 border-purple-500/20" :
          isAwaitingClaim ? "bg-amber-500/15 text-amber-400 border-amber-500/20" :
          tx.status === "success" ? "bg-green-500/15 text-green-400 border-green-500/20" :
          tx.status === "failed" ? "bg-red-500/15 text-red-400 border-red-500/20" :
          tx.status === "submitted" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
          "bg-white/10 text-white/50"
        }`}>
          {isRefund ? "refund" : isAwaitingClaim ? "awaiting claim" : tx.status}
        </span>
      </div>

      <div>
        {fiatDisplay && <div className="text-xl font-bold">{fiatDisplay}</div>}
        <div className={fiatDisplay ? "text-xs text-white/50" : "text-lg font-semibold"}>{tx.amountUsdc.toLocaleString()} {tx.token ?? "Unknown"}</div>
      </div>

      {tx.executedAt && (
        <div className="text-[10px] text-white/40">
          {new Date(tx.executedAt).toLocaleString()}
        </div>
      )}

      {tx.voiceMessageUrl && (
        <div className="pt-1 pb-3">
          <VoicePlayer url={tx.voiceMessageUrl} />
        </div>
      )}

      {tx.txHash && (
        <a
          href={`${EXPLORER}/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[10px] text-primary transition-colors duration-150 hover:text-primary-glow"
        >
          View on MorphScan &rarr;
        </a>
      )}

      {tx.error && !isRefund && !isAwaitingClaim && <TxError error={tx.error} />}
      {isAwaitingClaim && (
        <div className="mt-1 overflow-hidden rounded-lg bg-amber-500/8 border border-amber-500/15 px-3 py-2">
          <span className="text-[11px] text-amber-400 leading-relaxed">
            Claim email sent — waiting for {tx.recipientName} to sign up
          </span>
        </div>
      )}
    </div>
  );
}

function TruncatedText({ text, className }: { text: string; className?: string }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLSpanElement>(null);

  const startPress = useCallback(() => {
    timerRef.current = setTimeout(() => setShowTooltip(true), 500);
  }, []);

  const endPress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = () => setShowTooltip(false);
    document.addEventListener("touchstart", dismiss);
    document.addEventListener("click", dismiss);
    return () => {
      document.removeEventListener("touchstart", dismiss);
      document.removeEventListener("click", dismiss);
    };
  }, [showTooltip]);

  return (
    <span
      ref={elRef}
      className={`relative ${className ?? ""}`}
      title={text}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
    >
      {text}
      {showTooltip && (
        <span className="absolute left-0 top-full z-50 mt-1 max-w-[280px] whitespace-normal break-words rounded-lg border border-white/10 bg-[#1a1f35] px-3 py-2 text-[11px] font-normal text-white/90 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

function summarizeError(raw: string): string {
  // Extract the core reason from common on-chain error formats
  const reasonMatch = raw.match(/reason:\s*(.+?)(?:\.|$)/i);
  if (reasonMatch) {
    const reason = reasonMatch[1].trim();
    // Map known reasons to friendly messages
    if (/transfer amount exceeds balance/i.test(reason))
      return "Insufficient token balance to complete this transfer.";
    if (/insufficient funds/i.test(reason))
      return "Not enough funds to cover this transaction.";
    if (/allowance/i.test(reason))
      return "Token spending allowance not set or too low.";
    if (/paused/i.test(reason))
      return "The token contract is currently paused.";
    return reason.charAt(0).toUpperCase() + reason.slice(1);
  }
  // Fallback: truncate to first meaningful line
  const first = raw.split("\n")[0].trim();
  return first.length > 120 ? first.slice(0, 117) + "…" : first;
}

function TxError({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeError(error);
  const hasDetails = error.length > summary.length + 10;

  return (
    <div className="mt-1 overflow-hidden rounded-lg bg-red-500/8 border border-red-500/15 px-3 py-2">
      <TruncatedText text={summary} className="block truncate text-[11px] text-red-400 leading-relaxed" />
      {hasDetails && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && (
        <pre className="mt-1.5 max-h-28 overflow-auto scrollbar-thin whitespace-pre-wrap break-all text-[9px] leading-relaxed text-red-400/50">
          {error}
        </pre>
      )}
    </div>
  );
}
