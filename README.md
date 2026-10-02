# AnchorCCTP SDK

> Accept USDC from any CCTP-connected blockchain on Stellar with a single function call.

AnchorCCTP is a TypeScript SDK, CLI, and Anchor integration suite. It lets Stellar anchors and wallets accept USDC from Ethereum, Base, Solana, Arbitrum, Avalanche, Polygon, and 23 other chains over Circle's Cross-Chain Transfer Protocol (CCTP).

---

## Key Capabilities

- **Universal CCTP Routing**: Built-in registry covering all 30 mainnet and testnet CCTP domains (29 source chains plus Stellar).
- **Automated Decimal Alignment**: Lossless 6-to-7 decimal integer scaling ($10^{-6} \to 10^{-7}$) with sub-stroop dust routing.
- **Cryptographic Attestation & Replay Protection**: Automatic Iris proof polling, cryptographic signature verification, and idempotency store.
- **Deterministic Address Translation**: Automatic translation between EVM 20/32-byte hexadecimal addresses and Stellar Ed25519 public keys (`G...`).
- **Trustline Management**: Opt-in USDC trustline inspection and creation with strict XLM reserve spending caps.
- **Machine-Readable CLI**: 4 CLI commands (`init`, `listen`, `verify`, `domains`) emitting clean JSON/NDJSON.

---

## Monorepo Architecture

```
anchorcctp-sdk/
├── packages/
│   ├── core/              # @anchor-cctp/core-sdk Engine (96.5% lines / 91.5% branches)
│   └── cli/               # @anchor-cctp/cli terminal command suite (100% lines / 94.1% branches)
├── apps/
│   └── demo/              # Interactive Freighter-integrated CCTP deposit portal
└── docs/
    ├── SEP-CCTP.md        # Standard proposal draft for Stellar ecosystem anchors
    ├── api-reference.md   # Full TypeScript API reference
    ├── migration-guide.md # Migration guide for existing anchors
    └── evidence/          # Verification logs, test receipts, and deployment proofs
```

---

## Packages

| Package | Version | Description |
|---|---|---|
| [`@anchor-cctp/core-sdk`](./packages/core) | `1.0.1` | Core SDK Engine, a single async function `receive()` |
| [`@anchor-cctp/cli`](./packages/cli) | `1.0.2` | Scriptable CLI suite for terminal & DevOps automation |
| [`apps/demo`](./apps/demo) | `1.0.0` | Freighter-connected React web deposit portal |

---

## Quick Start (Core SDK)

### Installation

```bash
npm install @anchor-cctp/core-sdk
```

### TypeScript Usage

```ts
import { createAnchorCCTP } from '@anchor-cctp/core-sdk';

// 1. Instantiate the SDK client
const cctp = createAnchorCCTP({
  // Anchor-owned sink for sub-stroop dust. Must be a real funded G...
  // (mainnet example: 'GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES').
  // Placeholder StrKeys fail validation — never paste 'GDDUST...' style fillers.
  dustCollectorAddress: 'GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES',
  trustline: {
    allowCreation: true,
    spendCapXlm: 2,
  },
});

// 2. Subscribe to real-time deposit events
cctp.on('onReceiving', ({ burnTxHash, status, attempt }) => {
  console.log(`[Attesting] ${burnTxHash} (Attempt ${attempt})...`);
});

cctp.on('onSettled', ({ amount, dust, txHash, destinationAddress }) => {
  console.log(`[Settled] Credited ${amount} stroops to ${destinationAddress} (Tx: ${txHash})`);
});

// 3. Receive cross-chain USDC in a single call
const settlement = await cctp.receive({
  sourceDomain: 0, // Ethereum
  burnTxHash: '0x9a8f4c2e1b3d7a8c6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d',
  // Recipient Stellar account — a real user G..., never a USDC issuer address.
  destinationAddress: 'GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES',
  amount: 100_000_000n, // 100 USDC (6-decimals)
});

console.log('Stellar Credited Amount:', settlement.amount); // 1_000_000_000n stroops (7-decimals)
```

---

## CLI Usage

```bash
# Install globally or run with npx
npm install -g @anchor-cctp/cli

# 1. Generate stellar.toml CCTP configuration block (testnet issuer shown; mainnet: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN)
anchor-cctp init --domain 27 --usdc-issuer GBBD47IF6... --output ./stellar.toml

# 2. List supported CCTP domains
anchor-cctp domains

# 3. Verify Iris attestation status for a source transaction hash
anchor-cctp verify 0x9a8f4c...

# 4. Stream real-time inbound CCTP transfers for a Stellar address (NDJSON; any G... account)
anchor-cctp listen GBBD47IF6... --limit 10
```

## testnet:auto (Phase 1)

Fresh testnet account → settled USDC in one command. Flow: env identity → fund check (friendbot) → forwarder liveness → trustline ensure (opt-in, capped) → receive() → Soroban prepare/send → balance-delta assert → receipt JSON on stdout.

```bash
# One command: pass an external EVM burn tx hash
npm run testnet:auto -- --skip-burn 0xABC123... --amount 1000000 --source-domain 6

# Full lifecycle
npm run testnet:deploy                          # 1. create account + .env.testnet
source .env.testnet                             # 2. load secret into env
npm run testnet:auto -- --skip-burn 0xABC123...  # 3. receive + balance-delta receipt
```

Burn hash supplied externally via `--skip-burn` (EVM burn automation = Full phase, below). Requires `STELLAR_DESTINATION` + `STELLAR_SECRET` (real Keypair submitter). Balance-delta receipt emitted on stdout as JSON.

## testnet:auto (Full)

Self-serve burn: omit `--skip-burn` → script burns on Base Sepolia itself, then settles.

```bash
# 1. Base Sepolia ETH (gas) via coinbase/alchemy faucet
# 2. Base Sepolia USDC via faucet.circle.com → your EVM address
# 3. EVM key into .env.testnet (NEVER commit): EVM_PRIVATE_KEY=0x...
env (cat .env.testnet) npm run testnet:auto -- --amount 1000000 --log docs/evidence/testnet-auto.log
```

Flow: chain-pin (testnet allowlist only) → gas/USDC checks → approve-if-needed (exact amount) → `depositForBurnWithHook` (mintRecipient + destinationCaller = forwarder, recipient in hookData) → Iris attest → Phase 1 settle → balance-delta receipt with `evmBurnTxHash`. `--skip-burn` path unchanged. Crash after burn but before settle → resume with `--skip-burn <evmBurnTxHash-from-log>` (re-run would burn again).

---

## Documentation & Standards

- [**Documentation site**](apps/docs/): VitePress guides covering the overview, quickstart, CLI and Core references, SEP-CCTP, and security. Run locally with `npm run dev:docs`, then open http://localhost:5174/docs/overview/what. The docs `base` is `/docs/`, the same subpath used in production.
- [**API Reference**](docs/api-reference.md): technical specifications for classes, methods, and configuration.
- [**Migration Guide**](docs/migration-guide.md): steps for anchors moving to AnchorCCTP.
- [**SEP-CCTP Specification Draft**](docs/SEP-CCTP.md): Stellar Ecosystem Proposal draft for the CCTP deposit standard.
- [**Verification Evidence**](docs/evidence/README.md): numbered index mapping each claim to its proof file.
  - [L01 Test Coverage](docs/evidence/coverage.md)
  - [L02 Cross-Chain Settlement Record](docs/evidence/core-receive-sepolia.log)
  - [L03–L07 CLI Recordings & Output Log](docs/evidence/cli-commands.log)
  - [L08 Demo Deployment & Live stellar.toml](docs/evidence/demo-deploy.md)
  - [L11 Demo UI Balance Refresh & Error Panel](docs/evidence/ui-balance-refresh.md)
  - [L12 SEP Protocol PR Link](docs/evidence/sep-pr-link.md)
  - [L13 Mainnet E2E Handoff Brief](docs/evidence/mainnet-e2e-handoff.md)
  - [L15 Instaward Completion Summary](docs/evidence/completion-summary.md)

---

## Quality & Security

- **Strict TDD**: All behaviors accompanied by isolated unit and integration tests.
- **Coverage** (measured 2026-10-02, root `npm test -- --coverage`): 31 passing suites and 364 passing specs across core and CLI. Core is 96.48% lines and 91.49% branches, the binding gate in `packages/core/jest.config.js`. The CLI is at 100% lines and 94.07% branches. Combined repo totals are 97.3% lines and 91.89% branches.
- **Security Guardrails**: No stored private keys, cryptographic verification of all Iris proofs, integer-only BigInt arithmetic, strict spending caps on sponsored trustline creation.
- **Non-Audit Disclaimer (PRD §7.10)**: This SDK is provided as-is for integration acceleration and has **not** undergone a third-party security audit. Review all signing paths and test thoroughly before handling substantial production value.

---

## Development

```bash
git clone https://github.com/Elmanda1/anchorcctp-sdk.git
cd anchorcctp-sdk
npm install
npm test
npm run build
```

---

## Vercel Deployment (demo API)

The demo SPA (`apps/demo/dist`) is static; the receive path runs as Vercel Functions
under the repo-root `api/` directory, each a thin wrapper over the framework-free
handlers in `apps/demo/server/handlers.ts`. Slash paths only (spec §6), because a
literal `:` in a filename is fragile.

| Route | File | Method | Hobby duration |
|---|---|---|---|
| `GET /api/config` | `api/config.ts` | GET | platform default |
| `GET /api/fees` | `api/fees.ts` | GET | platform default |
| `POST /api/receive/initiate` | `api/receive/initiate.ts` | POST | platform default |
| `GET /api/receive/status` | `api/receive/status.ts` | GET | `maxDuration: 30` |
| `POST /api/receive/settle` | `api/receive/settle.ts` | POST | `maxDuration: 300` |

**Hobby vs Pro durations.** Hobby caps function duration at 300s with no extension;
`sleep`-style extensions are Pro-only, and Fluid compute raises Pro to 800s GA
(1800s beta). Every Hobby invocation here is designed to finish far inside that: the
short-poll design keeps each call under ~30s (`settle` polls Iris for at most
`SETTLE_MAX_RETRIES` = 10 attempts ≈ 60s worst case), and the Standard-path waiting
happens client-side across many polls, never inside one invocation. Anything above
300s requires Pro, and that is the only reason to leave Hobby for this workload.

Environment (set in the Vercel dashboard; never `VITE_`-prefixed, so nothing reaches
the browser bundle):

- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: Upstash Redis via the Vercel Marketplace
  (Vercel KV is sunset). Required; the functions fail at cold start without them.
- `STELLAR_SECRET`: sponsor key, server-only. Required in real mode
  (`SIM_MODE=false`, which is the only mode the deployment runs).
- `CIRCLE_ATTESTATION_BASE_URL`: must be explicit and network-consistent
  (testnet → `https://iris-api-sandbox.circle.com`, mainnet →
  `https://iris-api.circle.com`); there is no cross-network default.
- `HORIZON_URL`, `SOROBAN_RPC_URL`: required, `https` + `*.stellar.org`.
- `API_ORIGIN` (optional): the deployment's public origin, added to the CSP
  `connect-src`; falls back to `VERCEL_URL` when unset.
- `ALLOWED_ORIGINS` (optional, comma-separated): browser Origin allowlist for
  `initiate`; `VERCEL_URL` is appended automatically.

---

## License

MIT © Mother's Grace (Juen)
