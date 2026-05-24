import { useState } from "react";
import { Mic, MessageCircle, Repeat, Command, Music, LayoutList, Wallet, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface TutorialPage {
  icon: LucideIcon;
  title: string;
  items: { label: string; text: string }[];
  examples?: string[];
}

const PAGES: TutorialPage[] = [
  {
    icon: Mic,
    title: "Quick Payment",
    items: [
      { label: "Tap a token", text: "Tap any token orbiting the center orb to start a payment in that token." },
      { label: "Speak", text: "Say your instruction naturally in your own language — Echo auto-detects and understands it." },
      { label: "Confirm", text: "Review the parsed details, then tap Approve or say it out loud." },
    ],
    examples: [
      "\"Send mama 10k\"",
      "\"Transfer 5000 to wife\"",
    ],
  },
  {
    icon: Wallet,
    title: "Fund Your Wallet",
    items: [
      { label: "Copy your address", text: "Tap the address at the top of the screen to copy your Morph Hoodi wallet address." },
      { label: "Get ETH + USDC", text: "Visit morph-rails-hoodi.morph.network/faucet to claim 0.01 ETH and 10 USDC per request." },
      { label: "More USDC", text: "Need more? Visit faucet.circle.com, select Morph, and paste your address for 20 extra testnet USDC." },
      { label: "Alternative", text: "You can also use faucets.chain.link for Morph Hoodi testnet tokens." },
    ],
  },
  {
    icon: MessageCircle,
    title: "Chat Mode",
    items: [
      { label: "Tap the orb", text: "Tap the center orb (without selecting a token) to start a free-form chat." },
      { label: "Ask anything", text: "Check balances, make payments conversationally, or ask questions." },
      { label: "Withdraw", text: "Say \"withdraw\" or \"cashout\" to open the withdrawal flow." },
    ],
    examples: [
      "\"What's my balance?\"",
      "\"Send wife 5k USDT\"",
    ],
  },
  {
    icon: Repeat,
    title: "Payment Types",
    items: [
      { label: "Immediate", text: "\"Send mama 10k now\"" },
      { label: "Scheduled", text: "\"Send mama 10k on June 15\"" },
      { label: "Recurring", text: "\"Send mama 10k every month for 6 months\"" },
      { label: "Conditional", text: "\"If mama's wallet drops below 2k, top up 3k\"" },
    ],
  },
  {
    icon: Command,
    title: "Voice Commands & Language",
    items: [
      { label: "Approve", text: "Say \"Approve\", \"Confirm\", or equivalent in your language." },
      { label: "Cancel", text: "Say \"Cancel\", \"Nevermind\", or equivalent in your language." },
      { label: "Navigate", text: "\"New payment\", \"Rules\", \"Activity\"" },
      { label: "Fiat mode", text: "\"500 pesos worth of ETH\" — converts any local currency to token automatically." },
      { label: "Any language", text: "Speak in any language — Echo auto-detects and responds in the same language." },
    ],
  },
  {
    icon: Music,
    title: "Voice Messages & Tokens",
    items: [
      { label: "Voice message", text: "Record an optional voice message when creating a payment. Recipients hear it when they claim." },
      { label: "Custom tokens", text: "Tap the \"+\" button in the orbit to add any ERC-20 token by contract address." },
      { label: "Manage orbit", text: "Tap \"Customize\" to show, hide, or remove tokens from your orbit." },
    ],
  },
  {
    icon: LayoutList,
    title: "Rules & Activity",
    items: [
      { label: "Rules", text: "View and manage all your recurring and conditional payment rules." },
      { label: "Pause / Resume", text: "Pause an active rule or resume it anytime." },
      { label: "Activity", text: "View full transaction history, play voice messages, and open blockchain explorer links." },
      { label: "Progress", text: "Track recurring payment progress (e.g., 3/6 payments sent)." },
    ],
  },
];

export default function TutorialModal({ open, onClose }: Props) {
  const [page, setPage] = useState(0);

  if (!open) return null;

  const current = PAGES[page];
  const isLast = page === PAGES.length - 1;
  const isFirst = page === 0;
  const Icon = current.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => { setPage(0); onClose(); }}
    >
      <div
        className="glass-card w-full max-w-sm mx-4 p-0 flex flex-col"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(99, 102, 241, 0.2)", border: "1px solid rgba(99, 102, 241, 0.25)" }}
            >
              <Icon className="h-[18px] w-[18px] text-indigo-300" />
            </div>
            <h2 className="text-base font-semibold text-white/90">{current.title}</h2>
          </div>
          <button
            onClick={() => { setPage(0); onClose(); }}
            className="rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="space-y-3">
            {current.items.map((item, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                  style={{ background: "rgba(168, 85, 247, 0.18)", color: "rgba(196, 132, 252, 0.9)" }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-white/80">{item.label}</span>
                  <p className="mt-0.5 text-[13px] leading-snug text-white/50">{item.text}</p>
                </div>
              </div>
            ))}
          </div>

          {current.examples && (
            <div
              className="mt-4 rounded-xl px-4 py-3"
              style={{ background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.12)" }}
            >
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-300/60">Try saying</p>
              <div className="space-y-1">
                {current.examples.map((ex, i) => (
                  <p key={i} className="text-[13px] italic text-white/60">{ex}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer: dots + nav */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4">
          {/* Dots */}
          <div className="flex gap-1.5">
            {PAGES.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className="h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: i === page ? 18 : 6,
                  background: i === page ? "rgba(99, 102, 241, 0.8)" : "rgba(255, 255, 255, 0.15)",
                }}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={() => setPage(page - 1)}
                className="btn-secondary flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            <button
              onClick={() => isLast ? (setPage(0), onClose()) : setPage(page + 1)}
              className="btn-primary flex items-center gap-1 rounded-xl px-4 py-1.5 text-xs"
            >
              {isLast ? "Got it!" : (
                <>
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
