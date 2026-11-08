# Track E — Spec and Shipped Documentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Remove every claim the four audits disproved, replace section-name citations with resolvable URLs, and correct the shipped domain, finality, and host documentation.

**Wave:** 1. Runs concurrently with tracks A, B, D. No source files.
**Files owned:** `docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md`, `README.md`, `docs/PRD.md`, `docs/api-reference.md`, `apps/docs/**`.
**Preconditions:** none — the audit findings below are already verified, so this track does not wait for code.

**Rule:** this track may not add a claim unless the URL backing it is quoted in the task. Where the audit found the upstream sources disagree with each other, document the disagreement rather than picking a side silently.

---

### Task E1: Rewrite the design spec's source matrix

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md` §2

- [ ] **Step 1: Replace §2**

```markdown
| Source | Repository / Reference | Protocol Role |
|---|---|---|
| Canonical V2 | `circlefin/evm-cctp-contracts` (`src/v2/`, `src/messages/v2/`) | Wire message, header, nonces, burn/mint |
| Stellar Soroban | `circlefin/stellar-cctp` (`contracts/cctp-forwarder/src/`, `contracts/message-transmitter-v2/src/`, `contracts/token-messenger-minter-v2/src/`) | CctpForwarder, TokenMessenger, MessageTransmitter |
| Orchestration | `circlefin/cctp-go` (`client.go`, `chains.go`, `transfer.go`) | Iris client, polling backoff, fee parsing |
| Operational | Circle Developer Docs (see Sources, §8) | Finality, domain 27, fee tables, Iris endpoints |
```

Old paths `contracts/v2`, `client/iris.go`, `CctpForwarder.rs`, and `TokenMessenger.rs` do not exist; the audit confirmed each 404 or tree miss.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
git commit -m "docs(spec): correct the CCTP source matrix paths"
```

---

### Task E2: Correct the invariants

**Files:**
- Modify: design spec §3

- [ ] **Step 1: Rewrite INV-2 and INV-5**

```markdown
- `INV-2` Replay protection: the SDK keeps a local processed-`burnTxHash` store; authoritative
  nonce replay rejection is on-chain (`usedNonces` in `MessageTransmitterV2`, and
  `NonceAlreadyUsed` 6908 in `stellar-cctp`). Test: TEST-6.
- `INV-5` Message parsing: the SDK decodes the full `MessageV2` header (148 bytes) and
  `BurnMessageV2` body (228 bytes) and requires a 376-byte minimum; amount @ 216, fee @ 312,
  hook data @ 376. Test: TEST-5.
```

INV-3 stays as written (shape-check only, on-chain verification).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
git commit -m "docs(spec): state nonce replay and message length accurately"
```

---

### Task E3: Correct the Stellar behavior section

**Files:**
- Modify: design spec §4

- [ ] **Step 1: Replace the destinationCaller and permanent-loss claims**

```markdown
  - Circle's Stellar reference instructs senders to set both `mintRecipient` and
    `destinationCaller` to the forwarder. The forwarder validates only `mintRecipient`;
    `MessageTransmitter` permits a zero `destinationCaller` (any relayer). This SDK constructs
    both equal to the forwarder as deliberate hardening and offers no zero-caller mode.
  - A hook recipient that is a valid StrKey but not the intended account mints irrecoverably to
    that account. A structurally invalid frame (wrong mintRecipient, version, or domain) reverts
    before `mint_through_cctp` and consumes nothing, so it can be re-relayed with a corrected
    message. The two failure modes are not the same.
```

- [ ] **Step 2: Replace the Fast/Standard paragraph**

```markdown
- Forwarding Service / Fast Transfer:
  - Circle's Forwarding Service does not serve Stellar as a destination; the on-chain
    `CctpForwarder` is required for `G...`/`M...`/`C...` recipients.
  - Circle's capability table marks Fast `N/A` for Stellar in the **source** column, while Iris
    still quotes a `1000` tier for routes whose destination is Stellar (27) and the Soroban
    contracts implement the unfinalized path with a 500 floor. Both tiers are therefore real
    into Stellar. Upstream is internally inconsistent; the SDK defaults per source-chain
    finality metadata and lets callers pin either tier.
```

- [ ] **Step 3: Clarify hook magic bytes**

```markdown
  - `hookData` layout: 24 Circle-reserved zero bytes + u32be version(0) + u32be len(L) +
    L bytes UTF-8 strkey. Circle's Stellar reference requires all-zero reserved bytes; the
    forwarder contract itself does not read them.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
git commit -m "docs(spec): separate recoverable and unrecoverable forwarder failures"
```

---

### Task E4: Correct the module table and withdraw TEST-9

**Files:**
- Modify: design spec §5, §6

- [ ] **Step 1: Edit the table rows**

- `attestation/` → "Iris v2 `/v2/messages/` polling (status-aware retry, deadline, tier capture)", evidence TEST-7.
- `cctp-message.ts` → "Full `MessageV2`/`BurnMessageV2` decode at fixed offsets", evidence TEST-5.
- Delete the `stellar/burn` row.

- [ ] **Step 2: Replace TEST-9 and the acceptance line**

```markdown
Outbound Stellar→EVM burn is out of scope per `docs/PRD.md` §4.2. TEST-9 is withdrawn, not
blocked; no outbound module is planned under this spec.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
git commit -m "docs(spec): withdraw the out-of-scope outbound burn test"
```

---

### Task E5: Add the Sources section and resolve the open questions

**Files:**
- Modify: design spec §7, §8

- [ ] **Step 1: Replace §8 with sources, and fold remaining risk into §7**

```markdown
## 7. Non-Goals and Open Risks
- Non-goals: CCTP V1 (including V1-only domain 4 Noble), Solana/EVM adapter hosting,
  non-USDC tokens, Iris private relayer hosting, outbound Stellar→EVM burn.
- Risk 1: Circle's Fast-transfer documentation is internally inconsistent for Stellar; a
  Fast burn into Stellar may be degraded to Standard (`insufficient_fee`).
- Risk 2: A valid-but-wrong hook recipient mints irrecoverably; the SDK can only validate the
  frame against the caller's own parameters.
- Risk 3: An archived CctpForwarder instance requires a restore-footprint round trip before
  simulation succeeds.

## 8. Sources (verified 2026-11-08)
- Supported chains and domains: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- Finality: https://developers.circle.com/cctp/concepts/finality-and-block-confirmations
- Fees and maxFee buffer: https://developers.circle.com/cctp/concepts/fees
- Forwarding Service: https://developers.circle.com/cctp/concepts/forwarding-service
- Technical guide (Iris hosts, rate limits): https://developers.circle.com/cctp/references/technical-guide
- GET /v2/messages schema: https://developers.circle.com/api-reference/cctp/all/get-messages-v2
- Stellar reference: https://developers.circle.com/cctp/references/stellar
- Stellar contracts: https://developers.circle.com/cctp/references/stellar-contracts
- Contract addresses: https://developers.circle.com/cctp/references/contract-addresses
- Stellar↔Arc quickstart: https://developers.circle.com/cctp/quickstarts/transfer-usdc-stellar-arc
- Resolve a stuck attestation: https://developers.circle.com/cctp/howtos/resolve-stuck-attestation

## 9. Open Questions
1. What evidence is required before claiming "official parity"? Undefined; current status rests
   on local tests plus the audits recorded here.
```

- [ ] **Step 2: Check the line budget**

Run: `wc -l docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md`
If the ≤100-line cap is exceeded, record the exemption explicitly in §6 acceptance instead of deleting sources.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
git commit -m "docs(spec): cite permanent Circle sources and close resolved questions"
```

---

### Task E6: Correct the shipped domain table

**Files:**
- Modify: `apps/docs/domains/table.md`

- [ ] **Step 1: Edit**

- Remove the Noble row (`| 4 | noble | ... |`). Noble is V1-only and this SDK is V2-only.
- Add `| 8 | sui | Sui | Move |`.
- Change the count sentence to "31 CCTP V2 domain IDs (as of 2026-11-08)".
- Add notes: Arc (26) is testnet-only; BNB Smart Chain (17) is USYC-only per Circle's table.

- [ ] **Step 2: Verify**

Run: `grep -rn "30 mainnet\|23+ chains\|22 other chains\|30 live CCTP" README.md docs apps/docs packages/core/src`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/domains/table.md
git commit -m "docs: correct CCTP domain table and counts"
```

---

### Task E7: Correct finality, host, and quickstart documentation

**Files:**
- Modify: `apps/docs/core/attestation.md`
- Modify: `apps/docs/configuration/networks.md`
- Modify: `apps/docs/migration.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/PRD.md`
- Modify: `README.md`

- [ ] **Step 1: Finality timings**

Replace the blanket "1 to 3 min" and "5 to 15 minutes" claims with: Fast `~8–20 s`; Standard from Ethereum/L2 `15–19 min`; Standard from a Stellar source `1 block, ~5 s`. State that the default SDK budget is 25 minutes (`attestationTimeoutMs`).

- [ ] **Step 2: Backoff wording**

Remove "plus jitter" — the implementation has none and this plan does not add it.

- [ ] **Step 3: Network host behavior**

State: `network` selects the Iris host (`testnet` → `https://iris-api-sandbox.circle.com`, `mainnet` → `https://iris-api.circle.com`); an explicit mismatched host throws; there is no cross-network default.

- [ ] **Step 4: README quickstart**

Add `sourceSequence` and an explicit `networkPassphrase` to the snippet so it can submit. Note that `SorobanTransport.getAccountSequence` can supply the sequence. Add a short Sources list linking the §8 URLs.

- [ ] **Step 5: PRD counts**

Replace "23+ chains" / "22 other chains" with "31 CCTP V2 domain IDs (2026-11-08)" and link the supported-chains page.

- [ ] **Step 6: Verify and commit**

```bash
grep -rn "1 to 3 min\|jitter\|23+ chains" apps/docs README.md docs
git add apps/docs docs/PRD.md docs/api-reference.md README.md
git commit -m "docs: correct finality timings, Iris hosts, and chain counts"
```

---

## Exit criteria

- No design-spec citation points at a nonexistent path.
- INV-2 and INV-5 describe the implemented behavior.
- TEST-9 is withdrawn with the PRD citation.
- Every operational claim links a permanent Circle URL.
- No shipped doc names Noble as supported or claims jitter or 30 domains.
