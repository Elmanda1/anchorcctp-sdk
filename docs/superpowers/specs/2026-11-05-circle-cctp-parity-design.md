# Circle CCTP Official-Parity Specification for Stellar
Status: proposed | Date: 2026-11-05 | Scope: CCTP V2 USDC parity on Stellar (Domain 27) | Reviewer: user

## 1. Scope and Goals
Define normative mappings from Circle CCTP V2 protocols to AnchorCCTP on Stellar.
Enforce bidirectional burn/attest/mint, forwarder contract rules, and decimal scaling.
Tie-break when sources differ: `evm-cctp-contracts` defines wire format and protocol
invariants; `circlefin/stellar-cctp` defines Stellar-side on-chain behavior.

## 2. Official Source Matrix
| Source | Repository / Reference | Protocol Role |
|---|---|---|
| Canonical V2 | `circlefin/evm-cctp-contracts` (contracts/v2) | Wire message, header, nonces, burn/mint |
| Stellar Soroban | `circlefin/stellar-cctp` (contracts/cctp) | CctpForwarder, TokenMessenger, MessageTransmitter |
| Orchestration | `circlefin/cctp-go` (client/iris.go, chains.go) | Iris client, polling backoff, fee parsing |
| Operational | Circle Developer Docs (cctp/v2, supported-domains) | Finality, domain 27, fee tables, Iris endpoints |

Circle-docs claims cite section names only; permanent URLs are an open question (§8).

## 3. Protocol Invariants to Preserve
- `INV-1` Domain allowlist: source/dest validated against registry (`cctp-go` chains.go). Test: TEST-1.
- `INV-2` Replay protection: burnTxHash and message nonces idempotent (`evm-cctp` MessageTransmitter.sol). Test: TEST-6.
- `INV-3` Attestation: SDK shape-checks message/attestation hex only; cryptographic signature
  verification runs on-chain in `stellar-cctp` MessageTransmitter during `mint_and_forward`. Test: TEST-7.
- `INV-4` Integer math: decimal scaling strictly integer BigInt; zero/negative rejected (`cctp-go` math). Test: TEST-2.
- `INV-5` Message parsing: amount @ byte 216, fee @ byte 312 (uint256 BE, 32-byte fields) (`evm-cctp` BurnMessage.sol). Test: TEST-5.

## 4. Stellar-Specific Behavior
- Domain & Version: Stellar domain is 27; V2 only (`circlefin/stellar-cctp` TokenMessenger.rs).
- Decimal conversion: Stellar USDC = 7 decimals; CCTP wire = 6 decimals.
  - Outbound (Stellar -> EVM): `cctpAmount = stroops / 10n`, `dust = stroops % 10n` (dust retained on source).
  - Inbound (EVM -> Stellar): `stroops = cctpAmount * 10n`, `dust = 0n` (exact scaling).
- Inbound Forwarder requirement (`circlefin/stellar-cctp` CctpForwarder.rs):
  - `mintRecipient` AND `destinationCaller` MUST equal forwarder contract ID.
  - `hookData` layout: 24 zero bytes + u32be version(0) + u32be len(L) + L bytes UTF-8 strkey.
  - Recipient must be valid StrKey (`G...`, `M...`, `C...`). Mismatches permanently strand funds.
- Forwarding Service / Fast Transfer disparity:
  - Circle Forwarding Service is N/A for Stellar; onchain CctpForwarder is required.
  - Quickstart passes `minFinalityThreshold=1000` (Fast); capability matrix marks N/A.
  - Decision: Standard (`minFinalityThreshold=2000`) is the required path. Fast (1000) stays
    exposed but is not claimed as supported until upstream documents Stellar finality tiers.

## 5. Mapping to AnchorCCTP Modules
| Module | Parity Responsibility | Evidence (local test) |
|---|---|---|
| `domains/` | Domain 27, allowlist enforcement (`CCTP_DOMAINS[27]`) | TEST-1, `domains.test.ts` |
| `decimals/` | 6<->7 conversion, dust remainder (`convert6to7`, `convert7to6`) | TEST-2, `decimals.test.ts` |
| `evm/hook.ts` | Forwarder hookData encoding (G..., M..., C...) | TEST-3, `evm-hook.test.ts` |
| `evm/burn.ts` | Inbound depositForBurnWithHook, Fast/Standard tiers, fees | TEST-4, `evm-burn.test.ts` |
| `forwarder/` | `mint_and_forward` call, Soroban RPC (sim, sponsor, fee surge) | TEST-8, `forwarder.test.ts` |
| `attestation/` | Iris v2 `/v2/messages/` polling (exponential backoff, finality tier) | TEST-7, `attestation.test.ts` |
| `replay/` | Crash-safe store, idempotency guard (`FileReplayStore`) | TEST-6, `replay.test.ts` |
| `trustline/` | USDC trustline gate and capped auto-create before credit | `trustline.test.ts` |
| `receive.ts` | Burn -> attest -> forwarder -> replay orchestration | `receive.test.ts` |
| `events/` | Settlement/mint event emission | `events.test.ts` |
| `cctp-message.ts` | Amount/fee parsing at fixed wire offsets | TEST-5, `cctp-message.test.ts` |
| `stellar/burn` | Outbound Soroban `deposit_for_burn` | **Gap: module missing**; TEST-9 blocked |

Coverage evidence is local test existence only; no external conformance evidence exists yet (§8).

## 6. Test and Acceptance Obligations
- `TEST-1` Domain checks: reject invalid domain IDs with `InvalidDomainError` (cite `domains/`).
- `TEST-2` Dust truncation: assert `convert7to6(10000009n)` yields `1000000n` + `9n` dust (cite `decimals/`).
- `TEST-3` Hook encoding: verify hex output for G..., C..., and M... strkeys (cite `evm/hook.ts`).
- `TEST-4` Forwarder safety: `planBurn` forces `mintRecipient` = `destinationCaller` = forwarder
  constant, so no caller-supplied recipient path exists; assert the forced equality (cite `evm/burn.ts`).
- `TEST-5` Amount integrity: reject messages where byte 216 != caller amount (cite `cctp-message.ts`).
- `TEST-6` Replay idempotency: second `receive()` with same burnTxHash throws `ReplayTransferError` (cite `replay/`).
- `TEST-7` Attestation recovery: poll retries non-200 responses and network drops with exponential
  backoff; local test covers the 500 case (cite `attestation/`).
- `TEST-8` Forwarder call: `mint_and_forward` XDR builds with forwarded hook recipient (cite `forwarder/`).
- `TEST-9` Outbound burn: `deposit_for_burn` on Stellar burns 6-decimal amount and retains dust
  (blocked until `stellar/burn` exists).

Acceptance: ≤100 lines; both directions covered; forwarder rules, hook layout, permanent-loss
mode covered; 7<->6 conversion with explicit dust rule; attestation and replay covered; every
invariant mapped to a module and test; non-goals and open questions explicit; no implementation
work performed under this mission.

## 7. Non-Goals and Open Risks
- Non-goals: CCTP V1, Solana/EVM adapter hosting, non-USDC tokens, Iris private relayer hosting.
- Risk 1: Stellar Fast Transfer support upstream is undocumented; Iris may stall if fee executed < minFee.
- Risk 2: Stranded funds on misconfigured forwarder hook cannot be recovered by contract owner.
- Risk 3: Soroban state expiration on CctpForwarder storage instances requires periodic bump.

## 8. Open Questions
1. What evidence is required before claiming "official parity"? Undefined; current status claims
   rest on local tests and code inspection only.
2. Permanent Circle docs URLs for finality/domain/fee claims are not recorded.
3. Outbound burn gap: implementation of `stellar/burn` is not authorized by this spec.
