import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && authenticated) navigate("/app", { replace: true });
  }, [ready, authenticated, navigate]);

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Echo</h1>
        <p className="text-balance text-base opacity-70">
          Voice-first remittance. Send love home — not just money.
        </p>
        <button
          onClick={login}
          disabled={!ready}
          className="w-full rounded-2xl bg-primary px-6 py-3 font-medium text-white disabled:opacity-40"
        >
          {ready ? "Sign in with email" : "Loading…"}
        </button>
      </div>
    </div>
  );
}
