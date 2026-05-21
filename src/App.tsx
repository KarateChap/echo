import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import Landing from "@/pages/Landing";
import VoiceHome from "@/pages/VoiceHome";
import Rules from "@/pages/Rules";
import Activity from "@/pages/Activity";
import Recipients from "@/pages/Recipients";
import Claim from "@/pages/Claim";
import TransactionNotifier from "@/components/TransactionNotifier";
import ParticleWaveBackground from "@/components/ParticleWaveBackground";
import ErrorBoundary from "@/components/ErrorBoundary";
import { AudioLevelProvider } from "@/lib/AudioLevelContext";

function DesktopDisclaimer() {
  const [open, setOpen] = useState(() => {
    return !sessionStorage.getItem("echo_desktop_disclaimer_seen");
  });

  if (!open) return null;

  const dismiss = () => {
    sessionStorage.setItem("echo_desktop_disclaimer_seen", "1");
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card mx-4 max-w-sm space-y-4 p-6 text-center">
        <div className="text-3xl">🖥️</div>
        <h2 className="text-lg font-semibold text-white">
          Optimized for Desktop
        </h2>
        <p className="text-sm leading-relaxed text-white/70">
          Echo is currently optimized for <span className="text-white font-medium">desktop browsers</span>.
          Mobile browser support is still in progress and may not work as expected.
          For the best experience, please use a desktop browser.
        </p>
        <button
          onClick={dismiss}
          className="mt-2 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
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
  // dbUser === undefined means still loading; dbUser === null means no record yet
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

  if (!ready) return <div className="grid h-full place-items-center text-sm opacity-60">Loading…</div>;
  if (!authenticated) return <Navigate to="/" replace />;
  return (
    <ErrorBoundary>
      <AudioLevelProvider>
        <ParticleWaveBackground />
        <DesktopDisclaimer />
        <div className="relative z-10 h-full">
          <TransactionNotifier />
          {children}
        </div>
      </AudioLevelProvider>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<RequireAuth><VoiceHome /></RequireAuth>} />
      <Route path="/app/rules" element={<RequireAuth><Rules /></RequireAuth>} />
      <Route path="/app/activity" element={<RequireAuth><Activity /></RequireAuth>} />
      <Route path="/app/recipients" element={<RequireAuth><Recipients /></RequireAuth>} />
      <Route path="/claim/:token" element={<Claim />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
