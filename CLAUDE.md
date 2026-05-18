# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Echo is a voice-first remittance app built for the Morph hackathon. Users speak Taglish instructions (e.g., "Send mama 10k pesos every first of the month") which are transcribed, parsed into structured intents, and executed as USDC transfers on Morph testnet. The detailed build plan lives in `PLAN.md`.

## Tech Stack

- **Frontend:** Vite + React + TypeScript (strict mode) + Tailwind CSS + shadcn/ui
- **Backend:** Convex (database, server actions, cron jobs, file storage, real-time subscriptions)
- **Auth & Wallet:** Privy (email/phone login) → Morph smart wallet provisioning
- **Voice Pipeline:** Whisper (STT) → Claude (intent parsing) → ElevenLabs (TTS readback)
- **On-chain:** Morph testnet, USDC ERC-20 transfers
- **Agent Authorization:** ZeroDev ERC-4337 session keys (primary), direct EOA signing (fallback)
- **Notifications:** Resend (email) + Twilio (SMS)
- **Hosting:** Vercel (SPA)

## Build & Dev Commands

```bash
npm install              # install dependencies
npx convex dev           # start Convex dev server (must be running alongside frontend)
npm run dev              # start Vite dev server
npm run build            # production build
npm run lint             # lint
```

## Architecture

### Frontend Routes (React Router)

- `/` — landing page with login CTA
- `/app` — voice home (mic button, transcript, confirmation flow)
- `/app/rules` — list of active/paused rules with session-key status
- `/app/activity` — reactive transaction feed with voice message playback
- `/claim/:token` — recipient claim flow (Privy signup, wallet provision, balance + voice message)

### Convex Schema (core tables)

- `users` — Privy-synced user records with wallet addresses
- `recipients` — recipient contact info (name, email, phone)
- `rules` — voice-created automation rules (recurring, conditional, one-shot) with schedule/condition config
- `voiceMessages` — audio blobs attached to rules, played on claim
- `transactions` — on-chain tx records (txHash, status, rule linkage)
- `sessionKeys` — ZeroDev session key metadata (scope, expiry)
- `voiceSessions` — transient rows tracking transcript + parsed intent during voice capture flow

### Key Convex Actions

- `transcribeAudio(sessionId)` — blob → Whisper → transcript
- `parseIntent(sessionId)` — transcript → Claude → structured JSON intent
- `synthesizeSpeech(text)` — text → ElevenLabs → mp3 readback
- `executePayment(ruleId)` — builds and submits USDC transfer userOp via ZeroDev/Pimlico (or EOA fallback)
- `notifyRecipient` — sends claim link via Resend email + Twilio SMS

### Convex Crons

- `tickScheduledRules` (every 1 min) — fires due recurring/one-shot rules
- `tickConditionalRules` (every 5 min) — checks recipient balances, fires top-ups

### Intent Schema

```ts
{
  kind: "recurring" | "conditional" | "oneShot";
  recipient: { name: string; hint: string };
  amountUsdc: number;
  schedule?: { kind: "monthly" | "weekly" | "cron"; value: string };
  condition?: { walletBelowUsdc: number; topUpUsdc: number };
}
```

## Design Constraints

- **Mobile-first** at 380px breakpoint.
- **Taglish-aware** — system prompts for intent parsing include Taglish worked examples.
- **Editable transcript** — users can fix Whisper errors before intent parsing.
- **Out of scope:** fiat off-ramp, FX, KYC, multi-sender pools, native mobile app, custom smart contracts.
