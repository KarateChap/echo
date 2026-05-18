import { useState, useMemo } from "react";
import { useTokenMetadata, type TokenMetadata } from "@/lib/useTokenMetadata";
import { BUILTIN_TOKENS } from "@/lib/tokens";
import TokenIcon, { randomIconKey } from "@/components/TokenIcon";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (meta: TokenMetadata & { address: string; icon: string }) => Promise<void>;
  existingAddresses?: string[];
}

export default function AddTokenModal({ open, onClose, onAdd, existingAddresses = [] }: Props) {
  const [address, setAddress] = useState("");
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { fetchMetadata, loading, error } = useTokenMetadata();
  const iconKey = useMemo(() => randomIconKey(), []);

  if (!open) return null;

  function checkDuplicate(addr: string): string | null {
    const lower = addr.toLowerCase();
    const builtinMatch = BUILTIN_TOKENS.find(
      (t) => typeof t.address === "string" && t.address.toLowerCase() === lower,
    );
    if (builtinMatch) {
      return `${builtinMatch.symbol} is already a built-in token.`;
    }
    if (existingAddresses.some((a) => a.toLowerCase() === lower)) {
      return "This token has already been added to your wallet.";
    }
    return null;
  }

  async function handleLookup() {
    setAddError(null);
    const dupeMsg = checkDuplicate(address.trim());
    if (dupeMsg) {
      setAddError(dupeMsg);
      return;
    }
    const meta = await fetchMetadata(address.trim());
    if (meta) setMetadata(meta);
  }

  async function handleAdd() {
    if (!metadata) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAdd({ ...metadata, address: address.trim(), icon: iconKey });
      setAddress("");
      setMetadata(null);
      onClose();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.toLowerCase().includes("already")) {
        setAddError("This token has already been added to your wallet.");
      } else {
        setAddError(msg || "Failed to add token.");
      }
    } finally {
      setAdding(false);
    }
  }

  function handleClose() {
    setAddress("");
    setMetadata(null);
    setAddError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6" onClick={handleClose}>
      <div className="glass-card w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Add custom token</h2>
        <p className="text-xs text-white/40">Paste an ERC-20 contract address on Morph Hoodi. We'll auto-detect the name, symbol, and decimals.</p>

        <div className="space-y-2">
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setMetadata(null); setAddError(null); }}
            placeholder="0x..."
            className="glass-input font-mono text-xs"
          />

          {!metadata && (
            <button
              onClick={handleLookup}
              disabled={loading || address.length < 42}
              className="btn-primary w-full"
            >
              {loading ? "Looking up…" : "Look up token"}
            </button>
          )}

          {(error || addError) && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/[0.06] px-3 py-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-xs text-red-400">{addError || error}</span>
            </div>
          )}
        </div>

        {metadata && (
          <div className="space-y-3">
            <div className="glass-card flex items-center gap-3 p-3">
              <TokenIcon icon={iconKey} size={28} />
              <div>
                <div className="text-sm font-semibold">{metadata.symbol}</div>
                <div className="text-[11px] text-white/40">{metadata.name}</div>
                <div className="text-[10px] text-white/30">{metadata.decimals} decimals</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleAdd} disabled={adding} className="btn-primary flex-1">
                {adding ? "Adding…" : "Add token"}
              </button>
              <button onClick={handleClose} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        )}

        {!metadata && (
          <button onClick={handleClose} className="btn-secondary w-full">Cancel</button>
        )}
      </div>
    </div>
  );
}
