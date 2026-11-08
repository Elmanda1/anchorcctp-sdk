# Circle CCTP Parity Gap Closure — Program Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase file task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every verified divergence between `packages/core` and Circle's four official references (V2 wire contracts, Stellar Soroban contracts, `cctp-go`, Circle developer docs), split into independently runnable phases that never edit the same source file.

**Spec:** `docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md`

**Program files:**

| File | Wave | Owns | Can run parallel with |
|---|---|---|---|
| `01-phase-0-shared-errors.md` | 0 | `errors/index.ts`, `index.ts` comment | nothing (must land first) |
| `02-track-a-inbound.md` | 1 | `cctp-message.ts`, `receive.ts`, `trustline/index.ts`, `replay/index.ts` | B, D, E |
| `03-track-b-evm-registry.md` | 1 | `evm/burn.ts`, `evm/hook.ts`, `domains/index.ts` | A, D, E |
| `04-track-d-soroban.md` | 1 | `forwarder/index.ts` | A, B, E |
| `05-track-e-docs.md` | 1 | spec, `README.md`, `docs/`, `apps/docs/` | A, B, C, D |
| `06-track-c-iris.md` | 2 | `attestation/index.ts`, `config.ts` | E |
| `07-integration-and-gate.md` | 3 | cross-track wiring, test fixtures | nothing (must land last) |

Wave 1 runs A, B, D, E concurrently — four agents, zero shared files. Wave 2 adds C after A and D are merged, because C changes the `AttestationClient` constructor contract that shared test fixtures depend on. Wave 3 wires the cross-track seams and runs the full gate.

---

## Why this split is parallel-safe

Every source file is owned by exactly one phase. The only file edited by more than one phase is `errors/index.ts`, which phase 0 takes exclusively so no later phase needs to touch it. The seams between tracks are carried by pre-agreed signatures in the "Cross-track contracts" section below, not by shared edits.

Two source files are touched by two phases only through **test fixtures**, never source: `receive.test.ts` (track A owns it) and `attestation.test.ts` (track C owns it). Phase 7 reconciles fixtures after both land.

## Wave plan

```
Wave 0   Phase 0 (shared error surface)                    sequential, ~20 min
Wave 1   Track A  Track B  Track D  Track E                parallel
Wave 2   Track C (Iris)                                    after A + D merged
Wave 3   Integration + full gate                           after all
```

Why C waits: it removes the constructor's implicit mainnet fallback (`new AttestationClient({})` starts throwing) and rebuilds `config.ts` host resolution. Tracks A and D both construct clients through `createAnchorCCTP`, so their fixtures must be final before C rewrites the requirement. C's own functional work (retry policy, budget, host binding) does not depend on A or D code and could technically start in wave 1 if the executor accepts fixture churn.

## Global constraints

- TDD: failing test first, confirmed red, then minimal implementation. Never weaken an existing assertion to unblock a change.
- Money math stays `bigint`. No float on any amount or fee path.
- No new runtime dependencies. `@stellar/stellar-sdk` 13.3.0 and `viem` 2.56.5 stay exact-pinned.
- Public API additions flow through `packages/core/src/index.ts`; internal modules stay internal.
- No `console.log` in `packages/core/src` or `packages/cli/src`.
- `core` coverage ≥ 90% lines. Baseline: 92.9% statements / 88.5% branches / 94.1% functions.
- Per-task gate: `npm run lint && npm run typecheck`, then the focused jest file.
- Commit style: `type: imperative summary`, no co-author trailer.
- Runtimes confirmed green at program start: `npm run lint`, `npm run typecheck`, 11 suites / 194 tests.

## Source baseline (verified 2026-11-08)

| Reference | Exact location read | Correction vs old spec |
|---|---|---|
| Canonical V2 | `circlefin/evm-cctp-contracts` `src/v2/*.sol`, `src/messages/v2/*.sol`, `docs/abis/cctp/v2/TokenMessengerV2.json` | `contracts/v2` does not exist; commit `a92a2b4` |
| Stellar Soroban | `circlefin/stellar-cctp` `contracts/cctp-forwarder/src/`, `contracts/message-transmitter-v2/src/`, `contracts/token-messenger-minter-v2/src/` | `CctpForwarder.rs` does not exist; commit `45746f2` |
| Orchestration | `circlefin/cctp-go` `client.go`, `chains.go`, `transfer.go`, `internal/config/config.go` | no `client/` directory, no `iris.go` |
| Operational | Circle docs pages listed in `05-track-e-docs.md` | `/cctp/supported-domains` and `/cctp/v2` are 404 |

## Cross-track contracts (agreed in phase 0, consumed unchanged)

These signatures are the seams. A track may not change one unilaterally; changing one requires editing this file first.

```typescript
// errors/index.ts (phase 0) — added once, used by C and D
export class AttestationRequestError extends AnchorCCTPError {
  constructor(readonly status: number, readonly retryAfterMs?: number);
}
export class MintFailedError extends AnchorCCTPError {
  constructor(burnTxHash: string, reason?: string, readonly contractCode?: number);
}

// cctp-message.ts (track A) — consumed by A only
export const MIN_MESSAGE_BYTES = 376;
export interface DecodedCctpMessage {
  version: number; sourceDomain: number; destinationDomain: number; nonce: string;
  sender: string; recipient: string; destinationCaller: string;
  minFinalityThreshold: number; finalityThresholdExecuted: number;
  burnVersion: number; burnToken: string; mintRecipient: string;
  amount: bigint; messageSender: string; maxFee: bigint; feeExecuted: bigint;
  expirationBlock: bigint; hookData: string; hookRecipient?: string;
}
export function decodeCctpMessage(hex: string): DecodedCctpMessage;

// attestation/index.ts (track C) — consumed by A through ReceiveContext only
pollAttestationByTx(sourceDomain: number, txHash: string,
  onPoll?: (attempt: number, elapsedMs: number) => void,
  opts?: { expectedDestinationDomain?: number }): Promise<AttestationResult>;

// forwarder/index.ts (track D) — optional transport extension
interface SorobanTransport {
  getAccountSequence?(address: string): Promise<string>;
  restoreFootprint?(xdr: string): Promise<string>;
}
```

`AttestationResult` keeps its existing `finalityThresholdExecuted?: number` and `delayReason?: string | null` fields; track A reads them without asking C for changes.

## Exit criteria for the program

1. All phase files report their local gate green.
2. `npm run lint && npm run typecheck && npm run test -- --coverage` on `main` passes with statements ≥ 90%.
3. The five Review Focus behaviors in `07-integration-and-gate.md` have passing tests naming them.
4. The design spec has zero citations that 404 and zero claims contradicted by the audited sources.
