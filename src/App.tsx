import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import Landing from "@/pages/Landing";
import VoiceHome from "@/pages/VoiceHome";
import Rules from "@/pages/Rules";
import Activity from "@/pages/Activity";
import Claim from "@/pages/Claim";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const upsertUser = useMutation(api.users.upsertUser);
  const wallet = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    if (!ready || !authenticated || !user || !wallet) return;
    void upsertUser({
      privyId: user.id,
      walletAddress: wallet.address,
      email: user.email?.address,
    });
  }, [ready, authenticated, user, wallet, upsertUser]);

  if (!ready) return <div className="grid h-full place-items-center text-sm opacity-60">Loading…</div>;
  if (!authenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<RequireAuth><VoiceHome /></RequireAuth>} />
      <Route path="/app/rules" element={<RequireAuth><Rules /></RequireAuth>} />
      <Route path="/app/activity" element={<RequireAuth><Activity /></RequireAuth>} />
      <Route path="/claim/:token" element={<Claim />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
