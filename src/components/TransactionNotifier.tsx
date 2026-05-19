import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { playPaymentReceivedSound } from "@/lib/notificationSound";

interface Toast {
  id: string;
  message: string;
  detail: string;
  type: "sent" | "received" | "failed";
  exiting?: boolean;
  amount?: number;
  token?: string;
}

const ACCENT = {
  received: {
    border: "rgba(34, 197, 94, 0.15)",
    glow: "rgba(34, 197, 94, 0.08)",
    icon: "rgba(34, 197, 94, 0.12)",
    iconBorder: "rgba(34, 197, 94, 0.2)",
    text: "#4ade80",
    arrow: "\u2193",
  },
  failed: {
    border: "rgba(239, 68, 68, 0.15)",
    glow: "rgba(239, 68, 68, 0.08)",
    icon: "rgba(239, 68, 68, 0.12)",
    iconBorder: "rgba(239, 68, 68, 0.2)",
    text: "#f87171",
    arrow: "!",
  },
  sent: {
    border: "rgba(124, 58, 237, 0.15)",
    glow: "rgba(124, 58, 237, 0.08)",
    icon: "rgba(124, 58, 237, 0.12)",
    iconBorder: "rgba(124, 58, 237, 0.25)",
    text: "#a78bfa",
    arrow: "\u2191",
  },
} as const;

export default function TransactionNotifier() {
  const { user } = usePrivy();
  const txs = useQuery(
    api.transactions.listByUser,
    user ? { privyId: user.id } : "skip",
  );
  const navigate = useNavigate();

  const seenIdsRef = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 350);
  }, []);

  useEffect(() => {
    if (!txs) return;

    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(txs.map((tx) => tx._id));
      return;
    }

    const newTxs = txs.filter((tx) => !seenIdsRef.current!.has(tx._id));
    if (newTxs.length === 0) return;

    // Mark all new IDs as seen immediately (even if filtered below)
    for (const tx of newTxs) {
      seenIdsRef.current.add(tx._id);
    }

    // Filter out refund transactions for recipients — only the sender should see refunds
    const notifiable = newTxs.filter((tx) => {
      if (tx.error === "REFUND" && !tx.isSender) return false;
      return true;
    });
    if (notifiable.length === 0) return;

    const newToasts: Toast[] = notifiable.map((tx) => {
      const isRefund = tx.error === "REFUND";
      const isSent = tx.isSender;
      const failed = tx.status === "failed";
      const isReceived = !failed && !isSent && !isRefund;
      return {
        id: tx._id,
        message: isRefund
          ? "Rule Cancelled \u2014 Refund"
          : failed
            ? "Payment Failed"
            : isSent
              ? "Payment Sent"
              : "Payment Received",
        detail: isRefund
          ? `${tx.amountUsdc.toLocaleString()} ${tx.token ?? "Unknown"} returned to your wallet`
          : failed
            ? `${tx.amountUsdc.toLocaleString()} ${tx.token ?? "Unknown"} to ${tx.recipientName}`
            : isSent
              ? `${tx.amountUsdc.toLocaleString()} ${tx.token ?? "Unknown"} to ${tx.recipientName}`
              : `from ${tx.senderName}`,
        type: isRefund ? "received" : failed ? "failed" : isSent ? "sent" : "received",
        amount: (isRefund || isReceived) ? tx.amountUsdc : undefined,
        token: (isRefund || isReceived) ? (tx.token ?? "Unknown") : undefined,
      };
    });

    setToasts((prev) => [...newToasts, ...prev].slice(0, 5));

    for (const toast of newToasts) {
      if (toast.type === "received") {
        playPaymentReceivedSound();
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      }
      setTimeout(() => dismissToast(toast.id), toast.type === "received" ? 7000 : 5000);
    }
  }, [txs, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-4 left-4 z-50 mx-auto flex max-w-sm flex-col-reverse gap-2.5 pointer-events-none">
      {toasts.map((toast) => {
        const a = ACCENT[toast.type];
        const isReceived = toast.type === "received";

        if (isReceived) {
          return (
            <div
              key={toast.id}
              onClick={() => {
                dismissToast(toast.id);
                navigate("/app/activity");
              }}
              className={`pointer-events-auto cursor-pointer glass-toast-received flex flex-col gap-1 px-4 py-3.5 transition-all duration-350 ease-out ${
                toast.exiting
                  ? "translate-y-[120%] opacity-0 scale-95"
                  : "translate-y-0 opacity-100 scale-100 animate-[received-slide-up_0.45s_cubic-bezier(0.16,1,0.3,1)]"
              }`}
              style={{
                borderColor: "rgba(34, 197, 94, 0.2)",
                animation: toast.exiting ? undefined : "received-glow-pulse 2s ease-in-out infinite",
              }}
            >
              {/* Shimmer overlay */}
              {!toast.exiting && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                  <div
                    className="absolute inset-0 h-full w-1/2 animate-[shimmer-sweep_0.8s_ease-out_0.1s_both]"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)" }}
                  />
                </div>
              )}

              {/* Row 1: icon + message + dismiss */}
              <div className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: "rgba(34, 197, 94, 0.12)",
                    border: "1px solid rgba(34, 197, 94, 0.25)",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <ArrowDownLeft size={18} className="text-green-400" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight text-green-400">
                    {toast.message}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-tight text-white/45 truncate">
                    {toast.detail}
                  </p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissToast(toast.id);
                  }}
                  className="glass-toast-dismiss flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] text-white/25 transition-all duration-150 hover:bg-white/[0.06] hover:text-white/50"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Row 2: prominent amount */}
              {toast.amount !== undefined && (
                <div className="flex items-baseline gap-1.5 pl-14 animate-[amount-count-in_0.4s_ease-out_0.15s_both]">
                  <span className="text-xl font-bold text-green-400">
                    +{toast.amount.toLocaleString()}
                  </span>
                  <span className="text-xs font-medium text-green-400/60">
                    {toast.token}
                  </span>
                </div>
              )}

              {/* Sparkles */}
              {!toast.exiting && (
                <>
                  {[0, 0.15, 0.3].map((delay, i) => (
                    <span
                      key={i}
                      className="pointer-events-none absolute h-1 w-1 rounded-full bg-green-400/70"
                      style={{
                        left: `${20 + i * 30}%`,
                        bottom: "40%",
                        animation: `sparkle-float 0.8s ease-out ${delay}s both`,
                      }}
                    />
                  ))}
                </>
              )}

              {/* Auto-dismiss progress shimmer */}
              <div
                className="absolute bottom-0 left-4 right-4 h-px overflow-hidden rounded-full"
                style={{ opacity: toast.exiting ? 0 : 1 }}
              >
                <div
                  className="h-full rounded-full animate-[toast-progress_7s_linear_forwards]"
                  style={{ background: "linear-gradient(90deg, transparent, #4ade80, transparent)" }}
                />
              </div>
            </div>
          );
        }

        // Sent / Failed toast (unchanged)
        return (
          <div
            key={toast.id}
            onClick={() => {
              dismissToast(toast.id);
              navigate("/app/activity");
            }}
            className={`pointer-events-auto cursor-pointer glass-toast flex items-center gap-3 px-4 py-3 transition-all duration-350 ease-out ${
              toast.exiting
                ? "translate-y-[120%] opacity-0 scale-95"
                : "translate-y-0 opacity-100 scale-100 animate-[slide-up_0.35s_cubic-bezier(0.16,1,0.3,1)]"
            }`}
            style={{
              borderColor: a.border,
              boxShadow: `
                inset 0 1px 0 0 rgba(255, 255, 255, 0.06),
                0 0 20px ${a.glow},
                0 8px 32px rgba(0, 0, 0, 0.3)
              `,
            }}
          >
            {/* Icon pill */}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
              style={{
                background: a.icon,
                border: `1px solid ${a.iconBorder}`,
                color: a.text,
                backdropFilter: "blur(8px)",
              }}
            >
              {a.arrow}
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-tight" style={{ color: a.text }}>
                {toast.message}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-white/45 truncate">
                {toast.detail}
              </p>
            </div>

            {/* Dismiss */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              className="glass-toast-dismiss flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] text-white/25 transition-all duration-150 hover:bg-white/[0.06] hover:text-white/50"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            {/* Auto-dismiss progress shimmer */}
            <div
              className="absolute bottom-0 left-4 right-4 h-px overflow-hidden rounded-full"
              style={{ opacity: toast.exiting ? 0 : 1 }}
            >
              <div
                className="h-full rounded-full animate-[toast-progress_5s_linear_forwards]"
                style={{ background: `linear-gradient(90deg, transparent, ${a.text}, transparent)` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
