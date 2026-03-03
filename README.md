# 🛡️ SENTINAL — Multi-Chain DeFi Health Monitor

> **The missing middleware between DeFi risk signals and automated onchain protection.**
> Powered by Chainlink CRE · DON-signed reports · Automated circuit breakers.

[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-375BD2?logo=chainlink)](https://chain.link)
[![Sepolia](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 📌 The Problem

DeFi protocols are blind to systemic risk. When a bank run starts on Aave, utilization can spike 30% in a single block cycle — but there is no automated, trustless mechanism to:

- Detect the spike across multiple chains simultaneously
- Cross-reference onchain reserve data against offchain TVL
- Automatically halt connected protocols before users lose funds

Existing monitoring tools are **offchain dashboards** — they alert humans, who then manually execute emergency multisigs. This introduces minutes or hours of lag during the exact moment speed matters most.

**SENTINAL solves this with Chainlink CRE.**

---

## 💡 The Solution

SENTINAL is a fully automated, DON-signed DeFi health monitoring system that:

1. **Reads** reserve data across 3 chains using 15 EVM calls per cycle
2. **Cross-references** onchain data against DeFiLlama TVL via DON consensus
3. **Detects** utilization velocity spikes (> 5%/cycle = borrow run signal)
4. **Writes** cryptographically-signed health reports onchain via Chainlink CRE
5. **Triggers** `SentinalGuard` circuit breakers automatically — no human needed
6. **Alerts** Discord with per-protocol solvency and velocity data

Any DeFi protocol can integrate SENTINAL protection in 3 lines of Solidity:

```solidity
function deposit(uint256 amount) external {
    require(GUARD.isSafe(address(this)), "SENTINAL: circuit breaker active");
    // ... rest of deposit logic
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CHAINLINK CRE WORKFLOW                       │
│                    (healthcheck-monitor/index.ts)                │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌────────┐  │
│  │   CRON   │→  │  EVM READ    │→  │   HTTP    │→  │  DON   │  │
│  │ Trigger  │   │  15 Calls    │   │ DeFiLlama │   │Consensus│  │
│  │  60s     │   │  3 Chains    │   │  TVL API  │   │ Median │  │
│  └──────────┘   └──────────────┘   └───────────┘   └────────┘  │
│                        │                                  │      │
│              ┌─────────▼──────────────────────────────────▼──┐  │
│              │         RISK ENGINE                            │  │
│              │  Solvency + Velocity + Cross-Reference         │  │
│              └─────────────────────┬──────────────────────────┘  │
│                                    │                             │
│                    ┌───────────────▼──────────────┐             │
│                    │      EVM WRITE (DON-signed)   │             │
│                    │   ReserveOracleV2.onReport()  │             │
│                    └───────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │         SEPOLIA TESTNET          │
              │                                  │
              │  ┌─────────────────────────────┐ │
              │  │     ReserveOracleV2          │ │
              │  │  · Aggregate health reports  │ │
              │  │  · Per-protocol solvency     │ │
              │  │  · Velocity baselines        │ │
              │  │  · previousUtilization[]     │ │
              │  └──────────────┬──────────────┘ │
              │                 │                  │
              │  ┌──────────────▼──────────────┐  │
              │  │      SentinalGuard           │  │
              │  │  · Open registry             │  │
              │  │  · Circuit breaker           │  │
              │  │  · isSafe(address)           │  │
              │  └──────────────┬──────────────┘  │
              │                 │                  │
              │  ┌──────────────▼──────────────┐  │
              │  │       MockVault              │  │
              │  │  · Deposit/withdraw gated    │  │
              │  │  · 3-line integration demo   │  │
              │  └─────────────────────────────┘  │
              └─────────────────────────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │         ALERT SERVER             │
              │      (server/server.mjs)         │
              │  · Receives CRE workflow result  │
              │  · Submits protocol data onchain │
              │  · Discord / Telegram alerts     │
              │  · REST API for dashboard        │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │        NEXT.JS DASHBOARD         │
              │     (dashboard/app/page.tsx)     │
              │  · Live protocol solvency        │
              │  · Risk gauge + history chart    │
              │  · Guard panel + VaultCard       │
              │  · Auto-refresh every 15s        │
              └─────────────────────────────────┘
```

---

## 🔗 Chainlink CRE — All 7 Capabilities Used

| Capability | Usage | Detail |
|---|---|---|
| **Cron Trigger** | Every 60 seconds | Automated health checks, no manual intervention |
| **EVM Read** | Calls 1–14 | Reserve data across Ethereum, Arbitrum, Base |
| **HTTP GET** | DeFiLlama API | `/tvl/aave-v3` and `/tvl/lido` |
| **DON Consensus** | Median aggregation | Trustless TVL cross-reference |
| **EVM Write** | DON-signed report | `ReserveOracleV2.onReport()` on Sepolia |
| **DON Time** | `runtime.now()` | Tamper-proof timestamps in reports |
| **HTTP POST** | Discord webhook | Real-time alerts with velocity data |

### EVM Call Budget (15/15 used)

```
Calls  1–4:   Aave V3 Ethereum  (getReserveData + aToken supply + USDC balance + debt supply)
Calls  5–8:   Aave V3 Arbitrum  (same 4 calls)
Calls  9–12:  Aave V3 Base      (same 4 calls)
Calls 13–14:  Lido stETH        (getTotalPooledEther + totalSupply)
Call  15:     ReserveOracleV2.getPreviousUtilizations()  ← velocity detection
```

---

## 📊 What Gets Stored Onchain

Every 60 seconds, **two transactions** hit Sepolia:

**TX 1 — DON-signed aggregate report** → `ReserveOracleV2.onReport()`
```
totalReservesUSD   $4,462,634,659
totalClaimedUSD    $4,462,625,982
globalRatio        10000 (basis points)
riskScore          0–100
severity           HEALTHY / WARNING / CRITICAL
anomalyDetected    bool
checkNumber        sequential
timestamp          DON-attested
```

**TX 2 — Per-protocol data** → `ReserveOracleV2.submitProtocolData()`
```
For each of 4 protocols:
  name             "Aave V3 USDC (Ethereum)"
  solvencyRatio    10000 bps
  utilization      6436 bps (64.36%)
  velocityBps      delta from last check
  velocityNegative direction
  → also stores previousUtilization for next CRE call #15
  → calls SentinalGuard.updateProtocolStatus() per protocol
```

---

## ⚡ Velocity Detection

SENTINAL implements a novel **onchain velocity detection** pattern:

1. Every check, CRE call #15 reads `previousUtilization[]` from `ReserveOracleV2`
2. Current utilization is compared against stored baseline
3. If delta > 500 bps (5%) in one cycle → `VelocityAlert` event emitted
4. Risk score increases by +15 per alert, +20 for extreme spikes (>15%)
5. `SentinalGuard` triggers automatic circuit breaker at CRITICAL threshold

```
Check N:    Util = 64.3%  → stored onchain
Check N+1:  Util = 64.4%  → velocity = 0.1% (safe)
Check N+1:  Util = 72.3%  → velocity = 8.0% ⚡ ALERT → circuit breaker
```

---

## 🏛️ Smart Contracts

| Contract | Address (Sepolia) | Purpose |
|---|---|---|
| `ReserveOracleV2` | [`0x71f540d7dac0fc71b6652b1d8aee9012638095ca`](https://sepolia.etherscan.io/address/0x71f540d7dac0fc71b6652b1d8aee9012638095ca) | DON report receiver + velocity store |
| `SentinalGuard` | [`0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905`](https://sepolia.etherscan.io/address/0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905) | Open-registry circuit breaker |
| `MockVault` | [`0x29Ac4504A053f8Ac60127366fFF69f91D4F32Bf58`](https://sepolia.etherscan.io/address/0x29Ac4504A053f8Ac60127366fFF69f91D4F32Bf58) | Integration demo — 3-line guard |

### Monitored Protocols

| Protocol | Chain | Pool |
|---|---|---|
| Aave V3 USDC | Ethereum Mainnet | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Aave V3 USDC | Arbitrum One | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Aave V3 USDC | Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Lido stETH | Ethereum Mainnet | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18
npm >= 9
cre CLI installed (npm install -g @chainlink/cre-cli)
```

### 1. Clone

```bash
git clone https://github.com/dhruv457457/SENTINAL.git
cd SENTINAL
```

### 2. Environment Setup

```bash
# server/.env
ORACLE_ADDRESS=0x71f540d7dac0fc71b6652b1d8aee9012638095ca
GUARD_ADDRESS=0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905
VAULT_ADDRESS=0x29Ac4504A053f8Ac60127366fFF69f91D4F32Bf58
PRIVATE_KEY=your_sepolia_private_key
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
DISCORD_WEBHOOK_URL=your_discord_webhook
```

```bash
# dashboard/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Install Dependencies

```bash
# Server
cd server && npm install

# Dashboard
cd ../dashboard && npm install

# CRE workflow
cd ../cre-workflow/healthcheck-monitor && npm install
```

### 4. Configure CRE Staging Settings

```yaml
# cre-workflow/healthcheck-monitor/staging-settings.yaml
rpcs:
  - chain-name: ethereum-testnet-sepolia
    url: https://ethereum-sepolia-rpc.publicnode.com
  - chain-name: ethereum-mainnet
    url: https://ethereum-rpc.publicnode.com
  - chain-name: ethereum-mainnet-arbitrum-1
    url: https://arbitrum-one-rpc.publicnode.com
  - chain-name: ethereum-mainnet-base-1
    url: https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### 5. Run

**Terminal 1 — Alert Server:**
```bash
cd server
node server.mjs
# API running at http://localhost:3001
```

**Terminal 2 — Dashboard:**
```bash
cd dashboard
npm run dev
# Dashboard at http://localhost:3000
```

**Terminal 3 — CRE Runner (simulate):**
```bash
node scripts/run-and-report.mjs
```

**Terminal 3 — CRE Runner (broadcast — real txs):**
```bash
node scripts/run-and-report.mjs --broadcast
```

**Or run the CRE workflow directly:**
```bash
cd cre-workflow/healthcheck-monitor
cre workflow simulate healthcheck
cre workflow simulate healthcheck --broadcast
```

---

## 📁 Project Structure

```
SENTINAL/
├── contracts/                          # Solidity smart contracts
│   ├── ReserveOracleV2.sol             # ← Chainlink CRE receiver
│   ├── SentinalGuard.sol               # ← Circuit breaker registry
│   ├── ISentinalGuard.sol              # ← Integration interface
│   ├── MockVault.sol                   # ← 3-line integration demo
│   └── EmergencyController.sol
│
├── cre-workflow/
│   └── healthcheck-monitor/
│       ├── index.ts                    # ← CRE workflow (ALL 7 capabilities)
│       ├── staging-settings.yaml       # ← RPC configuration
│       └── contracts/abi/             # ← Aave, Lido, ERC20 ABIs
│
├── server/
│   ├── server.mjs                      # ← Alert server + onchain reporter
│   └── onchain-reporter.mjs            # ← submitProtocolData() caller
│
├── scripts/
│   └── run-and-report.mjs              # ← Continuous runner with live logs
│
├── dashboard/
│   └── app/
│       ├── page.tsx                    # ← Main dashboard
│       └── components/
│           ├── GuardPanel.tsx          # ← Circuit breaker status
│           ├── VaultCard.tsx           # ← Live vault data
│           ├── ProtocolCard.tsx        # ← Per-protocol solvency + velocity
│           └── HistoryChart.tsx        # ← Risk score over time
│
└── README.md
```

---

## 🔍 Live Data (at time of submission)

```
Protocols monitored:    4
Chains:                 3 (Ethereum, Arbitrum, Base)
Aggregate reserves:     $4.46B
Aave V3 TVL:           $26.3B (DeFiLlama, DON consensus)
Lido stETH TVL:        $18.8B (DeFiLlama, DON consensus)
Total monitored:        ~$45B
Checks completed:       16+
Velocity detection:     ACTIVE (baseline seeded, deltas tracked)
Circuit breaker:        🟢 CLOSED — SAFE
Registered protocols:   2
```

---

## 🛡️ SentinalGuard — Protocol Integration

Any DeFi protocol can integrate SENTINAL protection with 3 lines:

```solidity
// 1. Import the interface
import "./ISentinalGuard.sol";

// 2. Set the guard address
ISentinalGuard constant GUARD = ISentinalGuard(0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905);

// 3. Gate your transactions
function deposit(uint256 amount) external {
    require(GUARD.isSafe(address(this)), "SENTINAL: circuit breaker active");
    // ... rest of logic
}
```

**Trigger conditions:**

| Condition | Action |
|---|---|
| Severity = CRITICAL (risk > 60) | Global pause — all registered protocols halt |
| Protocol solvency < 90% | Per-protocol pause |
| Velocity spike > 5%/cycle | VelocityAlert event + risk score increase |
| Velocity spike > 15%/cycle | +35 risk score, extreme alert |

---

## 📡 API Reference

The alert server exposes a REST API for the dashboard:

```
GET  /api/latest              Latest health check result
GET  /api/history             Last 100 checks
GET  /api/guard/status        SentinalGuard onchain state
GET  /api/vault/status        MockVault live data from Sepolia
GET  /api/alerts/config       Discord/Telegram config
PUT  /api/alerts/config       Update alert config
POST /api/alerts/test         Send test alert
POST /api/report              Submit CRE workflow result (called by runner)
```

---

## 🧪 End-to-End Test

Run the full test suite against deployed Sepolia contracts:

```bash
cd scripts
node test-e2e.mjs
```

Expected output:
```
✅ Test 1: Oracle reads totalChecks
✅ Test 2: Deposits accepted when circuit breaker CLOSED
✅ Test 3: simulateCritical() triggers CRITICAL severity
✅ Test 4: Guard global pause activated
✅ Test 5: Deposits revert — SENTINAL: circuit breaker active
✅ Test 6: manualUnpause() restores normal operation
```

---

## 🏆 Prize Track

This project targets the **Risk & Compliance** track ($16,000):

> *"For projects focused on monitoring, safeguards, and automated controls across onchain systems. This includes applications that detect risk, verify reserves or system health, and trigger predefined responses based on real-world or onchain conditions."*

**Directly addresses all listed use cases:**
- ✅ Automated risk monitoring (CRE workflow every 60s)
- ✅ Real-time reserve health checks (15 EVM calls, 3 chains)
- ✅ Protocol safeguard triggers (SentinalGuard circuit breaker)

---

## 🧑‍💻 Author

**Dhruv Pancholi**
- GitHub: [@dhruv457457](https://github.com/dhruv457457)
- Email: dpancholi.pp123@gmail.com

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

## 🔗 Links

- **Repo:** https://github.com/dhruv457457/SENTINAL
- **Oracle (Sepolia):** https://sepolia.etherscan.io/address/0x71f540d7dac0fc71b6652b1d8aee9012638095ca
- **Guard (Sepolia):** https://sepolia.etherscan.io/address/0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905
- **Vault (Sepolia):** https://sepolia.etherscan.io/address/0x29Ac4504A053f8Ac60127366fFF69f91D4F32Bf58
- **Discord Alerts:** https://discord.gg/Wq8arAHf

---

*Built for Chainlink Convergence Hackathon · Feb–Mar 2026*