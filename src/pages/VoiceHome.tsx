import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import type { Id } from "../../convex/_generated/dataModel";

export default function VoiceHome() {
  const { user, logout } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy");

  const generateUploadUrl = useMutation(api.voiceSessions.generateUploadUrl);
  const createSession = useMutation(api.voiceSessions.create);

  const { status, error, elapsedMs, startRecording, stopRecording } = useVoiceRecorder();
  const [sessionId, setSessionId] = useState<Id<"voiceSessions"> | null>(null);
  const [uploadingState, setUploadingState] = useState<"idle" | "uploading" | "uploaded" | "failed">("idle");

  const isRecording = status === "recording";
  const isBusy = status === "requesting" || status === "stopping" || uploadingState === "uploading";

  async function handleMicClick() {
    if (!user) return;
    if (isRecording) {
      const blob = await stopRecording();
      if (!blob) return;
      try {
        setUploadingState("uploading");
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        });
        if (!result.ok) throw new Error(`Upload failed: ${result.status}`);
        const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
        const id = await createSession({ privyId: user.id, audioStorageId: storageId });
        setSessionId(id);
        setUploadingState("uploaded");
      } catch (e) {
        console.error(e);
        setUploadingState("failed");
      }
    } else {
      setSessionId(null);
      setUploadingState("idle");
      await startRecording();
    }
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const remaining = Math.max(0, 30 - seconds);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Echo</h1>
        <button onClick={logout} className="text-xs opacity-50 hover:opacity-100">
          Sign out
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <button
          onClick={handleMicClick}
          disabled={isBusy}
          className={[
            "grid h-32 w-32 place-items-center rounded-full text-4xl text-white transition",
            isRecording
              ? "bg-accent animate-pulse"
              : "bg-primary hover:scale-105",
            isBusy ? "opacity-50" : "",
          ].join(" ")}
        >
          {status === "requesting" ? "…" : isRecording ? "⏹" : "🎙"}
        </button>

        <div className="h-6 text-center text-sm">
          {status === "requesting" && <span className="opacity-60">Asking for mic…</span>}
          {isRecording && (
            <span className={remaining <= 5 ? "text-accent" : "opacity-80"}>
              Recording — {seconds}s {remaining <= 5 ? `(${remaining}s left)` : ""}
            </span>
          )}
          {!isRecording && uploadingState === "uploading" && <span className="opacity-60">Uploading…</span>}
          {!isRecording && uploadingState === "uploaded" && (
            <span className="opacity-80">Uploaded — session {sessionId?.slice(-6)}</span>
          )}
          {!isRecording && uploadingState === "failed" && (
            <span className="text-red-400">Upload failed. Tap to retry.</span>
          )}
          {!isRecording && uploadingState === "idle" && status === "idle" && (
            <span className="opacity-60">Tap and tell Echo what to send</span>
          )}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      </main>

      <footer className="space-y-2 text-xs opacity-60">
        <div className="font-mono text-[10px]">
          Wallet: {wallet?.address ?? "provisioning…"}
        </div>
        <div className="font-mono text-[10px]">
          User: {user?.email?.address ?? "—"}
        </div>
        <nav className="flex gap-4 pt-2 text-sm opacity-100">
          <Link to="/app/rules">Rules</Link>
          <Link to="/app/activity">Activity</Link>
        </nav>
      </footer>
    </div>
  );
}
