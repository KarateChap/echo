import { useState, useRef, useCallback } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ChatResponse {
  type: "answer" | "payment_intent" | "exit";
  text: string;
  intent?: any;
  chatSessionId?: string;
  voiceGender?: "male" | "female";
}

interface UseConversationAgentOptions {
  convexSiteUrl: string;
  privyId: string;
  voiceGender: "male" | "female";
  onPaymentIntent: (intent: any, token?: string, readbackText?: string) => void;
  onExit: () => void;
  onTtsStart: (audioEl: HTMLAudioElement) => void;
  onTtsEnd: () => void;
}

export function useConversationAgent({
  convexSiteUrl,
  privyId,
  voiceGender,
  onPaymentIntent,
  onExit,
  onTtsStart,
  onTtsEnd,
}: UseConversationAgentOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [lastResponse, setLastResponse] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);

  const playTts = useCallback(
    async (text: string) => {
      if (!convexSiteUrl || cancelledRef.current) return;
      setIsPlayingTts(true);
      try {
        const res = await fetch(`${convexSiteUrl}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: voiceGender }),
        });
        if (!res.ok || cancelledRef.current) {
          setIsPlayingTts(false);
          onTtsEnd();
          return;
        }
        const blob = await res.blob();
        if (cancelledRef.current) {
          setIsPlayingTts(false);
          onTtsEnd();
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audioRef.current = audio;
        onTtsStart(audio);

        audio.addEventListener("ended", () => {
          setIsPlayingTts(false);
          audioRef.current = null;
          onTtsEnd();
          URL.revokeObjectURL(blobUrl);
        });
        audio.addEventListener("error", () => {
          setIsPlayingTts(false);
          audioRef.current = null;
          onTtsEnd();
          URL.revokeObjectURL(blobUrl);
        });

        audio.play().catch(() => {
          setIsPlayingTts(false);
          audioRef.current = null;
          onTtsEnd();
        });
      } catch {
        setIsPlayingTts(false);
        onTtsEnd();
      }
    },
    [convexSiteUrl, voiceGender, onTtsStart, onTtsEnd],
  );

  const sendMessage = useCallback(
    async (transcript: string, balanceSummary?: string) => {
      if (!transcript.trim() || !convexSiteUrl || !privyId) return;

      const userMsg: ChatMessage = { role: "user", text: transcript.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setIsProcessing(true);

      try {
        const res = await fetch(`${convexSiteUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            privyId,
            message: transcript.trim(),
            balanceSummary,
          }),
        });

        const data: ChatResponse = await res.json();
        setIsProcessing(false);

        if (data.type === "payment_intent" && data.intent) {
          // Hand off to payment flow immediately — the confirm view handles its own TTS
          onPaymentIntent(data.intent, data.intent.token, data.text);
          return;
        }

        // Only add to message history for non-payment responses
        const assistantMsg: ChatMessage = { role: "assistant", text: data.text };
        setMessages((prev) => [...prev, assistantMsg]);
        setLastResponse(data.text);

        if (data.type === "exit") {
          await playTts(data.text);
          onExit();
          return;
        }

        // Regular answer — play TTS, then caller resumes listening
        await playTts(data.text);
      } catch {
        setIsProcessing(false);
        setLastResponse("Sorry, may error. Try mo ulit.");
        await playTts("Sorry, may error. Try mo ulit.");
      }
    },
    [convexSiteUrl, privyId, playTts, onPaymentIntent, onExit],
  );

  const stopTts = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsPlayingTts(false);
    onTtsEnd();
  }, [onTtsEnd]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setMessages([]);
    setIsProcessing(false);
    setIsPlayingTts(false);
    setLastResponse("");
    // Reset cancelled flag for next use
    setTimeout(() => { cancelledRef.current = false; }, 0);
  }, []);

  return {
    messages,
    isProcessing,
    isPlayingTts,
    lastResponse,
    sendMessage,
    stopTts,
    reset,
  };
}
