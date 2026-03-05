# 🛡️ SENTINAL
### Multi-Chain DeFi Health Monitor — Powered by Chainlink CRE

> Autonomous, trustless reserve monitoring for $4.42B+ in live DeFi liquidity — detecting utilization velocity, cross-chain contagion, and solvency anomalies every 60 seconds via a 10-step CRE workflow with cryptographically attested on-chain reports.

**Track:** Risk & Compliance · Chainlink Convergence Hackathon 2026

[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-375BD2?logo=chainlink)](https://chain.link)
[![Sepolia](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io)
[![Protocols](https://img.shields.io/badge/Protocols-4-orange)]()
[![Chains](https://img.shields.io/badge/Chains-3-purple)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 📋 Files Using Chainlink

> Required by hackathon submission rules — every file integrating a Chainlink service.

### CRE Workflow

| File | Chainlink Services |
|---|---|
| [`cre-workflow/healthcheck-monitor/healthcheck/workflow.def.ts`](cre-workflow/healthcheck-monitor/healthcheck/workflow.def.ts) | `CronCapability` · `EVMClient` (callContract ×7, writeReport ×1) · `HTTPClient` · `consensusMedianAggregation` · `DON Time` · `runtime.getSecret()` · `hexToBase64` · `bytesToHex` · `encodeAbiParameters` |
| [`cre-workflow/healthcheck-monitor/healthcheck/main.ts`](cre-workflow/healthcheck-monitor/healthcheck/main.ts) | CRE workflow entrypoint — `Runtime`, `CronPayload`, `initWorkflow` |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/evm/client.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/evm/client.ts) | `EVMClient` — multi-chain client factory (Ethereum, Arbitrum, Base, Sepolia) |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/evm/multicall.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/evm/multicall.ts) | `EVMClient.callContract` — Multicall3 batched reads |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/aave.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/aave.ts) | `EVMClient.callContract` — Aave V3 Pool `getReserveData()` across 3 chains |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/index.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/index.ts) | `EVMClient.callContract` — protocol dispatch router |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/others.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/protocols/others.ts) | `EVMClient.callContract` — Lido stETH `getTotalPooledEther()` + `getTotalShares()` |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/alerts/discord.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/alerts/discord.ts) | `HTTPClient` — Discord webhook via CRE HTTP capability |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/policy/secrets.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/policy/secrets.ts) | `runtime.getSecret()` — confidential policy loaded from CRE secret store |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/risk/scoring.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/risk/scoring.ts) | Risk scoring engine — runs inside CRE WASM context |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/risk/velocity.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/risk/velocity.ts) | Velocity detection — runs inside CRE WASM context |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/risk/contagion.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/risk/contagion.ts) | Cross-chain contagion detection — runs inside CRE WASM context |
| [`cre-workflow/healthcheck-monitor/healthcheck/modules/utils/encoding.ts`](cre-workflow/healthcheck-monitor/healthcheck/modules/utils/encoding.ts) | Response body decoding for CRE HTTP capability |
| [`cre-workflow/healthcheck-monitor/healthcheck/workflow.yaml`](cre-workflow/healthcheck-monitor/healthcheck/workflow.yaml) | CRE workflow config — schedule, capabilities, secret bindings |
| [`cre-workflow/healthcheck-monitor/project.yaml`](cre-workflow/healthcheck-monitor/project.yaml) | CRE project settings — RPC endpoints for all 4 networks |
| [`cre-workflow/healthcheck-monitor/config.staging.json`](cre-workflow/healthcheck-monitor/config.staging.json) | Protocol addresses, oracle address, Discord webhook |

### Smart Contracts

| File | Chainlink Service |
|---|---|
| [`healthcheck-contracts/contracts/ReserveOracleV2.sol`](healthcheck-contracts/contracts/ReserveOracleV2.sol) | `IReceiver` — receives DON-signed `writeReport()` · stores policyHash · exposes `getPreviousUtilizations()` |
| [`healthcheck-contracts/contracts/SentinalGuard.sol`](healthcheck-contracts/contracts/SentinalGuard.sol) | Circuit breaker — triggered by CRE workflow CRITICAL severity verdict |

### Runner & Server

| File | Chainlink Service |
|---|---|
| [`scripts/run-and-report.mjs`](scripts/run-and-report.mjs) | Invokes `cre workflow simulate healthcheck --broadcast` — real Sepolia txs every 60s |
| [`server/onchain-reporter.mjs`](server/onchain-reporter.mjs) | Submits CRE workflow results onchain after each cycle |

---

## 🎯 The Problem

DeFi protocols are blind to systemic risk. When a bank run starts on Aave, utilization can spike 30% in a single block cycle — but there is no automated, trustless mechanism to detect it across chains and halt connected protocols before users lose funds.

Existing monitoring tools are **offchain dashboards** that alert humans, who then manually execute emergency multisigs. This introduces minutes of lag during the exact moment speed matters most.

- **Centralized** — Gauntlet, Hypernative, Chaos Labs all run on private AWS with single points of failure
- **Reactive** — they show the attack in progress, not before it lands
- **Single-chain** — none monitor correlated risk across Ethereum + Arbitrum + Base simultaneously
- **Gameable** — public thresholds let adversaries simulate exact trigger conditions

Luna ($40B), Celsius ($3B), and Euler ($197M) all had detectable warning signals — rising utilization velocity, cross-protocol correlation, reserve backing drift. No automated system existed to catch and attest them on-chain before collapse.

**SENTINAL solves this with Chainlink CRE.**

---

## 💡 The Solution

SENTINAL is a fully automated, DON-signed DeFi health monitoring system that:

1. **Reads** reserve data across 3 chains using 9 CRE calls per cycle
2. **Cross-references** onchain data against DeFiLlama TVL via DON consensus
3. **Detects** utilization velocity spikes and cross-chain contagion
4. **Writes** cryptographically-signed health reports onchain via `writeReport()`
5. **Triggers** `SentinalGuard` circuit breakers automatically — no human needed
6. **Alerts** Discord with per-protocol solvency and velocity data

Any DeFi protocol integrates SENTINAL protection in **3 lines of Solidity:**

```solidity
function deposit(uint256 amount) external {
    require(GUARD.isSafe(address(this)), "SENTINAL: circuit breaker active");
    // ... rest of deposit logic
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CHAINLINK CRE WORKFLOW                           │
│               (Triggered every 60s via CronCapability)               │
│                                                                      │
│  STEP 1  runtime.getSecret()                                         │
│          └──► Confidential Policy + policyHash (keccak256)           │
│                                                                      │
│  STEP 2  EVMClient.callContract() ×7  [Calls 1–7, Multicall3]       │
│          ├─ Aave V3 USDC · Ethereum mainnet  →  $3.73B              │
│          ├─ Aave V3 USDC · Arbitrum          →  $298M               │
│          ├─ Aave V3 USDC · Base              →  $390M               │
│          └─ Lido stETH  · Ethereum mainnet   →  9.24M ETH           │
│                                                                      │
│  STEP 3  HTTPClient → DeFiLlama API                                  │
│          consensusMedianAggregation()                                │
│          ├──► aave-v3: $26.67B TVL                                   │
│          └──► lido:    $19.66B TVL                                   │
│                                                                      │
│  STEP 4  HTTPClient → Sepolia RPC (eth_call)  [Call 8]              │
│          ReserveOracleV2.getPreviousUtilizations()                   │
│          └──► [6389, 5470, 7374, 0] bps → velocity delta            │
│                                                                      │
│  STEP 5  Velocity Detection (bigint BPS, no float)                   │
│  STEP 6  Cross-Chain Contagion Detection                             │
│  STEP 7  TVL Cross-Reference Analysis                                │
│  STEP 8  Risk Scoring 0–100 vs confidential policy thresholds        │
│                                                                      │
│  STEP 9  EVMClient.writeReport()  [Call 9]                           │
│          encodeAbiParameters (9 fields) → hexToBase64                │
│          DON-signed · submitted to ReserveOracleV2 on Sepolia        │
│                                                                      │
│  STEP 10 HTTPClient → Discord webhook                                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
   ┌──────────────────────┐         ┌────────────────────────┐
   │   ReserveOracleV2    │         │     SentinalGuard       │
   │   (Sepolia)          │         │     Circuit Breaker     │
   │   IReceiver impl     │         │     isSafe() → false    │
   │   Stores reports     │         │     on CRITICAL         │
   │   policyHash bound   │         │     blocks deposits     │
   └──────────┬───────────┘         └────────────────────────┘
              │
   ┌──────────▼───────────┐
   │     Alert Server     │
   │   (server/index.mjs) │
   │   REST API           │
   │   Discord alerts     │
   └──────────┬───────────┘
              │
   ┌──────────▼───────────┐
   │   Next.js Dashboard  │
   │   Live solvency      │
   │   Risk history chart │
   │   Guard panel        │
   └──────────────────────┘
```

---

## ⚡ CRE Capabilities — Full Usage

| Capability | How SENTINAL Uses It |
|---|---|
| `CronCapability` | Triggers workflow every 60 seconds |
| `EVMClient.callContract` | Reads Aave V3 + Lido state across 3 chains via Multicall3 (7 calls) |
| `EVMClient.writeReport` | Submits 9-field DON-signed report to ReserveOracleV2 (1 call) |
| `HTTPClient` | DeFiLlama TVL · Sepolia eth_call · Discord alert (3 separate HTTP calls) |
| `consensusMedianAggregation` | DON-level median consensus on TVL data and previous utilizations |
| `runtime.getSecret()` | Loads `SENTINAL_POLICY_CONFIG` — thresholds never in source code |
| `DON Time` | `runtime.now()` for report timestamp and check number |
| `hexToBase64` / `bytesToHex` | Encodes report payload for writeReport |
| `encodeAbiParameters` | Packs 9-field struct: reserves, risk score, severity, policyHash, timestamp |

**9 capabilities · 9 CRE calls per cycle · Real Sepolia transactions every 60s**

---

## 🔐 Confidential Policy Enforcement

All risk thresholds live inside CRE's secret store — zero hardcoded constants in source code:

```typescript
// policy/secrets.ts — loaded via runtime.getSecret()
const raw = runtime.getSecret('SENTINAL_POLICY_CONFIG')
const policy = JSON.parse(raw)
// thresholds: velocityAlertBps, solvencyWarningBps, riskCriticalThreshold...

// policyHash cryptographically binds every on-chain report
const policyHash = keccak256(raw)
```

Every on-chain report stores `policyHash` — creating an immutable compliance trail:

```
Report submitted  →  bound to policy version  →  at timestamp Z  →  check #N
```

Auditors verify enforcement-policy alignment. Adversaries cannot infer trigger thresholds from chain history.

---

## 📊 What SENTINAL Monitors

| Protocol | Chain | Metric | Live Value |
|---|---|---|---|
| Aave V3 USDC | Ethereum mainnet | Deposits / Liquidity / Borrows / Util | ~63.9% util |
| Aave V3 USDC | Arbitrum One | Deposits / Liquidity / Borrows / Util | ~54.7% util |
| Aave V3 USDC | Base | Deposits / Liquidity / Borrows / Util | ~73.7% util |
| Lido stETH | Ethereum mainnet | stETH supply / pooled ETH / backing ratio | 100% backed |

**$4.42B onchain reserves · $46.33B TVL cross-referenced · 3 chains · 4 protocols**

---

## 🚨 Detection Capabilities

### 1. Velocity Detection

SENTINAL implements a novel **onchain velocity detection** pattern:

1. Every cycle, Call 8 reads `previousUtilization[]` from `ReserveOracleV2` on Sepolia
2. Current utilization is compared against stored baseline in basis points
3. If delta > `velocityAlertBps` in one cycle → velocity alert fires
4. Risk score increases +15 per alert, +20 for extreme spikes
5. `SentinalGuard` triggers automatic circuit breaker at CRITICAL threshold

```
Check N:    Util = 64.3%  → stored onchain
Check N+1:  Util = 64.4%  → velocity = 0.1%  ✅ Safe
Check N+1:  Util = 72.3%  → velocity = 8.0%  ⚡ ALERT → circuit breaker
```

### 2. Cross-Chain Contagion Detection

Detects correlated velocity spikes across 2+ chains simultaneously — the signature pattern of systemic exploits spreading cross-chain.

```
If ETH util +5% AND Arbitrum util +4% same cycle → CONTAGION → tierEscalation
```

### 3. Solvency Monitoring

Tracks `solvencyRatio` per protocol in basis points. Tiered escalation: WARNING (95%) → CRITICAL (90%) → EMERGENCY (85%).

### 4. TVL Cross-Reference

Compares onchain reserves against DeFiLlama TVL via DON consensus. Flags unusual share ratios that could indicate undisclosed reserve changes.

---

## 🏛️ Smart Contracts (Sepolia)

| Contract | Address | Verified |
|---|---|---|
| `ReserveOracleV2` | [`0x985eb2859e7502f38d3944a4a6d10aa5d7158b24`](https://sepolia.etherscan.io/address/0x985eb2859e7502f38d3944a4a6d10aa5d7158b24) | ✅ |
| `SentinalGuard` | [`0xfc3082f4954f36ce7794e6c49769b9bf819fc80a`](https://sepolia.etherscan.io/address/0xfc3082f4954f36ce7794e6c49769b9bf819fc80a) | ✅ |

### Monitored Protocol Addresses

| Protocol | Chain | Pool Address |
|---|---|---|
| Aave V3 USDC | Ethereum Mainnet | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Aave V3 USDC | Arbitrum One | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Aave V3 USDC | Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Lido stETH | Ethereum Mainnet | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |

### Live Transaction Examples

| Tx | Check | Note |
|---|---|---|
| [`0x4eea6047...`](https://sepolia.etherscan.io/tx/0x4eea604782bec55b7fa9086d8ecee0bd3a8315b6009e007e5cb62e7e33a31f3a) | #21996 | First baseline seeded |
| [`0xf0451adb...`](https://sepolia.etherscan.io/tx/0xf0451adb278ecdfc768e7ee88c9c760f145af2bb323776e4ffcaa53b67c1e060) | #22240 | Velocity detection active |
| [`0xde4ddd1a...`](https://sepolia.etherscan.io/tx/0xde4ddd1a2e031a3dd0ca60cf86e9c059dcdf8f8efa699c13d6d33b4b193ba6f7) | #22932 | Full system — $46.33B TVL displayed |

---

## 🛡️ SentinalGuard — Protocol Integration

Any DeFi protocol integrates SENTINAL protection with **3 lines of Solidity:**

```solidity
// 1. Import the interface
import "./ISentinalGuard.sol";

// 2. Reference the deployed guard
ISentinalGuard constant GUARD = ISentinalGuard(0xfc3082f4954f36ce7794e6c49769b9bf819fc80a);

// 3. Gate your critical functions
function deposit(uint256 amount) external {
    require(GUARD.isSafe(address(this)), "SENTINAL: circuit breaker active");
    // ... rest of deposit logic
}
```

**Trigger conditions:**

| Condition | Action |
|---|---|
| Risk score ≥ CRITICAL threshold | Global pause — all registered protocols halt |
| Protocol solvency < warning BPS | Per-protocol pause |
| Velocity spike > `velocityAlertBps`/cycle | VelocityAlert + risk score increase |
| Cross-chain contagion detected | Tier escalation + risk score amplification |

**Circuit Breaker Status:** 🟢 CLOSED — SAFE  
**Pause events recorded:** 5  
**Registered protocols:** 2

---

## 🚀 Quick Start

### Prerequisites

```bash
node >= 18
npm >= 9
cre CLI: npm install -g @chainlink/cre-cli
```

### 1. Clone & Install

```bash
git clone https://github.com/dhruv457457/SENTINAL.git
cd SENTINAL

cd cre-workflow/healthcheck-monitor && npm install
cd ../../server && npm install
cd ../dashboard && npm install
```

### 2. Environment Setup

```bash
# server/.env
ORACLE_ADDRESS=0x985eb2859e7502f38d3944a4a6d10aa5d7158b24
GUARD_ADDRESS=0xfc3082f4954f36ce7794e6c49769b9bf819fc80a
PRIVATE_KEY=your_sepolia_private_key
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
DISCORD_WEBHOOK_URL=your_discord_webhook

# dashboard/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Simulate Workflow (No Gas Required)

```bash
cd cre-workflow/healthcheck-monitor
cre workflow simulate healthcheck
```

### 4. Run Full System (Real Transactions)

```bash
# Terminal 1 — API server
cd server && node index.mjs

# Terminal 2 — CRE runner (real Sepolia txs every 60s)
cd scripts && node run-and-report.mjs --broadcast

# Terminal 3 — Dashboard
cd dashboard && npm run dev
# http://localhost:3000
```

### 5. Demo Circuit Breaker

```bash
cd server && node demo-guard.mjs
```

---

## 📁 Project Structure

```
SENTINAL/
├── cre-workflow/
│   └── healthcheck-monitor/
│       ├── healthcheck/
│       │   ├── workflow.def.ts          # 🔗 10-step CRE workflow (main file)
│       │   ├── main.ts                  # 🔗 CRE entrypoint
│       │   ├── config/schema.ts         # 🔗 CRE config schema
│       │   └── modules/
│       │       ├── alerts/discord.ts    # 🔗 HTTPClient
│       │       ├── evm/client.ts        # 🔗 EVMClient factory
│       │       ├── evm/multicall.ts     # 🔗 EVMClient callContract
│       │       ├── policy/secrets.ts    # 🔗 runtime.getSecret()
│       │       ├── protocols/aave.ts    # 🔗 Aave V3 reads
│       │       ├── protocols/others.ts  # 🔗 Lido reads
│       │       ├── risk/contagion.ts    # Cross-chain detection
│       │       ├── risk/scoring.ts      # Risk engine
│       │       └── risk/velocity.ts     # Velocity detection
│       ├── workflow.yaml                # 🔗 CRE workflow config
│       ├── project.yaml                 # 🔗 CRE project + RPCs
│       └── config.staging.json         # Protocol + oracle addresses
│
├── healthcheck-contracts/
│   └── contracts/
│       ├── ReserveOracleV2.sol          # 🔗 IReceiver + report storage
│       └── SentinalGuard.sol            # 🔗 Circuit breaker
│
├── scripts/
│   └── run-and-report.mjs              # 🔗 Continuous runner (--broadcast)
│
├── server/
│   ├── index.mjs                        # API server + check storage
│   ├── demo-guard.mjs                   # Circuit breaker demo
│   └── onchain-reporter.mjs            # 🔗 Onchain sync
│
└── frontend/                            # Next.js dashboard
```

> 🔗 = File integrates Chainlink CRE services

---

## 📡 API Reference

```
GET  /api/latest          Latest health check result
GET  /api/history         Last 100 checks
GET  /api/guard/status    SentinalGuard onchain state
POST /api/report          Submit CRE workflow result (called by runner)
```

---

## 📈 Sample Output

```
📡 STEP 2: Onchain Data [EVM Read — Multicall3 Batched] (Calls 1-7)
  ┌─ Aave V3 USDC (Ethereum)
  ├─ Liq=$1,346,686,970 | Borrows=$2,382,969,447 | Util=63.9%
  └─ Solvency: 100.00%

📡 STEP 4: Previous Utilizations [Call 8 — Sepolia eth_call]
  ✅ Previous utilizations loaded (4 protocols)
  📊 Aave V3 USDC (Arbitrum): prev=54.7%

⚡ STEP 5: Velocity Detection
  ✅ Aave V3 USDC (Arbitrum): 54.7% → 54.8% ▲ (0.1%/cycle)

🎯 STEP 8: Risk Assessment
  Status: HEALTHY | Risk Score: 0/100 | Contagion: NO

📤 STEP 9: Submit Attested Report (Call 9)
  ✅ 0xde4ddd1a...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💰 Reserves:  $4.42B onchain
  📊 TVL:       $46.33B monitored
  ⚡ Velocity:  0 alerts
  🔗 Contagion: NO
  🔒 Policy:    0xb776f6b6eaa75ef7...
  Risk:         0/100 — HEALTHY
```

---

## 🆚 SENTINAL vs Existing Solutions

| | SENTINAL | Gauntlet / Hypernative | Forta Bots |
|---|---|---|---|
| Decentralized | ✅ Chainlink DON | ❌ Centralized AWS | ⚠️ Individual operators |
| Attested on-chain reports | ✅ DON-signed every 60s | ❌ Off-chain only | ❌ Off-chain alerts |
| Multi-chain simultaneous | ✅ ETH + Arbitrum + Base | ✅ | ⚠️ Manual per-chain |
| Confidential thresholds | ✅ `runtime.getSecret()` | ❌ Gameable | ❌ Public |
| Real mainnet data | ✅ $4.42B live | ✅ | ✅ |
| Circuit breaker contract | ✅ SentinalGuard | ❌ Alert only | ❌ Alert only |
| Velocity + contagion | ✅ Both | ⚠️ Partial | ❌ |
| Open source | ✅ | ❌ | ✅ |

---

## 🏆 Prize Track

This project targets the **Risk & Compliance** track ($16,000):

> *"For projects focused on monitoring, safeguards, and automated controls across onchain systems. This includes applications that detect risk, verify reserves or system health, and trigger predefined responses based on real-world or onchain conditions."*

**Directly addresses all listed use cases:**
- ✅ Automated risk monitoring — CRE workflow every 60s, 9 calls, 3 chains
- ✅ Real-time reserve health checks — live Aave V3 + Lido onchain reads
- ✅ Protocol safeguard triggers — SentinalGuard circuit breaker, `isSafe()` gating

---

## 👤 Author

**Dhruv Agarwal** — Solo Developer  
B.Tech Information Technology · Poornima College of Engineering · Jaipur  
[GitHub](https://github.com/dhruv457457) · dpancholi.pp123@gmail.com · Chainlink Convergence Hackathon 2026

---

## 📜 License

MIT — Built during Chainlink Convergence Hackathon 2026

---

## 🔗 Links

- **Repo:** https://github.com/dhruv457457/SENTINAL
- **ReserveOracleV2:** https://sepolia.etherscan.io/address/0x985eb2859e7502f38d3944a4a6d10aa5d7158b24
- **SentinalGuard:** https://sepolia.etherscan.io/address/0xfc3082f4954f36ce7794e6c49769b9bf819fc80a
- **Discord:** https://discord.gg/Wq8arAHf
- **Demo Video:** *(coming soon)*

---

*"The best time to build reserve monitoring was before Terra. The second best time is now."*

*Built for Chainlink Convergence Hackathon · Feb–Mar 2026*