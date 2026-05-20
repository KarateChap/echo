import { useState, useRef, useCallback } from "react";
import { useStreamingAudio } from "./useStreamingAudio";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ChatResponse {
  type: "answer" | "payment_intent" | "withdraw" | "exit";
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
  onWithdraw: () => void;
  onExit: () => void;
  onTtsStart: (audioEl: HTMLAudioElement) => void;
  onTtsEnd: () => void;
  /** Call before audio.play() on iOS to force speaker routing */
  forceSpeakerRoute?: () => Promise<void>;
}

export function useConversationAgent({
  convexSiteUrl,
  privyId,
  voiceGender,
  onPaymentIntent,
  onWithdraw,
  onExit,
  onTtsStart,
  onTtsEnd,
  forceSpeakerRoute,
}: UseConversationAgentOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [lastResponse, setLastResponse] = useState<string>("");
  const cancelledRef = useRef(false);

  const { playStream, stop: stopStreamAudio } = useStreamingAudio({
    onStart: (audio) => {
      setIsPlayingTts(true);
      onTtsStart(audio);
    },
    onEnd: () => {
      setIsPlayingTts(false);
      onTtsEnd();
    },
    forceSpeakerRoute,
  });

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
        await playStream(res);
      } catch {
        setIsPlayingTts(false);
        onTtsEnd();
      }
    },
    [convexSiteUrl, voiceGender, onTtsEnd, playStream],
  );

  const sendMessage = useCallback(
    async (transcript: string, balanceSummary?: string) => {
      if (!transcript.trim() || !convexSiteUrl || !privyId) return;

      // Client-side shortcut: detect withdraw/cash-out keywords instantly
      const lower = transcript.trim().toLowerCase();
      if (/\b(withdraw|cash\s*out|cashout|mag-?withdraw|i-?withdraw|encash|ilabas)\b/.test(lower)) {
        onWithdraw();
        return;
      }

      const userMsg: ChatMessage = { role: "user", text: transcript.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setIsProcessing(true);

      try {
        // Use the streaming chat endpoint for lower latency
        const res = await fetch(`${convexSiteUrl}/api/chat-stream`, {
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
          onPaymentIntent(data.intent, data.intent.token, data.text);
          return;
        }

        if (data.type === "withdraw") {
          onWithdraw();
          return;
        }

        const assistantMsg: ChatMessage = { role: "assistant", text: data.text };
        setMessages((prev) => [...prev, assistantMsg]);
        setLastResponse(data.text);

        if (data.type === "exit") {
          await playTts(data.text);
          onExit();
          return;
        }

        // Regular answer — play streaming TTS
        await playTts(data.text);
      } catch {
        setIsProcessing(false);
        setLastResponse("Sorry, may error. Try mo ulit.");
        await playTts("Sorry, may error. Try mo ulit.");
      }
    },
    [convexSiteUrl, privyId, playTts, onPaymentIntent, onWithdraw, onExit],
  );

  const stopTts = useCallback(() => {
    stopStreamAudio();
    setIsPlayingTts(false);
    onTtsEnd();
  }, [onTtsEnd, stopStreamAudio]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    stopStreamAudio();
    setMessages([]);
    setIsProcessing(false);
    setIsPlayingTts(false);
    setLastResponse("");
    setTimeout(() => { cancelledRef.current = false; }, 0);
  }, [stopStreamAudio]);

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
