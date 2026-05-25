import { useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { VoicePlayer } from "../components/VoicePlayer";

/** Truncate an email or wallet for display */
function truncateSender(name: string) {
  if (name.includes("@") && name.length > 24) {
    const [local, domain] = name.split("@");
    return `${local.slice(0, 8)}...@${domain}`;
  }
  if (name.startsWith("0x") && name.length > 16) {
    return `${name.slice(0, 8)}...${name.slice(-6)}`;
  }
  return name;
}

export default function Claim() {
  const { token } = useParams<{ token: string }>();
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const upsertUser = useMutation(api.users.upsertUser);
  const { createWallet } = useCreateWallet();

  // DB user record is the source of truth for wallet address
  const dbUser = useQuery(
    api.users.getByPrivyId,
    user?.id ? { privyId: user.id, email: user.email?.address } : "skip",
  );

  // Resolve local Privy wallet as fallback for first-time users
  const privyWallet = wallets.find((w) => w.walletClientType === "privy");
  const anyWallet = privyWallet ?? wallets[0];
  const localWalletAddress =
    anyWallet?.address ??
    (user?.linkedAccounts?.find(
      (a): a is Extract<typeof a, { type: "wallet" }> => a.type === "wallet",
    ) as { address?: string } | undefined)?.address;

  // Prefer DB wallet (consistent across devices), fall back to local Privy wallet
  const walletAddress = dbUser?.walletAddress ?? localWalletAddress;

  // Upsert user record whenever auth or wallet changes
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    void upsertUser({
      privyId: user.id,
      walletAddress: walletAddress ?? undefined,
      email: user.email?.address,
    });
  }, [ready, authenticated, user, walletAddress, upsertUser]);

  // Create embedded wallet only for first-time users (no wallet in DB or locally)
  const creatingWalletRef = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || dbUser === undefined) return;
    if (dbUser?.walletAddress || localWalletAddress) return;
    if (creatingWalletRef.current) return;
    creatingWalletRef.current = true;
    createWallet().catch((err) => {
      console.warn("Embedded wallet creation failed:", err);
      creatingWalletRef.current = false; // allow retry on failure
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, dbUser, localWalletAddress]);

  const claim = useQuery(
    api.claims.getByToken,
    token ? { token } : "skip",
  );

  const markClaimed = useMutation(api.claims.markClaimed);
  const markedRef = useRef(false);

  useEffect(() => {
    if (authenticated && token && claim && !claim.claimed && !markedRef.current) {
      markedRef.current = true;
      void markClaimed({ token });
    }
  }, [authenticated, token, claim, markClaimed]);

  // Auto-play voice message
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef(false);
  useEffect(() => {
    if (claim?.voiceMessageUrl && authenticated && !hasPlayedRef.current) {
      hasPlayedRef.current = true;
      const audio = new Audio(claim.voiceMessageUrl);
      audioRef.current = audio;
      audio.play().catch(() => {});
    }
  }, [claim?.voiceMessageUrl, authenticated]);

  // ── Error / loading states ──
  if (!token) {
    return <CenteredMessage>Invalid claim link.</CenteredMessage>;
  }
  if (claim === undefined) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (claim === null) {
    return <CenteredMessage>This claim link is invalid or expired.</CenteredMessage>;
  }

  const displaySender = truncateSender(claim.senderName);
  const tokenSymbol = claim.cryptoToken ?? "Unknown";

  // ── Not authenticated ──
  if (!authenticated) {
    return (
      <ClaimShell>
        {/* Hero icon */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-glow">
              <path d="M12 2v6m0 0l3-3m-3 3L9 5" />
              <rect x="3" y="10" width="18" height="12" rx="2" />
              <path d="M12 14v4" />
              <circle cx="12" cy="14" r="1" fill="currentColor" />
            </svg>
          </div>
        </div>

        <div>
          <p className="text-sm text-white/45">You've received</p>
          <div className="mt-1 text-4xl font-bold tracking-tight">
            {claim.amountUsdc.toLocaleString()} <span className="text-primary-glow">{tokenSymbol}</span>
          </div>
          <p className="mt-2 text-sm text-white/50">
            from <span className="font-medium text-white/70">{displaySender}</span>
          </p>
        </div>

        {claim.voiceMessageId && (
          <div className="glass-card flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm">
              🎙
            </div>
            <div className="text-sm text-white/50">
              A voice message is waiting for you
            </div>
          </div>
        )}

        <button
          onClick={login}
          disabled={!ready}
          className="btn-primary w-full rounded-2xl px-6 py-3.5 text-base font-semibold"
        >
          {ready ? "Sign in to claim" : "Loading…"}
        </button>

        <p className="text-[11px] text-white/25 leading-relaxed">
          Sign in with your email to receive funds directly to your wallet on Morph.
        </p>
      </ClaimShell>
    );
  }

  // ── Authenticated — claimed state ──
  return (
    <ClaimShell>
      {/* Success indicator */}
      <div className="flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-glow">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <div>
        <p className="text-sm text-white/45">
          <span className="font-medium text-white/65">{displaySender}</span> sent you
        </p>
        <div className="mt-1 text-4xl font-bold tracking-tight">
          {claim.amountUsdc.toLocaleString()} <span className="text-primary-glow">{tokenSymbol}</span>
        </div>
      </div>

      {/* Voice message */}
      {claim.voiceMessageUrl && (
        <div className="glass-card space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span>🎙</span>
            <span>Voice message from {displaySender}</span>
          </div>
          <VoicePlayer url={claim.voiceMessageUrl} />
        </div>
      )}

      {/* CTA to enter the app */}
      <Link
        to="/app"
        className="btn-primary w-full rounded-2xl px-6 py-3.5 text-base font-semibold"
      >
        Open Echo
      </Link>
      <p className="text-[11px] text-white/25 leading-relaxed">
        Send money with your voice — set up rules, track activity, and more.
      </p>
    </ClaimShell>
  );
}

/** Shared layout wrapper */
function ClaimShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-5 text-center">
        {children}
      </div>
      <footer className="mt-10 text-center">
        <p className="text-[11px] text-white/20">
          Powered by <span className="font-semibold text-white/30">Echo</span> — voice-first remittance on Morph
        </p>
      </footer>
    </div>
  );
}

/** Simple centered text for loading/error states */
function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <p className="text-sm text-white/50">{children}</p>
    </div>
  );
}
