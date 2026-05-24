---
config:
  layout: elk
  theme: base
  themeVariables:
    primaryColor: "#e0f2fe"
    primaryBorderColor: "#0ea5e9"
    primaryTextColor: "#0c4a6e"
    secondaryColor: "#fef3c7"
    tertiaryColor: "#fce7f3"
    lineColor: "#64748b"
    fontSize: "14px"
    fontFamily: "Inter, system-ui, sans-serif"
    edgeLabelBackground: "#ffffff"
    nodePadding: "16"
---
graph TB
subgraph Flow["✦ VOICE PAYMENT FLOW"]
direction LR
F1["  User Speaks  "] --> F2["  Whisper STT  "] --> F3["  GPT-4o-mini\n  Parse Intent  "] --> F4["  ElevenLabs\n  TTS Readback  "] --> F5["  User Confirms  "] --> F6["  Fund Agent  "] --> F7["  Create Rule  "] --> F8["  Cron Fires  "] --> F9["  Agent EOA\n  Executes Tx  "] --> F10["  Claim Email  "] --> F11["  Recipient Claims  "]
end
subgraph Frontend["✦ FRONTEND — Vite + React 19 + TS + Tailwind — AWS S3 + CloudFront"]
direction LR
Pages["  Pages\n  Landing · VoiceHome · Rules\n  Activity · Recipients · Claim  "]
SDKs["  Client SDKs\n  Privy (Auth + Wallet)\n  viem (Balances + Transfers)\n  Web Speech API  "]
end
subgraph Backend["✦ BACKEND — Convex BaaS"]
direction LR
API["  HTTP Endpoints\n  /api/tts · /api/chat-stream\n  /api/transcribeForChat\n  /api/checkCompleteness\n  /api/parseEmail · /api/prices  "]
Funcs["  Server Functions\n  users · recipients · rules · transactions\n  claims · voiceSessions · voiceMessages\n  customTokens · withdrawals  "]
AIPipe["  AI Pipeline\n  transcribe · parseIntent\n  chatAgent · synthesize  "]
Exec["  Execution\n  executePayment · notify\n  scheduler · fiatConversion  "]
Crons["  Crons\n  tickScheduledRules (30s)\n  tickConditionalRules (5m)\n  retryNotifications (5m)  "]
DB["  Database (11 tables)\n  + File Storage (audio blobs)  "]
end
subgraph External["✦ EXTERNAL SERVICES"]
direction LR
OAI["  OpenAI API\n  Whisper (STT) · GPT-4o-mini · TTS (fallback)  "]
EL["  ElevenLabs\n  TTS (primary) · Hope + Mark voices  "]
RS["  Resend\n  Claim Emails · Notifications  "]
PF["  Price Feeds\n  CoinGecko · CryptoCompare · ExchangeRates  "]
end
subgraph Chain["✦ MORPH HOODI TESTNET (2910)"]
direction LR
Agent["  Agent EOA Wallet · viem signing  "]
Tokens["  USDC · USDT · HTT · ETH  "]
end
subgraph Deploy["✦ DEPLOYMENT"]
direction LR
AWS["  AWS S3 + CloudFront\n  dev.pay-echo.space · Terraform IaC  "]
GHA["  GitHub Actions\n  CI/CD · OIDC Auth  "]
CVX["  Convex Cloud\n  DB + Functions + Crons  "]
Privy["  Privy Cloud\n  Auth + Wallets  "]
Morph["  Morph RPC\n  rpc-hoodi.morph.network  "]
end
Frontend --> Backend
SDKs --> Privy
SDKs --> Chain
Backend --> OAI
Backend --> EL
Backend --> RS
Backend --> PF
Backend --> Chain
Frontend -. "deployed on" .-> AWS
GHA -. "builds + deploys" .-> AWS
Backend -. "hosted on" .-> CVX
classDef fe fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a5f
classDef be fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#422006
classDef ext fill:#fce7f3,stroke:#db2777,stroke-width:2px,color:#831843
classDef ch fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#052e16
classDef dep fill:#ffedd5,stroke:#ea580c,stroke-width:2px,color:#431407
classDef dn fill:#fed7aa,stroke:#ea580c,color:#431407
classDef fl fill:#e0f2fe,stroke:#0ea5e9,stroke-width:2px,color:#0c4a6e
classDef fUser fill:#bfdbfe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f
classDef fAI fill:#fbcfe8,stroke:#ec4899,stroke-width:2px,color:#831843
classDef fChain fill:#a7f3d0,stroke:#10b981,stroke-width:2px,color:#052e16
classDef fBE fill:#fde68a,stroke:#f59e0b,stroke-width:2px,color:#422006
classDef wfe fill:#eff6ff,stroke:#93c5fd,stroke-width:1px,color:#1e3a5f
classDef wbe fill:#fffbeb,stroke:#fcd34d,stroke-width:1px,color:#422006
classDef wex fill:#fdf2f8,stroke:#f9a8d4,stroke-width:1px,color:#831843
classDef wch fill:#ecfdf5,stroke:#6ee7b7,stroke-width:1px,color:#052e16
class Frontend fe
class Backend be
class External ext
class Chain ch
class Deploy dep
class Flow fl
class AWS,GHA,CVX,Privy,Morph dn
class Pages,SDKs wfe
class API,Funcs,AIPipe,Exec,Crons,DB wbe
class OAI,EL,RS,PF wex
class Agent,Tokens wch
class F1,F5,F11 fUser
class F2,F3,F4,F10 fAI
class F6,F9 fChain
class F7,F8 fBE
