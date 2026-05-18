# Echo — Build Plan

Voice-first remittance on Morph. Spec is in `echo-spec.pdf`. This is the
working step-by-step plan. Each step ends in a verifiable state. We move
through it continuously — no day boundaries.

---

## Domain

- **Root:** `pay-echo.space` (purchased at Namecheap).
- **DNS:** stays at Namecheap (no Route53 delegation). All DNS records added manually in Namecheap's Advanced DNS UI.
- **App:** `app.pay-echo.space` → CloudFront → S3.
- **Email sender:** `noreply@pay-echo.space` via Resend.
- **Recipient claim:** lives at `app.pay-echo.space/claim/:token` (no separate subdomain in MVP).

### DNS records we'll add to Namecheap (during step 1)

| Type | Host | Value | Purpose |
|---|---|---|---|
| CNAME | `app` | `<CloudFront distribution domain>.cloudfront.net` | Serve the SPA |
| CNAME | `_xxx.app` | `_yyy.acm-validations.aws` | ACM cert validation (TLS for app.pay-echo.space) |
| TXT | `@` | `v=spf1 include:_spf.resend.com ~all` | Resend SPF |
| CNAME / TXT | (Resend-provided) | (Resend-provided) | Resend DKIM + DMARC |

## Decisions locked in

- **Frontend:** Vite + React + TS + Tailwind + shadcn/ui. Mobile-first at 380px.
- **Backend:** Convex (DB, actions, cron, file storage, reactivity).
- **Auth/wallet:** Privy → Morph smart wallet.
- **STT / TTS / LLM:** Whisper (OpenAI), ElevenLabs (TTS), GPT-4o-mini (OpenAI) for intent parsing. Single LLM provider to reduce surface area. Swap-in Claude is a 10-minute change if Taglish accuracy disappoints during testing.
- **Chain:** Morph Hoodi Testnet (chain ID **2910**, RPC `https://rpc-hoodi.morph.network`, explorer `https://explorer-hoodi.morph.network`, currency ETH).
- **Settlement token:** L2 USDC on Morph Hoodi, contract `0x1178341838B764dCfFA5BCEAb1d41443Fd71a227`, **6 decimals**. All transfers happen entirely on L2 — no bridging in the MVP.
- **Agent authorization: EIP-7702 delegation (Morph-native).** User signs ONE
  EIP-7702 authorization on rule creation. Their EOA temporarily delegates
  execution to a small "Echo delegator" contract that enforces:
  - per-recipient allowance
  - max spend per cycle
  - expiry timestamp
  - revocability (`revokeDelegation()`)
  Our Convex backend holds a server-side **agent key** that signs the
  USDC-transfer txs; the user's account routes them through the delegator,
  which reverts anything out of scope. **No ERC-4337, no bundler, no
  ZeroDev/Biconomy/Pimlico dependencies.** Reason for picking 7702: every
  ERC-4337 bundler we checked (ZeroDev, Pimlico) refuses Morph Hoodi
  (chain 2910); Biconomy only supports it via their legacy V2 stack. Morph
  natively shipped EIP-7702 in their Viridian upgrade — it's the on-thesis
  path for this chain.
- **Delegator contract:** look for an existing reference (Morph publishes one,
  or use a community standard like MetaMask's stateless delegator) before
  writing our own. If we write our own, target ~100 lines of Solidity,
  deployed via Foundry. Verified on Morph Hoodi block explorer for trust.
- **Agent authorization (fallback if 7702 tooling bites us):** Direct EOA
  signing from a Convex action, limits enforced in code rather than on-chain.
  Same UX, weaker security story. We pivot only if 7702 deployment
  consumes more than one focused day.
- **Out of scope (do not build):** fiat off-ramp, FX, KYC, multi-sender pools,
  native mobile app, custom smart contracts beyond what ZeroDev gives us.

## Open items

- Hackathon exact submission cutoff (date + time + tz).
- Two phones available for recipient-side demo? (Spec assumes yes.)
- Re-enable Privy **HttpOnly cookies** once `app.pay-echo.space` is live. App domain to enter: `pay-echo.space`.
- Add `https://app.pay-echo.space` to Privy **Allowed origins** once CloudFront is live.

---

## Step-by-step build

### 0. Accounts, keys, repo

- [ ] Create GitHub repo, init `main`, commit `.gitignore` and `.env.example`.
- [ ] Convex project — save deploy key.
- [ ] Privy app — app ID + secret, **email-only** login enabled, external wallets off, auto-create embedded wallets on.
- [ ] **Privy: disable Smart wallets feature** (turn off the toggle we previously enabled with Kernel/Morph custom chain). We don't need a smart-wallet contract — EIP-7702 lets the embedded EOA itself act with delegation. The Privy smart-wallet config was set up under the old ZeroDev plan; remove it.
- [ ] OpenAI API key (Whisper for STT + GPT-4o-mini for intent parsing).
- [ ] ElevenLabs API key + voice IDs (primary: **Hope**, secondary: **Mark**). Model: Eleven v3 (multilingual, handles Tagalog).
- [ ] ~~ZeroDev~~ — dropped. EIP-7702 path doesn't need ERC-4337 tooling.
- [ ] ~~Pimlico~~ — dropped. No bundler needed for 7702.
- [ ] Foundry installed locally (`curl -L https://foundry.paradigm.xyz | bash && foundryup`) — for compiling/deploying the delegator contract.
- [ ] Find or write the **Echo delegator** Solidity contract. Search order: (1) `github.com/morph-l2` for reference, (2) MetaMask's stateless delegator EIP-7702 reference, (3) write our own (~100 lines).
- [ ] Generate a dedicated **agent EOA** wallet (server-side key for Convex to sign payment txs). Save private key as `AGENT_PRIVATE_KEY` in Convex env vars only. Fund with ~0.05 Morph Hoodi ETH for gas.
- [ ] Morph Hoodi Testnet: chain ID **2910**, RPC `https://rpc-hoodi.morph.network`, explorer `https://explorer-hoodi.morph.network`. USDC contract `0x1178341838B764dCfFA5BCEAb1d41443Fd71a227` (6 decimals). Fund dev wallet from `morph-rails-hoodi.morph.network/faucet` (0.01 ETH + 10 USDC per claim).
- [ ] Resend (or sandbox sender) for claim emails — the **only** notification channel.
- [ ] AWS account + IAM user for Terraform (access key + secret).
- [ ] Terraform installed locally; `terraform/` directory in repo.
- [ ] S3 bucket + CloudFront distribution + Route53 (if custom domain) provisioned via Terraform.
- [ ] GitHub Actions workflow: on push to `main`, `vite build` → `aws s3 sync dist/ s3://...` → CloudFront invalidation.

**State:** all keys in `.env.local` + Convex dashboard, placeholders in `.env.example`.

### 1. Frontend scaffold

- Vite + React + TS, strict mode on.
- Tailwind config, base theme, mobile-first.
- shadcn/ui base: button, card, dialog, input, toast, sheet, skeleton.
- Router: `/` (landing), `/app` (voice home), `/app/rules`, `/app/activity`, `/claim/:token`.
- Provision S3 bucket (static website hosting), CloudFront distribution, and (optional) Route53 record via Terraform in `terraform/`.
- CI: GitHub Actions runs `vite build` and `aws s3 sync dist/ s3://<bucket>` + CloudFront invalidation on push to `main`.
- SPA routing: configure CloudFront error responses (404/403 → `/index.html` with 200) so client-side routes work.

**State:** deployed empty app at the CloudFront URL (or custom domain).

### 2. Convex schema + auth sync

- Init Convex, define schema: `users`, `recipients`, `rules`, `voiceMessages`,
  `transactions`, `sessionKeys`, `voiceSessions` (transient transcript+intent rows).
- Privy SDK in frontend: email login only, smart-wallet provisioning on Morph testnet.
- On Privy auth, upsert into Convex `users` (`privyId`, `walletAddress`,
  `smartWalletAddress`, `displayName`).
- Landing screen: login CTA. Voice home: shows wallet address + empty state.

**State:** new email signs up → wallet provisioned → lands on dashboard → refresh persists.

### 3. Browser voice capture

- `MediaRecorder` hook: start/stop, mp3 encode, 30s soft cap, mic-permission UX.
- Voice home: big mic button (idle → recording → processing states).
- Upload blob to Convex file storage on stop; store row in `voiceSessions`.

**State:** record audio in the browser, see the blob land in Convex storage.

### 4. Whisper transcription (reactive)

- Convex action `transcribeAudio(sessionId)` → reads blob → Whisper → writes
  `transcript` back to the `voiceSessions` row.
- UI subscribes to the row; transcript appears live as it returns.
- Allow inline edit of the transcript before parsing (Whisper-error mitigation).

**State:** speak Taglish, see transcript on screen within a few seconds.

### 5. Intent parsing (Claude/GPT-4o)

- Convex action `parseIntent(sessionId)` with strict JSON schema:
  ```
  { kind: "recurring" | "conditional" | "oneShot",
    recipient: { name, hint },
    amountUsdc: number,
    schedule?: { kind: "monthly" | "weekly" | "cron", value: string },
    condition?: { walletBelowUsdc: number, topUpUsdc: number } }
  ```
- Taglish-aware system prompt with worked examples.
- Confirmation UI: parsed intent rendered as a card + transcript + edit button.

**State:** "Send mama 10k pesos every first of the month" → correct JSON on screen.

### 6. ElevenLabs readback

- Convex action `synthesizeSpeech(text)` → ElevenLabs → store mp3 in Convex
  file storage → return URL.
- Confirmation UI auto-plays the readback; Approve / Edit buttons below.

**State:** Echo says the intent back in a warm Filipino voice.

### 7. Voice message recording

- Reuse the recorder. Post-approval modal: "Want to leave a message for [recipient]?"
- Record → preview → save → re-record.
- Save to Convex file storage; row in `voiceMessages` linked to the (about-to-be-created) rule.

**State:** can attach a voice message to a rule before saving.

### 8. Delegator contract — deploy on Morph Hoodi

Before any rule can be created, the on-chain enforcement contract must exist.

- Write/borrow `EchoDelegator.sol`. Minimum surface:
  ```solidity
  function delegate(address agent, address recipient, uint256 maxAmount,
                   uint256 cycleSeconds, uint256 expiresAt) external;
  function executeTransfer(address recipient, uint256 amount) external;
  function revoke() external;
  ```
  Storage: `mapping(address user => mapping(address recipient => Permission))`.
  `executeTransfer` checks: caller is the authorized agent for this user,
  recipient matches, amount within remaining cycle budget, not expired.
  Reverts otherwise. On success: calls `USDC.transfer(recipient, amount)`
  using the user's account context (via EIP-7702 delegation).
- Deploy with Foundry. Save deployed address as `ECHO_DELEGATOR_ADDRESS`.
- Verify on `explorer-hoodi.morph.network` so users (and judges) can read source.

**State:** contract address on MorphScan with verified source code.

### 9. Rule creation + EIP-7702 authorization

- `createRule` mutation: takes intent + optional voiceMessageId, computes
  `nextRunAt`, writes `rules` row with `status: "pending"` (not active yet).
- Client builds an **EIP-7702 authorization**: user signs that their EOA may
  delegate to `ECHO_DELEGATOR_ADDRESS`. viem's `signAuthorization` API.
- Same transaction also calls `EchoDelegator.delegate(agentAddr, recipient, maxAmount, cycle, expiresAt)`
  to register the rule on-chain. Batched into a single EIP-7702 Type-4 tx
  signed by the user. After it confirms, rule flips to `status: "active"`.
- UI shows the exact boundaries in plain language *before* the user signs.

**State:** rule on-chain in `EchoDelegator`, status active, visible in `/app/rules`.

### 10. On-chain execution

- Convex action `executePayment(ruleId)`:
  - Loads rule from Convex.
  - Builds a tx: `EchoDelegator.executeTransfer(recipient, amount)` from the
    server-side **agent key** (which the delegator recognizes for this user).
  - Sends via Morph Hoodi RPC. No bundler.
  - Writes `transactions` row with txHash + status.
- The delegator contract revert-checks everything on-chain; our Convex code
  just trusts the contract result.
- Manual test trigger: button on a rule that calls `executePayment` directly.

**State:** click "fire now" → on-chain tx → USDC moves → MorphScan link works.

#### 10b. Fallback: limits enforced in Convex code only (if 7702 tooling stalls)

- Skip steps 8 and 9's on-chain delegation entirely.
- Convex action holds the agent key; signs `USDC.transfer(recipient, amount)`
  directly, enforces rule scope (amount, recipient, expiry, cooldown) in
  TypeScript before signing.
- UX is identical to the user. Security story is "trust our server" instead of
  "trust the contract."

**Stop-and-switch trigger:** if step 8 or 9 isn't working after a focused day, switch to 10b. Pitch then leads with the voice message and frames on-chain enforcement as v1.1.

### 10. Scheduler cron

- Convex cron `tickScheduledRules` every 1 minute:
  - Selects `rules` where `status = active && nextRunAt <= now`.
  - Calls `executePayment` for each.
  - On success, advances `nextRunAt` per schedule spec.

**State:** set `nextRunAt` to past → within a minute, payment executes automatically.

### 11. Activity feed

- `/app/activity` reactive query on `transactions`.
- Each row: recipient name, amount USDC, status badge, voice-message play
  button, MorphScan link, timestamp.
- Empty state copy.

**State:** every executed payment shows up live, voice message plays on tap.

### 12. Recipient claim flow

- `notifyRecipient` action (called after rule creation and after each execution):
  - Resend email to recipient with a tokenized `/claim/:token` link.
- Claim screen:
  - Privy email signup.
  - Smart wallet provisioned in background.
  - USDC balance shown.
  - Voice message auto-plays on load.

**State:** second device opens claim link → signs up → sees balance → hears the message.

### 13. Conditional rules

- Convex cron `tickConditionalRules` every 5 minutes.
- Reads recipient's USDC balance on Morph.
- If `balance < condition.walletBelowUsdc`, fires `executePayment` for `topUpUsdc`.
- Cooldown: don't re-fire within X hours to avoid loops.

**State:** drain a test wallet below threshold → top-up fires within 5 minutes.

### 14. Polish pass

- Mobile responsive sweep on all five screens.
- Loading skeletons, error toasts, empty states.
- Onboarding copy in plain English; agent confirmations in Taglish.
- Favicon, page titles, OG tags, /claim screen branded.
- README: architecture diagram, env vars, demo script, honest notes on
  what's session-key vs. fallback path.

### 15. Demo prep

- Pre-seed a dev user with one historical transaction so the activity
  feed has signal on stage.
- Pre-warm the bundler/RPC with a couple of throwaway sends.
- Record a 90-second backup demo video (covers WiFi failure scenario).
- Optional: 30-second real OFW testimonial clip.
- Rehearse the spec's two-minute pitch 5+ times against a timer.

**State:** end-to-end demo runs flawlessly twice in a row without intervention.

---

## Risks we are actively pre-empting

| Risk | Pre-emptive action |
|---|---|
| Whisper misreads Taglish | Editable transcript before parse |
| Conference WiFi kills voice | Backup demo video |
| EIP-7702 tooling immature | Limits-in-Convex fallback specced as step 10b |
| Delegator contract bugs | Foundry tests for every limit case before deploy |
| Privy ↔ Morph provisioning hiccup | Test on step 2; Dynamic.xyz as a noted-but-not-built backup |
| Empty activity feed on stage | Pre-seeded demo transaction |
| Judge asks about off-ramp | "USDC-native by design, off-ramp partners in pipeline" |

---

## Tagline

> Echo — say it once. Send it home, forever.
> Built on Morph. Speaks Taglish. Never forgets.
