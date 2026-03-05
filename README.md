# SENTINAL
### Multi-Chain DeFi Health Monitor — Powered by Chainlink CRE

> Autonomous, trustless reserve monitoring for $4.42B+ in live DeFi liquidity — detecting utilization velocity, cross-chain contagion, and solvency anomalies every 60 seconds via a 10-step CRE workflow with cryptographically attested on-chain reports.

**Track:** Risk & Compliance · Chainlink Convergence Hackathon 2026

[![Live Contracts](https://img.shields.io/badge/Sepolia-Verified-green)](https://sepolia.etherscan.io/address/0x985eb2859e7502f38d3944a4a6d10aa5d7158b24)
[![CRE Workflow](https://img.shields.io/badge/CRE-Broadcast%20Mode-blue)]()
[![Protocols](https://img.shields.io/badge/Protocols-4-orange)]()
[![Chains](https://img.shields.io/badge/Chains-3-purple)]()

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
| [`healthcheck-contracts/contracts/ReserveOracleV2.sol`](healthcheck-contracts/contracts/ReserveOracleV2.sol) | `IReceiver` — receives DON-signed `writeReport()` from CRE workflow · stores policyHash · exposes `getPreviousUtilizations()` |
| [`healthcheck-contracts/contracts/SentinalGuard.sol`](healthcheck-contracts/contracts/SentinalGuard.sol) | Circuit breaker — triggered by CRE workflow CRITICAL severity verdict |

### Runner & Server

| File | Chainlink Service |
|---|---|
| [`scripts/run-and-report.mjs`](scripts/run-and-report.mjs) | Invokes `cre workflow simulate healthcheck --broadcast` — real Sepolia txs every 60s |
| [`server/onchain-reporter.mjs`](server/onchain-reporter.mjs) | Submits CRE workflow results onchain after each cycle |

---

## 🎯 The Problem

DeFi holds hundreds of billions in user funds with no real-time autonomous monitoring layer. Existing tools are:

- **Centralized** — Gauntlet, Hypernative, Chaos Labs all run on private AWS with single points of failure
- **Reactive** — dashboards show the attack *in progress*, not before it lands
- **Single-chain** — none monitor correlated risk across Ethereum + Arbitrum + Base simultaneously
- **Gameable** — public thresholds let adversaries simulate trigger conditions before execution

Luna ($40B), Celsius ($3B), and Euler ($197M) all had detectable warning signals — rising utilization velocity, cross-protocol correlation, reserve backing drift. No automated system existed to catch and attest them on-chain before collapse.

---

## 💡 The Solution

SENTINAL is a **10-step Chainlink CRE workflow** that runs every 60 seconds, reads live state from $4.42B in DeFi reserves across 3 chains, scores risk against a confidential policy, and submits a **DON-signed attested report** to Sepolia — creating an immutable compliance trail no centralized operator can tamper with.

```
Every 60 seconds:
  Read $4.42B across 3 chains  (7 EVM calls, Multicall3 batched)
  Fetch $46B TVL from DeFiLlama (HTTP + DON Consensus)
  Read previous utils from Sepolia (Call 8, eth_call)
  Detect velocity + contagion
  Score risk against confidential policy
  Submit DON-signed report on-chain (Call 9, writeReport)
  Fire Discord alert
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
│  STEP 2  EVMClient.callContract() ×7  [Calls 1–7]                   │
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
│          └──► [6389, 5470, 7374, 0] bps                              │
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
   └──────────────────────┘         └────────────────────────┘
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
// secrets.ts — loaded via runtime.getSecret()
const raw = runtime.getSecret('SENTINAL_POLICY_CONFIG')
const policy = JSON.parse(raw)
// thresholds: velocityAlertBps, solvencyWarningBps, riskCriticalThreshold...

// policyHash cryptographically binds every report to the active policy version
const policyHash = keccak256(raw)
```

Every on-chain report stores `policyHash` — creating an immutable compliance trail:

```
Report submitted  →  bound to policy version  →  at timestamp Z  →  check #N
```

Auditors verify enforcement-policy alignment. Adversaries cannot infer trigger conditions from chain history.

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
Reads previous utilization from `ReserveOracleV2` each cycle via Sepolia `eth_call`. Computes per-cycle delta in basis points. Fires alert if spike exceeds `velocityAlertBps` (configurable, never exposed on-chain).

```
Aave V3 USDC (Arbitrum): 54.7% → 54.8% ▲ (0.1%/cycle)  ✅ Normal
Aave V3 USDC (Base):     75.0% → 80.5% ▲ (5.5%/cycle)  ⚡ VELOCITY ALERT
```

### 2. Cross-Chain Contagion Detection
Detects correlated velocity spikes across 2+ chains simultaneously — the signature pattern of systemic exploits spreading cross-chain.

```
If ETH util +5% AND Arbitrum util +4% in same cycle → CONTAGION → tierEscalation
```

### 3. Solvency Monitoring
Tracks `solvencyRatio` per protocol in basis points. Tiered escalation: WARNING (95%) → CRITICAL (90%) → EMERGENCY (85%).

### 4. TVL Cross-Reference
Compares onchain reserves against DeFiLlama TVL via DON consensus. Flags unusual share ratios that could indicate undisclosed reserve changes.

---

## 🔗 Deployed Contracts (Sepolia Testnet)

| Contract | Address | Verified |
|---|---|---|
| `ReserveOracleV2` | [`0x985eb2859e7502f38d3944a4a6d10aa5d7158b24`](https://sepolia.etherscan.io/address/0x985eb2859e7502f38d3944a4a6d10aa5d7158b24) | ✅ |
| `SentinalGuard` | [`0xfc3082f4954f36ce7794e6c49769b9bf819fc80a`](https://sepolia.etherscan.io/address/0xfc3082f4954f36ce7794e6c49769b9bf819fc80a) | ✅ |

### Live Transaction Examples (Real DON-signed Reports)

| Tx | Check | Note |
|---|---|---|
| [`0x4eea6047...`](https://sepolia.etherscan.io/tx/0x4eea604782bec55b7fa9086d8ecee0bd3a8315b6009e007e5cb62e7e33a31f3a) | #21996 | First baseline seeded |
| [`0xf0451adb...`](https://sepolia.etherscan.io/tx/0xf0451adb278ecdfc768e7ee88c9c760f145af2bb323776e4ffcaa53b67c1e060) | #22240 | Velocity detection active |
| [`0xde4ddd1a...`](https://sepolia.etherscan.io/tx/0xde4ddd1a2e031a3dd0ca60cf86e9c059dcdf8f8efa699c13d6d33b4b193ba6f7) | #22932 | Full system operational |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ / Bun
- CRE CLI: `npm install -g @chainlink/cre-cli`
- Sepolia RPC endpoint + funded wallet

### 1. Clone & Install
```bash
git clone https://github.com/dhruv457457/SENTINAL.git
cd SENTINAL/cre-workflow/healthcheck-monitor && npm install
cd ../../server && npm install
```

### 2. Simulate Workflow (No Gas Required)
```bash
cd cre-workflow/healthcheck-monitor
cre workflow simulate healthcheck
```

### 3. Run Full System (Real Transactions)
```bash
# Terminal 1 — API server
cd server && node index.mjs

# Terminal 2 — CRE runner (broadcast mode, real Sepolia txs)
cd scripts && node run-and-report.mjs --broadcast
```

### 4. Trigger Circuit Breaker Demo
```bash
cd server && node demo-guard.mjs
```

---

## 📁 Repository Structure

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
│       │       ├── risk/contagion.ts    # Contagion detection
│       │       ├── risk/scoring.ts      # Risk engine
│       │       └── risk/velocity.ts     # Velocity detection
│       ├── workflow.yaml                # 🔗 CRE workflow config
│       ├── project.yaml                 # 🔗 CRE project + RPCs
│       └── config.staging.json          # Protocol + oracle addresses
│
├── healthcheck-contracts/
│   └── contracts/
│       ├── ReserveOracleV2.sol          # 🔗 IReceiver + report storage
│       └── SentinalGuard.sol            # 🔗 Circuit breaker
│
├── scripts/
│   └── run-and-report.mjs              # 🔗 Continuous runner
│
├── server/
│   ├── index.mjs                        # API server
│   ├── demo-guard.mjs                   # Circuit breaker demo
│   └── onchain-reporter.mjs            # 🔗 Onchain sync
│
└── frontend/                            # Next.js dashboard
```

> 🔗 = File integrates Chainlink CRE services

---

## 🛡️ SentinalGuard — Circuit Breaker

Any DeFi protocol integrates SENTINAL's protection via a standard interface:

```solidity
interface IProtectedProtocol {
    function pauseProtocol() external;
    function unpause() external;
}
```

When SENTINAL's CRE workflow scores CRITICAL, `SentinalGuard`:
1. Opens circuit breaker → `isSafe()` returns `false`
2. Blocks deposits and withdrawals on integrated protocols
3. Records pause event on-chain with `policyHash` binding
4. Requires manual owner override to resume

**Pause events recorded: 5 · Registered protocols: 2**

---

## 📈 Sample Output

```
📡 STEP 2: Onchain Data [EVM Read — Multicall3 Batched] (Calls 1-7)
  ┌─ Aave V3 USDC (Ethereum) [ethereum-mainnet]
  ├─ Liq=$1,346,686,970 | Borrows=$2,382,969,447 | Util=63.9%
  └─ Solvency: 100.00%

📡 STEP 4: Previous Utilizations [Call 8 — Sepolia eth_call]
  ✅ Previous utilizations loaded (4 protocols)
  📊 Aave V3 USDC (Ethereum): prev=63.9%

⚡ STEP 5: Velocity Detection
  ✅ Aave V3 USDC (Arbitrum): 54.7% → 54.8% ▲ (0.1%/cycle)

🎯 STEP 8: Risk Assessment
  Status: HEALTHY | Risk Score: 0/100 | Contagion: NO

📤 STEP 9: Submit Attested Report (Call 9)
  ✅ 0xde4ddd1a2e031a3dd0ca60cf86e9c059dcdf8f8efa699c13d6d33b4b193ba6f7

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💰 Reserves:  $4.42B onchain
  📊 TVL:       $46.33B monitored
  ⚡ Velocity:  0 alerts
  🔗 Contagion: NO
  🔒 Policy:    0xb776f6b6eaa75ef7...
```

---

## 🆚 SENTINAL vs Existing Solutions

| | SENTINAL | Gauntlet / Hypernative | Forta Bots |
|---|---|---|---|
| Decentralized | ✅ Chainlink DON | ❌ Centralized | ⚠️ Individual operators |
| Attested on-chain reports | ✅ DON-signed every 60s | ❌ Off-chain only | ❌ Off-chain alerts |
| Multi-chain simultaneous | ✅ ETH + Arbitrum + Base | ✅ | ⚠️ Manual per-chain setup |
| Confidential thresholds | ✅ `runtime.getSecret()` | ❌ Gameable | ❌ Public |
| Real mainnet data | ✅ $4.42B live | ✅ | ✅ |
| Circuit breaker contract | ✅ SentinalGuard | ❌ Alert only | ❌ Alert only |
| Velocity + contagion | ✅ Both | ⚠️ Partial | ❌ |
| Open source | ✅ | ❌ | ✅ |

---

## 👤 Team

**Dhruv Pancholi** — Solo Developer  
B.Tech Information Technology · Poornima College of Engineering · Jaipur  
[GitHub](https://github.com/dhruv457457) · Chainlink Convergence Hackathon 2026

---

## 📜 License

MIT — Built during Chainlink Convergence Hackathon 2026

---

*"The best time to build reserve monitoring was before Terra. The second best time is now."*