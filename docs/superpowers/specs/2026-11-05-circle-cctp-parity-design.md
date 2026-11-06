# Circle CCTP Official-Parity Specification for Stellar
Status: proposed | Date: 2026-11-05 | Scope: CCTP V2 USDC parity on Stellar (Domain 27)

## 1. Scope and Goals
Define normative mappings from Circle CCTP V2 protocols to AnchorCCTP on Stellar.
Enforce bidirectional burn/attest/mint, forwarder contract rules, and decimal scaling.

## 2. Official Source Matrix
| Source | Repository / Reference | Protocol Role |
|---|---|---|
| Canonical V2 | `circlefin/evm-cctp-contracts` (contracts/v2) | Wire message, header, nonces, burn/mint |
| Stellar Soroban | `circlefin/stellar-cctp` (contracts/cctp) | CctpForwarder, TokenMessenger, MessageTransmitter |
| Orchestration | `circlefin/cctp-go` (client/iris.go, chains.go) | Iris client, polling backoff, fee parsing |
| Operational | Circle Developer Docs (cctp/v2, supported-domains) | Finality, domain 27, fee tables, Iris endpoints |

## 3. Protocol Invariants to Preserve
- `INV-1` Domain allowlist: source/dest validated against registry (`circlefin/cctp-go` chains.go).
- `INV-2` Replay protection: burnTxHash and message nonces must be idempotent (`evm-cctp` MessageTransmitter.sol).
- `INV-3` Cryptographic attestation: Iris signature verified before settlement (`stellar-cctp` MessageTransmitter).
- `INV-4` Integer math: decimal scaling strictly integer BigInt; zero/negative rejected (`cctp-go` math).
- `INV-5` Message parsing: amount @ byte 216, fee @ byte 312 (uint256 BE, 32-byte fields) (`evm-cctp` BurnMessage.sol).

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
  - Quickstart allows `minFinalityThreshold=1000` (Fast); capability matrix marks N/A. Fallback to 2000 required.

## 5. Mapping to AnchorCCTP Modules
| Module | Parity Responsibility | Official Parity Status |
|---|---|---|
| `domains/` | Domain 27, allowlist enforcement | Parity complete (`CCTP_DOMAINS[27]`) |
| `decimals/` | 6<->7 conversion, dust remainder | Parity complete (`convert6to7`, `convert7to6`) |
| `evm/hook.ts` | Forwarder hookData encoding | Parity complete (G..., C..., and M... support) |
| `evm/burn.ts` | Inbound depositForBurnWithHook | Parity complete (Fast/Standard tiers, fees) |
| `forwarder/` | `mint_and_forward` call, Soroban RPC | Parity complete (sim, sponsor, fee surge) |
| `attestation/` | Iris v2 `/v2/messages/` polling | Parity complete (backoff, rate limits, tier) |
| `replay/` | Crash-safe store, idempotency guard | Parity complete (`FileReplayStore`, status) |
| `stellar/burn` | Outbound Soroban `deposit_for_burn` | Gap: module missing; requires implementation |

## 6. Test and Acceptance Obligations
- `TEST-1` Domain checks: reject invalid domain IDs with `InvalidDomainError` (cite `domains/`).
- `TEST-2` Dust truncation: assert `convert7to6(10000009n)` yields `1000000n` + `9n` dust (cite `decimals/`).
- `TEST-3` Hook encoding: verify hex output for G..., C..., and M... strkeys (cite `evm/hook.ts`).
- `TEST-4` Forwarder safety: assert wrong `mintRecipient` throws before broadcast (cite `evm/burn.ts`).
- `TEST-5` Amount integrity: reject messages where byte 216 != caller amount (cite `cctp-message.ts`).
- `TEST-6` Replay idempotency: second `receive()` with same burnTxHash throws `ReplayTransferError` (cite `replay/`).
- `TEST-7` Attestation recovery: poll retries on transient 429/500 with exponential backoff (cite `attestation/`).

## 7. Non-Goals and Open Risks
- Non-goals: CCTP V1, Solana/EVM adapter hosting, non-USDC tokens, Iris private relayer hosting.
- Risk 1: Stellar Fast Transfer support upstream is undocumented; Iris may stall if fee executed < minFee.
- Risk 2: Stranded funds on misconfigured forwarder hook cannot be recovered by contract owner.
- Risk 3: Soroban state expiration on CctpForwarder storage instances requires periodic bump.

