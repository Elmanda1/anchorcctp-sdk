# PRD — AnchorCCTP SDK
**Product Requirements Document**

| | |
|---|---|
| Project | AnchorCCTP SDK |
| Team | Mother's Grace |
| Chapter | Stellar Indonesia (Ambassador Lead: Kenny Rivaldi) |
| Contact | Juen — denardyjuen@gmail.com |
| Program | Stellar Instawards |
| Document version | v1.0 |
| Sprint window | 30 calendar days, start 17-08-2026 |
| Budget | $4,500 (5 hrs/day × 30 days × $30/hr) |

---

## 1. Background

Circle's CCTP (Cross-Chain Transfer Protocol) went live on Stellar in May 2026, natively connecting Stellar to 23+ chains via burn-and-mint USDC transfers. Despite this, none of the 37 live Stellar anchors (Africa, LATAM, Philippines, Europe) can accept USDC from chains like Ethereum, Solana, Base, or Arbitrum without weeks of bespoke engineering, because each anchor has to independently solve the same five problems:

1. 7-decimal Stellar USDC vs 6-decimal CCTP USDC (remainder "dust")
2. G... address format vs 32-byte EVM addresses (needs the CCTP forwarder contract)
3. Circle Attestation API polling for mint proofs
4. Domain ID mapping (Stellar = domain 27, 22 other chains)
5. Trustline creation/management for inbound USDC

No existing tool solves this at the anchor-integration layer: Anchor Platform (SDF) is CCTP-unaware, Circle's own SDK is chain-isolated with no Stellar abstraction, and Crossmesh is an end-user UI, not an integration library.

## 2. Goal

> Ship a production-ready, open-source TypeScript SDK + CLI (published to npm) that lets any Stellar anchor accept USDC from any CCTP-connected chain via a single function call — plus a `stellar.toml` spec extension and a live mainnet demo — within 30 days.

### 2.1 Success Metrics (Definition of Done)

| Metric | Target |
|---|---|
| `@anchor-cctp/core-sdk` published on npm | Yes, installable |
| `@anchor-cctp/cli` published on npm | Yes, installable |
| Unit test line coverage | ≥ 90% |
| End-to-end mainnet CCTP transfer | 1 real, verifiable tx |
| SEP-CCTP.md draft PR | Opened against `stellar/stellar-protocol` |
| Demo anchor uptime | Publicly reachable `stellar.toml` at a live URL |
| Time-to-integrate for a new anchor | < 1 hour (vs. current weeks) |

## 3. Users & Use Cases

| Persona | Need | How AnchorCCTP helps |
|---|---|---|
| Anchor engineer (SEP-6/24 operator) | Accept USDC from non-Stellar chains without building CCTP plumbing | `AnchorCCTP.receive()` — one call |
| Anchor ops / non-TS teams | Test & monitor CCTP flows without writing code | CLI: `init`, `listen`, `verify`, `domains` |
| Wallet/dApp integrator | Show users a cross-chain deposit flow into a Stellar anchor | Demo UI + Freighter integration as reference implementation |
| Stellar protocol reviewers | Evaluate a standardized CCTP deposit spec | `SEP-CCTP.md` PR |

## 4. Scope

### 4.1 In Scope

**Deliverable 1 — Core SDK `@anchor-cctp/core-sdk`**
- Public API: `AnchorCCTP.receive(params)`
- Attestation polling (Circle Attestation API, configurable retry/backoff)
- Decimal conversion (7↔6, dust routed to configurable dust-collector address)
- Address translation via CCTP forwarder contract (EVM 32-byte → Stellar G...)
- Domain ID mapping table (all 23+ chains, Stellar = 27)
- Automatic trustline detection/creation
- Typed events: `onReceiving`, `onSettled`, `onDustCollected`
- Full TypeScript types, ≥90% unit test coverage, README quickstart

**Deliverable 2 — CLI `@anchor-cctp/cli`**
- `anchor-cctp init` — generates `stellar.toml` CCTP config block
- `anchor-cctp listen <address>` — streams inbound CCTP transfer events (JSON)
- `anchor-cctp verify <txHash>` — checks burn→mint attestation status
- `anchor-cctp domains` — lists all CCTP domain IDs/chains
- All output machine-readable JSON

**Deliverable 3 — Demo Anchor + SEP-CCTP spec**
- Testnet → mainnet demo anchor with published `stellar.toml`
- Freighter-integrated demo UI (React/Vite) covering the full lifecycle incl. error states
- `SEP-CCTP.md` specification, submitted as draft PR to `stellar/stellar-protocol`
- 3–5 min demo video of a real mainnet transfer

### 4.2 Out of Scope

- SEP-6/24 auto-deposit triggering (separate project: "Hook Relay")
- Anchor Platform plugin (Phase 2, post-SEP-adoption)
- Outbound CCTP (fiat withdrawal / CCTP-out) SDK
- Soroban smart contract for CCTP routing
- Full observability/APM dashboard (basic error logging only)
- Multi-sig / institutional custody integration
- KYC/AML, fiat settlement, regulatory compliance logic
- CCTP Hooks (arbitrary metadata) — documented as future extension only
- Native mobile app; non-Freighter wallets (Rabby, MetaMask Snap, etc.)
- On-chain CCTP event indexer
- Formal security audit / formal verification of the SDK

## 5. Functional Requirements

### 5.1 `AnchorCCTP.receive(params)`

| Input | Type | Notes |
|---|---|---|
| `sourceDomain` | `number` | CCTP domain ID of origin chain |
| `burnTxHash` | `string` | Source-chain burn transaction hash |
| `destinationAddress` | `string` (G...) | Stellar account to credit |
| `dustCollectorAddress` | `string` (G...), optional | Defaults to SDK config |
| `pollIntervalMs` / `maxRetries` | `number`, optional | Backoff tuning |

**Behavior contract:**
1. Poll Circle Attestation API until `status: complete` or `maxRetries` exhausted → emit `onReceiving` on each poll.
2. On attestation, verify + submit mint via forwarder contract if not already minted.
3. Convert minted 6-decimal amount → 7-decimal Stellar amount; compute dust remainder.
4. Ensure destination trustline exists for USDC asset; create if absent (requires funded source account / sponsorship path — see §7 Security).
5. Credit destination; route dust to dust-collector.
6. Emit `onSettled({ amount, dust, txHash })`; emit `onDustCollected` if dust > 0.
7. On failure at any stage: return typed error (`AttestationTimeoutError`, `MintFailedError`, `TrustlineCreationError`, `InvalidDomainError`), never throw untyped exceptions.

### 5.2 CLI Command Contracts

| Command | Input | Output (JSON) |
|---|---|---|
| `init` | anchor domain, USDC issuer | `stellar.toml` CCTP block written to disk |
| `listen <address>` | Stellar G... address | Streamed events: `{event, chain, amount, status, timestamp}` |
| `verify <txHash>` | source-chain tx hash | `{attested: bool, mintTxHash?, status}` |
| `domains` | — | `[{domainId, chain, name}]` |

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Reliability | Attestation polling must survive transient network failure via exponential backoff; no silent data loss on dust rounding |
| Performance | `receive()` overhead beyond attestation wait time (which is Circle-side, typically 5–15 min) should add < 2s |
| Compatibility | Node.js ≥ 18, works in both CJS and ESM consumers |
| Observability | Structured logs (JSON) for every state transition; no `console.log` of sensitive data |
| Documentation | README quickstart, API reference, migration guide, inline JSDoc on all public exports |
| Licensing | Open-source, permissive license (MIT or Apache-2.0) to align with Stellar ecosystem norms |

## 7. Security Requirements

These are **hard requirements**, not nice-to-haves — CCTP integrations move real value.

1. **No private key handling in the SDK.** `AnchorCCTP.receive()` never accepts or stores a secret key. Any transaction signing (e.g. trustline creation, mint submission) is either (a) delegated to a caller-supplied signing callback, or (b) performed via a sponsor/service account whose key is injected by the host app via env var / secrets manager — never hardcoded, never logged.
2. **Attestation verification is mandatory, not optional.** Never credit a destination account based on an unattested / unverified Circle response. Validate the attestation signature and message hash before treating a transfer as settled.
3. **Replay protection.** Track processed `burnTxHash` values (idempotency key) so a repeated `receive()` call or a re-delivered webhook/event cannot double-credit an account.
4. **Amount validation.** Reject negative, zero, or overflow amounts before decimal conversion; use integer/BigInt arithmetic for the 6↔7 decimal conversion — never floating point — to avoid dust-calculation rounding exploits.
5. **Domain ID allow-listing.** Only accept `sourceDomain` values present in the official CCTP domain table; reject unknown domains explicitly rather than passing them through.
6. **Trustline auto-creation guardrails.** Auto-creating a trustline moves XLM reserve requirements onto whichever account funds it — this must be an explicit, documented, opt-in behavior with a configurable spending cap, not silent.
7. **Rate limiting / abuse protection** on the CLI `listen` and any exposed demo-UI endpoints to prevent attestation-API quota exhaustion or DoS via spam burn events.
8. **Dependency hygiene.** Lockfile committed, `npm audit` (or equivalent) run in CI on every PR, no wildcard version ranges for security-sensitive deps (Stellar SDK, crypto libs).
9. **Secrets never in repo/CI logs.** `.env` files gitignored; CI secrets injected via GitHub Actions secrets, not hardcoded in workflow YAML.
10. **Explicit non-audit disclaimer.** Since a formal audit is out of scope for this sprint, the README must clearly state the SDK has not undergone third-party security audit and is provided as-is for integration acceleration, not custody-grade guarantees.

## 8. Testing Strategy — TDD

The project follows **Test-Driven Development**: no production code is written before a failing test exists for it.

**Workflow (red → green → refactor), enforced per PR:**
1. Write a failing unit test describing the next unit of behavior.
2. Write the minimum code to make it pass.
3. Refactor with tests green.
4. Commit only once tests pass and coverage does not regress.

**Test layers:**

| Layer | Tool | Coverage target | What it covers |
|---|---|---|---|
| Unit | Jest | ≥ 90% lines on `core` | decimal conversion math, domain mapping, error classes, event emission, dust rounding edge cases |
| Integration | Jest + testnet fixtures | Key flows | attestation polling against Circle testnet, forwarder call, trustline creation against Stellar testnet |
| CLI (functional) | Jest / execa | All 4 commands | stdout JSON shape, exit codes, error output |
| E2E | Manual + scripted | 1 full pass/week | real testnet burn → SDK receive → credited balance; final week: mainnet |
| Security-focused tests | Jest | N/A (must exist) | replay of same `burnTxHash` rejected, negative/overflow amount rejected, unknown domain rejected, unattested transfer never credited |

**CI gate:** every PR to `main` must pass `lint`, `typecheck`, `test --coverage` (fails build if coverage < 90% on `core`), before merge.

## 9. Directory Structure

Monorepo via npm workspaces, organized so each package is independently publishable and the domain logic (`core`) has zero CLI/UI dependencies.

```
anchorcctp/
├── packages/
│   ├── core/                      # @anchor-cctp/core
│   │   ├── src/
│   │   │   ├── receive.ts         # public receive() entrypoint
│   │   │   ├── attestation/       # Circle Attestation API polling
│   │   │   ├── decimals/          # 6<->7 conversion + dust math
│   │   │   ├── forwarder/         # address translation, forwarder contract calls
│   │   │   ├── trustline/         # trustline detection/creation
│   │   │   ├── domains/           # domain ID mapping table
│   │   │   ├── events/            # typed event emitter
│   │   │   ├── errors/            # typed error classes
│   │   │   └── index.ts           # public exports
│   │   ├── test/                  # unit + integration tests, mirrors src/
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── cli/                        # @anchor-cctp/cli
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── listen.ts
│       │   │   ├── verify.ts
│       │   │   └── domains.ts
│       │   └── index.ts
│       ├── test/
│       ├── package.json
│       └── README.md
│
├── apps/
│   └── demo/                       # React + Vite demo UI (not published to npm)
│       ├── src/
│       │   ├── components/
│       │   ├── wallet/             # Freighter integration
│       │   └── App.tsx
│       └── package.json
│
├── docs/
│   ├── SEP-CCTP.md                 # spec draft for stellar-protocol PR
│   ├── api-reference.md
│   └── migration-guide.md
│
├── .github/
│   └── workflows/
│       └── ci.yml                  # lint, typecheck, test+coverage, audit
├── .env.example
├── package.json                    # workspaces root
├── tsconfig.base.json
└── README.md
```

**Rationale:** `core` has no knowledge of `cli` or `apps/demo` — this keeps the SDK embeddable in any Node/TS backend without pulling in CLI or React dependencies, and lets `core` and `cli` be versioned/published independently.

## 10. Timeline (30 Days)

| Week | Focus | Exit criteria |
|---|---|---|
| 1 | Monorepo scaffold, CCTP/Stellar research, attestation polling module, `SEP-CCTP.md` first draft | Polling module passes tests against testnet; spec draft exists |
| 2 | Core `receive()` flow, unit tests, CLI `listen`/`verify`, demo anchor testnet setup, demo UI scaffold | Full flow works end-to-end on testnet |
| 3 | Dust handling, events, 90%+ coverage, CLI `init`/`domains`, Freighter integration, error-state handling, spec finalized | SDK + CLI feature-complete; demo UI functional |
| 4 | Mainnet demo deployment, npm publish (`core` + `cli`), SEP-CCTP PR submitted, E2E mainnet test, docs + video | All Definition-of-Done metrics met |

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Circle Attestation API latency/instability on testnet | Blocks E2E testing | Build polling with generous backoff early (Week 1); mock the API for unit tests so dev isn't blocked |
| Mainnet demo requires real funded accounts + real USDC | Cost/logistics risk in Week 4 | Budget small real-USDC test amount early; rehearse the flow fully on testnet first |
| Scope creep toward Hook Relay / outbound flows | Blows the 30-day budget | Out-of-scope list in §4.2 is binding; any addition requires a new Instaward |
| SEP-CCTP PR review timeline is outside the team's control | "Submitted" not "merged" is the deliverable | Success criterion is explicitly "PR opened," not "PR merged" |
| Trustline auto-creation drains XLM reserves unexpectedly | Security/financial risk | Opt-in flag + spending cap per §7.6 |

## 12. Evidence of Completion (maps to Instaward SOW §6)

| Deliverable | Evidence |
|---|---|
| Core SDK | Public repo, npm listing, `jest --coverage` output ≥90%, testnet execution log of a full `receive()` cycle |
| CLI | npm listing, terminal screenshots of all 4 commands with JSON output |
| Demo + SEP | Live mainnet URL with `stellar.toml`, Freighter UI screenshots (happy path + error states), SEP-CCTP PR link, 3–5 min mainnet demo video |

## 13. Next Step After This Instaward

Primary path: apply to SCF Build Award for Phase 2 (Anchor Platform plugin, SEP-6/24 auto-deposit integration via the separate "Hook Relay" project).
