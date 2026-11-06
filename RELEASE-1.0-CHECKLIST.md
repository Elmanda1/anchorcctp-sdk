# AnchorCCTP v1.0 Release Preparation Checklist & Parity Mission Brief

**Document Version:** 1.0.0  
**Date:** 2026-11-07  
**Repository:** [github.com/Elmanda1/anchorcctp-sdk](https://github.com/Elmanda1/anchorcctp-sdk)  
**Authors/Maintainers:** Falih (@Elmanda1) & Juen (@Dyjuen), Mother's Grace  
**Status:** Ready for Release Sign-Off  

---

## Part 1: Reply & Follow-Up to Circle CCTP Parity Mission (2026-11-05)

This section documents the resolution and delivery of the **Circle CCTP Official-Parity Spec for Stellar** requested on 2026-11-05.

### 1.1 Deliverables Summary

| Deliverable | Requirement | Delivered Artifact / Status | Evidence / Verification |
|---|---|---|---|
| **Parity Design Spec** | $\le 100$ lines, cite canonical sources, protocol invariants | [`docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md) | **Exactly 62 lines** ($\le 100$ lines). Cites `evm-cctp-contracts`, `stellar-cctp`, `cctp-go`, Circle Iris docs. |
| **Option A: Muxed & Contract Address Parity** | Support `M...` (69 char) and `C...` (56 char) in inbound hook & translation | [`packages/core/src/evm/hook.ts`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/packages/core/src/evm/hook.ts)<br>[`packages/core/src/forwarder/index.ts`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/packages/core/src/forwarder/index.ts) | Removed restriction on `med25519`. Encodes 69-char `M...` to 101 bytes. Passes Soroban `Address::from_string`. |
| **TDD Test Suite** | Failing tests first, unit + ABI round-trip coverage | [`packages/core/test/evm-hook.test.ts`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/packages/core/test/evm-hook.test.ts)<br>[`packages/core/test/forwarder.test.ts`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/packages/core/test/forwarder.test.ts) | 331 tests passing across 25 test suites. Line coverage **96.49%** (requirement $\ge 90\%$). |
| **Onchain Measurements** | Real testnet and mainnet measurements | [`docs/evidence/core-receive-sepolia.log`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/evidence/core-receive-sepolia.log)<br>[`docs/evidence/mainnet-e2e.md`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/evidence/mainnet-e2e.md) | Real Base $\to$ Stellar Pubnet settlement verified: Ledger `64734117`, burn `0x677376...`, mint `44b2a28...`, exact $\Delta = 1,000,000$ stroops. |

### 1.2 Protocol Invariants Preserved in v1.0

1. **Domain Isolation & Verification:**
   - Destination domain is strictly validated as `27` (Stellar CCTP v2).
   - Source domain checked against 26-domain allowlist (`packages/core/src/domains/index.ts`).
2. **Decimal Conversion & Dust:**
   - 6-decimal CCTP USDC amount $\times 10 \to$ 7-decimal Stellar stroops.
   - Truncated sub-stroop dust accounted for in burn flows; exact integer/BigInt arithmetic throughout.
3. **Inbound Forwarder Hook (`cctp-forward`):**
   - 32-byte header: `24 zero bytes | u32be version (0) | u32be length (L)` followed by `L` UTF-8 bytes.
   - For `G...` (Ed25519) and `C...` (Contract): $L=56$ (88 bytes total).
   - For `M...` (Muxed Ed25519): $L=69$ (101 bytes total).
4. **Replay Protection:**
   - Keyed on `(sourceDomain, burnTxHash)` in persistent KV/Redis store before executing mint.
5. **Fast Transfer / Iris Threshold Discrepancy:**
   - Documented in parity spec: Circle table lists Stellar Fast Transfer as N/A, yet Arc quickstart uses `minFinalityThreshold=1000`. AnchorCCTP supports configurable finality thresholds while defaulting safely to standard.

---

## Part 2: Release 1.0 GitHub Preparation Checklist

Use this checklist to ensure all code, governance, security, and release requirements meet the Definition of Done (PRD §12 & AGENTS.md) before publishing the GitHub Release.

### Phase 1: Code Quality & Security Gate

- [x] **Strict TDD Compliance:** Every feature in `core` and `cli` is backed by unit tests.
- [x] **Full Test Suite Passing:**
  - `packages/core`: 25/25 suites passed, 331/331 specs passed.
  - `packages/cli`: all commands verified with mock & recorded JSON tests.
- [x] **Coverage Threshold ($\ge 90\%$ lines):**
  - Statements: `95.61%`
  - Branches: `91.00%`
  - Functions: `93.52%`
  - Lines: **`96.49%`** ($\ge 90\%$ target achieved).
- [x] **Static Analysis & Linting:**
  - `npm run lint` — 0 errors, 0 warnings.
  - `npm run typecheck` — 0 errors across monorepo and scripts.
- [x] **Security Checklist (§2 AGENTS.md):**
  - [x] No private keys or sponsor secrets committed or logged.
  - [x] Signing delegated to user callbacks or explicitly injected env vars.
  - [x] Cryptographic attestation verified before settlement.
  - [x] Replay protection enforced prior to mint broadcast.
  - [x] BigInt/integer arithmetic only for decimals and fees (no float math).
  - [x] Negative, zero, or overflow values rejected with typed errors.
  - [x] Domain allowlist enforced; unknown domains rejected.
  - [x] USDC trustline auto-creation requires explicit opt-in flag with spending cap.
  - [x] Dependencies pinned; `npm audit` reviewed and documented in `AUDIT-WAIVERS.md`.

---

### Phase 2: Monorepo Package Build & Artifacts

- [x] **Core SDK dual build (CJS + ESM):**
  - `packages/core/dist/index.js` (CommonJS)
  - `packages/core/dist/esm/index.js` (ES Module with `type: module` package.json)
  - `packages/core/dist/index.d.ts` (TypeScript declarations)
- [x] **CLI standalone build:**
  - `packages/cli/dist/index.js` executable with shebang (`#!/usr/bin/env node`).
  - Executable permissions verified.
- [x] **Clean Workspace:**
  - Temporary scratch scripts deleted.
  - FigCraft / UI branding scratch files removed.
  - Git working tree clean (`git status` shows nothing to commit).

---

### Phase 3: GitHub Release Deliverables & Assets

- [ ] **1. Create Annotated Git Tag:**
  ```bash
  git tag -a v1.0.0 -m "Release v1.0.0 — AnchorCCTP SDK & CLI"
  git push origin v1.0.0
  ```
- [ ] **2. Publish GitHub Release:**
  - **Tag:** `v1.0.0`
  - **Target:** `main`
  - **Release Title:** `AnchorCCTP v1.0.0 — One-Call Cross-Chain USDC for Stellar Anchors`
  - **Release Notes:** (See template in §Part 3 below)
- [ ] **3. Verify NPM Packages:**
  - `@anchor-cctp/core-sdk` published and installable: `npm i @anchor-cctp/core-sdk`
  - `@anchor-cctp/cli` published and runnable: `npx @anchor-cctp/cli --version`
- [ ] **4. Attach Build Tarballs / Checksums:**
  - `anchor-cctp-core-sdk-1.0.0.tgz` + SHA256 checksum
  - `anchor-cctp-cli-1.0.0.tgz` + SHA256 checksum

---

### Phase 4: Ecosystem & Verification Links Audit

- [x] **SEP-CCTP Specification:**
  - PR opened against Stellar Protocol: [github.com/stellar/stellar-protocol/pull/2031](https://github.com/stellar/stellar-protocol/pull/2031)
  - Specification text maintained in [`docs/SEP-CCTP.md`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/SEP-CCTP.md).
- [x] **Live Stellar TOML:**
  - Mainnet `stellar.toml` deployed carrying `[CCTP]` table: [https://anchorcctp.dev/.well-known/stellar.toml](https://anchorcctp.dev/.well-known/stellar.toml)
- [x] **Live Demo Portal:**
  - Interactive portal live at [https://anchorcctp.dev](https://anchorcctp.dev)
- [x] **Walkthrough Video:**
  - 5-minute mainnet walkthrough video: [https://youtu.be/AekuzV29POY](https://youtu.be/AekuzV29POY)
- [x] **Evidence Index:**
  - Complete proof records cataloged in [`docs/evidence/README.md`](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/evidence/README.md).

---

## Part 3: GitHub Release v1.0.0 Notes Template

*Copy-pasteable draft for the GitHub Release description:*

```markdown
# AnchorCCTP v1.0.0 — Production Release

AnchorCCTP provides open-source TypeScript SDKs and CLI tooling that allow Stellar anchors and applications to accept USDC from any Circle CCTP-connected blockchain with a single `receive()` function call.

## What's Included in v1.0.0

- **`@anchor-cctp/core-sdk` (v1.0.1+):**
  - Single `receive()` orchestrator: polls Iris attestation, verifies cryptographic signatures, handles replay protection, and executes Soroban forwarder settlement.
  - Multi-chain StrKey translation: Supports `G...` (Ed25519), `C...` (Contract), and `M...` (Muxed) Stellar recipient addresses.
  - Precise decimal & dust handling: Exact 6-decimal (EVM/CCTP) to 7-decimal (Stellar) scaling with zero float rounding errors.
  - Opt-in, spend-capped USDC trustline creation.
  - 96.49% line coverage with 331 automated tests.

- **`@anchor-cctp/cli` (v1.0.2+):**
  - Scriptable terminal commands with valid JSON on `stdout`:
    - `anchor-cctp init`: Interactive project scaffolder for anchor backend integration.
    - `anchor-cctp listen`: Real-time cross-chain CCTP transfer listener.
    - `anchor-cctp verify`: CLI verification tool for Iris attestation and Soroban mint status.
    - `anchor-cctp domains`: Inspect supported chain domains and addresses.

- **Circle CCTP Parity Design Specification:**
  - Official specification mapping Circle CCTP invariants to Stellar (`docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md`).

- **SEP-CCTP Protocol Proposal:**
  - Official proposal to standardize the `[CCTP]` `stellar.toml` schema and `mint_and_forward` contract interface ([stellar-protocol PR #2031](https://github.com/stellar/stellar-protocol/pull/2031)).

## Verification & Onchain Evidence

- **Mainnet Settled Transfer:** [docs/evidence/mainnet-e2e.md](docs/evidence/mainnet-e2e.md)
  - Base Burn: `0x6773768a20c384bd5fdfda150d5e4892082f36595b2485da881c15eedc1ddc81`
  - Stellar Mint: `44b2a28a7497528a48a69a0e311ff9e3a82c537ba70295385bec661bf44a59c5`
  - Balance Delta: Exact `1,000,000` stroops credited on Stellar Pubnet (Ledger `64734117`).

## Quickstart

```bash
# Install Core SDK
npm install @anchor-cctp/core-sdk

# Or run the CLI
npx @anchor-cctp/cli domains
```

```typescript
import { receive } from '@anchor-cctp/core-sdk';

const result = await receive({
  sourceDomain: 6, // Base
  burnTxHash: '0x...',
  stellarAccount: 'G...',
  signer: myStellarSigner,
});
console.log('Settled mint transaction:', result.mintTxHash);
```

## Useful Links
- Documentation: [https://anchorcctp.dev](https://anchorcctp.dev)
- Walkthrough Video: [https://youtu.be/AekuzV29POY](https://youtu.be/AekuzV29POY)
- SEP PR: [stellar/stellar-protocol#2031](https://github.com/stellar/stellar-protocol/pull/2031)
```

---

## Part 4: Sign-Off Record

| Role | Name | Status | Timestamp |
|---|---|---|---|
| Core Architect | Juen (@Dyjuen) | **Approved** | 2026-11-07 |
| Lead Developer | Falih (@Elmanda1) | **Approved** | 2026-11-07 |
| Security Reviewer | Mother's Grace Team | **Passed** | 2026-11-07 |
| Milestone Status | SCF / Instaward Scope | **Complete (DoD Verified)** | 2026-11-07 |

