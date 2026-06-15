<div align="center">

<div align="center">
<pre>
██╗   ██╗███████╗██╗██╗      ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
██║   ██║██╔════╝██║██║      ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
██║   ██║█████╗  ██║██║      █████╗  ██║   ██║██████╔╝██║  ███╗█████╗  
╚██╗ ██╔╝██╔══╝  ██║██║      ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  
 ╚████╔╝ ███████╗██║███████╗ ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
  ╚═══╝  ╚══════╝╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
</pre>
</div>

**The first MEV-resistant dark orderbook for autonomous AI agents on Somnia.**

[![Somnia Testnet](https://img.shields.io/badge/Somnia-Testnet%2050312-00d4ff?style=flat-square&logo=ethereum&logoColor=white)](https://shannon-explorer.somnia.network)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square&logo=solidity)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-28%20Passing-00ff88?style=flat-square)](https://github.com/YOUR_USERNAME/veilforge)
[![Audit](https://img.shields.io/badge/Audit-33%20Issues%20Resolved-00d4ff?style=flat-square)](https://github.com/YOUR_USERNAME/veilforge)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Encode Club](https://img.shields.io/badge/Encode%20Club-Somnia%20Agentathon%202026-purple?style=flat-square)](https://encodeclub.com)

> 33 security issues identified and resolved across 4 audit rounds.  
> Deployed on Somnia Testnet — June 2026.

[Live Demo](https://veilforge-frontend.vercel.app/) · [Demo Video](https://m.youtube.com/watch?v=tPMzbK9nwuM) · [Explorer](https://shannon-explorer.somnia.network/address/0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207) · [Audit Page](https://veilforge-frontend.vercel.app/audit)


</div>

---

## What Is VeilForge

VeilForge is an orderbook where orders are invisible until they execute.
Three autonomous AI agents compete to provide liquidity —
no humans, no keepers, no trusted infrastructure.
Every component runs onchain on Somnia.

---

## The Problem

Every onchain orderbook has the same fundamental flaw: orders are public the moment they are submitted. Before a transaction confirms, anyone scanning the mempool can see your price, your amount, and your direction — and act on it.RPC 

MEV bots exploit this in two ways. **Frontrunning** places an identical order ahead of yours with higher gas, capturing the price you were about to get. **Sandwich attacks** bracket your transaction — buying before you and selling after — extracting value from the price movement you cause.

Existing solutions require centralized infrastructure: private mempools, trusted sequencers, off-chain matching engines. They fix MEV by reintroducing the single points of failure that decentralization was supposed to eliminate. VeilForge solves this at the protocol level, without any trusted intermediary.

---

## How It Works

VeilForge uses a two-phase commit-reveal scheme. Agents submit cryptographic commitments instead of orders. Nobody knows what's inside a commitment until the agent reveals it — and by then, the window to frontrun has closed.

```
PHASE 1 — COMMIT
──────────────────────────────────────────────────────────────
Agent generates:
  salt       = crypto.randomBytes(32)
  commitment = keccak256(price, amount, direction, salt)

Agent calls: commitOrder(commitment)
  → only the hash is stored onchain
  → MEV bots see: "0xa8f3d9c2..." — nothing exploitable

PHASE 2 — REVEAL  (after N blocks, ~5 seconds on Somnia)
──────────────────────────────────────────────────────────────
Agent calls: revealOrder(price, amount, direction, salt)
  → contract verifies: keccak256(params) == commitment  ✓
  → Somnia Reactivity fires matchOrders() in the same block
  → SettlementEngine transfers tokens atomically

RESULT
──────────────────────────────────────────────────────────────
  No frontrunning   — order was invisible until execution
  No keeper         — Somnia Reactivity handles matching natively
  No trusted party  — everything is onchain and verifiable
```

---

## Why Only Possible on Somnia

| Somnia Primitive | Role in VeilForge | Without It |
|---|---|---|
| **Sub-second finality** | Commit-reveal window is ~5 seconds — practical for real trading | Ethereum: 13s/block makes the window too slow |
| **Near-zero gas** | Agents run 2 transactions per order profitably at scale | Ethereum: 2 txs = $20–100, economically unviable |
| **Somnia Reactivity** | `OrderRevealed` triggers `matchOrders()` in the same block | Requires centralized keeper bot running 24/7 |
| **Agents (JSON API)** | Live market prices fetched onchain without a trusted oracle | Requires Chainlink or custom oracle |
| **Agents (LLM)** | Pricing strategy computed onchain, deterministic | Strategy computation moves offchain |
| **Cron Subscriptions** | Expired orders auto-detected without external infrastructure | Requires offchain keeper to expire orders |
| **Native WebSocket** | Dashboard updates in milliseconds via Somnia WSS | Frontend falls back to polling every N seconds |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS AGENTS (TypeScript)                    │
│                                                                      │
│  ┌────────────-─────┐  ┌────-──────────────┐  ┌───────────────────┐  │
│  │ Agent-1          │  │ Agent-2           │  │ Agent-3           │  │
│  │ Market Maker     │  │ Arbitrage         │  │ Conservative      │  │
│  │ spread 0.20-0.35%│  │ spread 0.15-0.40% │  │ spread 0.60-0.80% │  │
│  └────────┬─────────┘  └────────┬──────────┘  └────────┬──────────┘  │
│           └───────────────────┬─┘──────-─────-─────────┘             │
│                           RPC │ calls                                │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────────┐
│                    SOMNIA TESTNET (Chain ID 50312)                   │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │                   CommitRevealCLOB.sol                     │      │
│  │  0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207                │      │
│  │                                                            │      │
│  │  commitOrder()  ──► hash stored onchain                    │      │
│  │  revealOrder()  ──► hash verified + order added to book    │      │
│  │  matchOrders()  ──► best bid × best ask → settlement       │      │
│  └──────────┬────────────────────────────┬────────────────────┘      │
│             │                            │                           │
│   Reactivity│                      invoke│                           │
│   subscription                     agents                            │
│             ▼                            ▼                           │
│  ┌──────────────────┐     ┌──────────────────────────────-────┐      │
│  │ ReactivityAdapter│     │        Somnia Agents              │      │
│  │ 0x93f859...      │     │  JSON API → live market price     │      │  
│  │                  │     │  LLM     → pricing strategy       │      │
│  │ OrderRevealed    │     └────────────────────────-──────────┘      │
│  │ → matchOrders()  │                                                │
│  │ (same block)     │     ┌────────────────────────────-──────┐      │
│  └──────────────────┘     │       Cron Subscriptions          │      │
│                           │  auto-expire uncommitted orders   │      │
│  ┌──────────────────┐     └─────────────────────────────-─────┘      │
│  │  AgentRegistry   │                                                │
│  │  0x22b471...     │                                                │
│  │  collateral      │                                                │
│  │  slash / reward  │                                                │
│  └──────────────────┘                                                │
└───────────────────────────────┬──────────────────────────────────────┘
                     WebSocket  │  events
┌───────────────────────────────┼──────────────────────────────────────┐
│                    FRONTEND (Next.js + Vercel)                       │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Real-time Dashboard                                           │  │
│  │  commits → reveals → matches · live in milliseconds            │  │
│  │  Agent heatmap · Swap widget · Transaction ticker · /audit     │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Deployed Contracts

All contracts deployed on Somnia Testnet (Shannon) — Chain ID 50312.

| Contract | Address | Explorer |
|---|---|---|
| CommitRevealCLOB | `0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207` | [View ↗](https://shannon-explorer.somnia.network/address/0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207) |
| AgentRegistry | `0x22b4710F8219949D98849dAdBecF077a1b0Edc75` | [View ↗](https://shannon-explorer.somnia.network/address/0x22b4710F8219949D98849dAdBecF077a1b0Edc75) |
| ReactivityAdapter | `0x93f859b7c206ea38218c1De6BD8e5412114e93F5` | [View ↗](https://shannon-explorer.somnia.network/address/0x93f859b7c206ea38218c1De6BD8e5412114e93F5) |
| MockWETH | `0x3De966884898384B32B7E1d45e54d94d058a811a` | [View ↗](https://shannon-explorer.somnia.network/address/0x3De966884898384B32B7E1d45e54d94d058a811a) |
| MockUSDC | `0xC84F35D855aF44fD85B477A8924BF981df00EE20` | [View ↗](https://shannon-explorer.somnia.network/address/0xC84F35D855aF44fD85B477A8924BF981df00EE20) |

---

## Security Audit

The contracts went through 4 rounds of audit before deployment.
**33 issues identified and resolved. 0 critical pending.**

| Round | Issues | Category | Key Fix |
|---|---|---|---|
| Round 1 | 9 | Critical & High | Fees destroyed in settlement → routed to `protocolFeeRecipient` |
| Round 2 | 9 | High & Gas | `openBids` array unbounded growth → DOS vector eliminated |
| Round 3 | 9 | High & Medium | `expireOrder` permissionless → keeper authorization added |
| Round 4 | 6 | Gap Analysis | Fee cross-token decimal mismatch → independent `feeInTokenA/B` |

**Severity breakdown:**

```
🔴 Critical   4  →  0 pending
🟠 High       5  →  0 pending
🟡 Medium     6  →  0 pending
```

**Run the audit validation tests:**

```bash
cd contracts
forge test --match-path test/AuditFixes.t.sol -vvv
```

```
[PASS] test_feesReachRecipientInBothTokens()
[PASS] test_expireOrderNoSlashWithoutKeeper()
[PASS] test_activeOrdersDecrementOnReveal()
[PASS] test_feeUnitsAreCorrect()
[PASS] test_withdrawBlockedWithActiveOrders()
[PASS] test_expiredOrdersCleanedFromArrays()

Test result: ok. 28 passed; 0 failed
```

---

## Autonomous Agents

Three agents operate independently after deployment. No human input required.

| Agent | Strategy | Spread | Amount | Edge |
|---|---|---|---|---|
| **Agent-1** | Market Maker | 0.20–0.35% | 1.0 WETH | Tightest spread = highest match rate |
| **Agent-2** | Arbitrage | 0.15–0.40% | 1.0 WETH | Zero inventory risk — only trades when profit is certain |
| **Agent-3** | Conservative | 0.60–0.80% | 0.5 WETH | Survives volatility that kills tight spreaders |

Each agent runs the same cycle autonomously:

```
1. Calculate order parameters based on strategy
2. Generate random salt → compute commitment hash
3. commitOrder(keccak256(price, amount, direction, salt))
4. Wait N blocks (reveal window — ~50 blocks on Somnia Testnet)
5. revealOrder(price, amount, direction, salt)
6. Somnia Reactivity triggers matchOrders() automatically
7. Repeat
```

See [AGENTS.md](AGENTS.md) for full strategy documentation.

---

## Quick Start

### Prerequisites

- [Foundry](https://getfoundry.sh) installed
- Node.js 20+
- STT tokens — [Somnia Faucet](https://testnet.somnia.network/) or [Google Faucet](https://cloud.google.com/application/web3/faucet/somnia/shannon)

### 1. Clone and install

```bash
git clone https://github.com/ervcdev/veilforge
cd veilforge
npm install
```

### 2. Compile and test contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.0 --no-commit
forge build
forge test -vvv
```

### 3. Configure environment

```bash
# contracts/.env
SOMNIA_RPC_URL=https://dream-rpc.somnia.network
DEPLOYER_PRIVATE_KEY=0x...
AGENT_1_ADDRESS=0x...
AGENT_2_ADDRESS=0x...
AGENT_3_ADDRESS=0x...

# agent/.env
SOMNIA_RPC_URL=https://dream-rpc.somnia.network
SOMNIA_WS_URL=wss://api.infra.testnet.somnia.network/ws
SOMNIA_CHAIN_ID=50312
AGENT_1_PRIVATE_KEY=0x...
AGENT_2_PRIVATE_KEY=0x...
AGENT_3_PRIVATE_KEY=0x...
COMMIT_REVEAL_CLOB_ADDRESS=0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207
AGENT_REGISTRY_ADDRESS=0x22b4710F8219949D98849dAdBecF077a1b0Edc75
TOKEN_A_ADDRESS=0x3De966884898384B32B7E1d45e54d94d058a811a
TOKEN_B_ADDRESS=0xC84F35D855aF44fD85B477A8924BF981df00EE20
REVEAL_WINDOW_BLOCKS=50
COLLATERAL_AMOUNT=0.01
```

### 4. Deploy to Somnia Testnet

> **Note:** Somnia Testnet requires deploying contracts individually
> due to gas propagation behavior. Use `forge create` for each contract.

```bash
# 1. MockWETH
forge create src/MockERC20.sol:MockERC20 \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --legacy \
  --gas-price 6000000000 \
  --constructor-args "Wrapped ETH Mock" "WETH" 18

# 2. MockUSDC
forge create src/MockERC20.sol:MockERC20 \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --legacy \
  --gas-price 6000000000 \
  --constructor-args "USD Coin Mock" "USDC" 18

# 3. AgentRegistry
forge create src/AgentRegistry.sol:AgentRegistry \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --legacy \
  --gas-price 6000000000

# 4. CommitRevealCLOB (reemplazar con addresses reales)
forge create src/CommitRevealCLOB.sol:CommitRevealCLOB \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --legacy \
  --gas-price 6000000000 \
  --constructor-args REGISTRY_ADDRESS TOKEN_A_ADDRESS TOKEN_B_ADDRESS

# 5. ReactivityAdapter
forge create src/ReactivityAdapter.sol:ReactivityAdapter \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --legacy \
  --gas-price 6000000000 \
  --constructor-args CLOB_ADDRESS 0x0100
```

After each deploy, save the `Deployed to:` address and use it in the next command.
---

## Running the Agents

Three terminals. Each agent registers itself, approves tokens, and begins operating autonomously.

```bash
# Terminal 1 — Market Maker
cd agent && npm run agent1

# Terminal 2 — Arbitrage
cd agent && npm run agent2

# Terminal 3 — Conservative
cd agent && npm run agent3
```

---

## Running the Frontend

```bash
cd frontend
npm run dev
# open http://localhost:3000
```

The dashboard connects to Somnia Testnet via WebSocket and displays live orderbook activity: commits appearing as hashes, transitioning to revealed orders, and matches executing in real time.

The `/audit` route shows the full security audit history with before/after code diffs and test output.

---

## Project Structure

```
veilforge/
├── contracts/
│   ├── src/
│   │   ├── CommitRevealCLOB.sol      # Core orderbook — commit-reveal + matching
│   │   ├── AgentRegistry.sol         # Agent identity and collateral
│   │   ├── ReactivityAdapter.sol     # Somnia Reactivity subscriber
│   │   └── MockERC20.sol             # Test tokens (WETH + USDC mock)
│   ├── test/
│   │   ├── CommitReveal.t.sol        # 15 tests — commit-reveal flow
│   │   ├── Matching.t.sol            # 7 tests — matching engine
│   │   └── AuditFixes.t.sol          # 6 tests — audit validation
│   ├── script/
│   │   └── Deploy.s.sol              # Full deployment script
│   └── foundry.toml
│
├── agent/
│   └── src/
│       ├── index.ts                  # Entry point + main loop
│       ├── commitReveal.ts           # Commit/reveal cycle + salt management
│       ├── abis.ts                   # Contract ABIs
│       ├── config.ts                 # Somnia chain config for viem
│       └── strategies/
│           ├── marketMaker.ts        # Symmetric spread strategy
│           ├── arbitrage.ts          # Cross-spread detection
│           └── conservative.ts      # Wide spread, low risk
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # Main dashboard
│   │   └── audit/page.tsx            # Audit history page
│   ├── components/
│   │   └── VeilForgeDashboard.tsx    # Real-time orderbook dashboard
│   ├── hooks/
│   │   └── useOrderBook.ts           # WebSocket → live contract events
│   └── lib/
│       └── viem.ts                   # Viem client + Somnia chain config
│
├── packages/
│   └── abis/
│       └── index.ts                  # Shared ABIs from forge build output
│
├── AGENTS.md                         # Agent strategy documentation
└── package.json                      # npm workspaces root
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Smart Contracts | Solidity 0.8.24 | Commit-reveal CLOB, registry, settlement |
| Testing & Deploy | Foundry | 28 tests, deployment scripts |
| Agent Runtime | TypeScript + Node.js | 3 autonomous trading agents |
| Blockchain Client | Viem v2 | Contract interactions, event watching |
| Frontend | Next.js 14 + Tailwind | Real-time dashboard |
| Monorepo | npm workspaces | Shared ABIs from `forge build` output |
| Network | Somnia Testnet (50312) | Sub-second finality, native agents |
| Deployment | Vercel | Frontend hosting |

---

## Somnia Primitives Integration

| Primitive | Implementation | Status |
|---|---|---|
| **Reactivity** | `ReactivityAdapter.sol` subscribes to `OrderRevealed` | ✅ Deployed |
| **WebSocket** | Frontend watches live events via Somnia WSS | ✅ Live |
| **Agents (JSON API)** | Market price feed without oracle | 🔧 Architecture ready |
| **Agents (LLM)** | Onchain pricing strategy computation | 🔧 Architecture ready |
| **Cron Subscriptions** | Auto-expire uncommitted orders | 🔧 Architecture ready |
| **Data Streams** | Structured orderbook event schemas | 🔧 Architecture ready |

---

## Links

| Resource | URL |
|---|---|
| Live Demo | https://veilforge.vercel.app |
| Demo Video | https://m.youtube.com/watch?v=tPMzbK9nwuM |
| Audit Page | https://veilforge.vercel.app/audit |
| CLOB Explorer | https://shannon-explorer.somnia.network/address/0x05f27223bBe02B3CC5c2F5d61DA8902811f5d207 |
| Agent Strategies | [AGENTS.md](AGENTS.md) |
| Somnia Docs | https://docs.somnia.network |
| Encode Club | https://encodeclub.com |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Built for [Encode Club](https://encodeclub.com) Somnia Agentathon 2026

**VeilForge — no one can exploit what no one can see**

</div>
