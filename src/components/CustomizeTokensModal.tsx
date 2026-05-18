import { useState } from "react";
import type { Token } from "@/lib/tokens";
import TokenIcon from "@/components/TokenIcon";

interface Props {
  open: boolean;
  onClose: () => void;
  visibleTokens: Token[];
  hiddenTokens: Token[];
  maxVisible: number;
  onHide: (token: Token) => void;
  onShow: (token: Token) => void;
  onDeleteToken?: (token: Token) => void;
}

export default function CustomizeTokensModal({
  open,
  onClose,
  visibleTokens,
  hiddenTokens,
  maxVisible,
  onHide,
  onShow,
  onDeleteToken,
}: Props) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const isFull = visibleTokens.length >= maxVisible;

  function moveToHidden(token: Token) {
    setErrorMsg(null);
    onHide(token);
  }

  function moveToVisible(token: Token) {
    if (isFull) {
      setErrorMsg("Remove a visible token first to make room.");
      setTimeout(() => setErrorMsg(null), 2000);
      return;
    }
    setErrorMsg(null);
    onShow(token);
  }

  function handleDelete(token: Token, e: React.MouseEvent) {
    e.stopPropagation();
    onDeleteToken?.(token);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-sm space-y-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Customize Tokens</h2>
          <button onClick={onClose} className="btn-primary px-4 py-1.5 text-xs">
            Done
          </button>
        </div>

        <p className="text-[11px] text-white/35">
          Tap a visible token to hide it, or a hidden token to show it.
        </p>

        {/* Error message */}
        {errorMsg && (
          <div className="rounded-lg bg-red-500/10 border border-red-400/20 px-3 py-2 text-center text-[11px] text-red-400 animate-[shake_0.3s_ease-in-out]">
            {errorMsg}
          </div>
        )}

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-3" style={{ maxHeight: "60vh" }}>
          {/* Visible column */}
          <div className="flex flex-col min-h-0">
            <div className="mb-2 text-[11px] font-medium text-white/50">
              Visible ({visibleTokens.length}/{maxVisible})
            </div>
            <div className="space-y-1.5 overflow-y-auto overscroll-contain pr-1 pb-2 scrollbar-thin scroll-fade">
              {visibleTokens.map((token) => (
                <button
                  key={token.symbol + token.address}
                  onClick={() => moveToHidden(token)}
                  className="flex w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-left transition-all hover:bg-primary/[0.12] active:scale-[0.97]"
                >
                  <TokenIcon icon={token.icon} size={18} className="text-base" />
                  <span className="flex-1 text-xs font-medium">{token.symbol}</span>
                  <svg className="h-3 w-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
                  </svg>
                </button>
              ))}
              {visibleTokens.length === 0 && (
                <div className="py-4 text-center text-[11px] text-white/20">No tokens visible</div>
              )}
            </div>
          </div>

          {/* Hidden column */}
          <div className="flex flex-col min-h-0">
            <div className="mb-2 text-[11px] font-medium text-white/50">
              Hidden ({hiddenTokens.length})
            </div>
            <div className="space-y-1.5 overflow-y-auto overscroll-contain pr-1 pb-2 scrollbar-thin scroll-fade">
              {hiddenTokens.map((token) => (
                <div
                  key={token.symbol + token.address}
                  className="flex w-full items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-all"
                >
                  <button
                    onClick={() => moveToVisible(token)}
                    className={[
                      "flex flex-1 items-center gap-2 text-left transition-all",
                      isFull ? "opacity-40" : "hover:opacity-80 active:scale-[0.97]",
                    ].join(" ")}
                  >
                    <TokenIcon icon={token.icon} size={18} className="text-base" />
                    <span className="flex-1 text-xs font-medium text-white/60">{token.symbol}</span>
                    <svg className="h-3 w-3 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15m0 0l6.75 6.75M4.5 12l6.75-6.75" />
                    </svg>
                  </button>
                  {/* Delete button for custom tokens */}
                  {token.isCustom && onDeleteToken && (
                    <button
                      onClick={(e) => handleDelete(token, e)}
                      className="ml-1 rounded-md p-1 text-white/15 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      title={`Delete ${token.symbol}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              {hiddenTokens.length === 0 && (
                <div className="py-4 text-center text-[11px] text-white/20">All tokens visible</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
