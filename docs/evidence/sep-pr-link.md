# SEP-CCTP Protocol Pull Request Evidence

> Verification evidence for PRD §11 & §12 Deliverables (Deliverable 4: Draft SEP Document PR opened against `stellar/stellar-protocol`).

---

## 1. Pull Request Submission Details

| Field | Value |
|---|---|
| **Target Repository** | `stellar/stellar-protocol` |
| **Branch** | `Dyjuen:sep-cctp-inbound-deposits` |
| **File** | `ecosystem/sep_cctp_inbound_deposits.md` |
| **Pull Request Title** | `Draft SEP: CCTP inbound deposits for Stellar anchors` |
| **Pull Request URL** | `https://github.com/stellar/stellar-protocol/pull/2031` |
| **Status** | Open (Draft, SEP number To Be Assigned) |
| **Author** | Juen (`@Dyjuen`) |
| **Discussion** | `https://github.com/orgs/stellar/discussions/2032` (`[Pre-SEP] CCTP inbound deposits for Stellar anchors`) |

> Supersedes prior draft entry referencing `pull/1482`, which was an unrelated
> upstream PR (Protocol 21 CAPs, merged May 2024). The real submission is #2031.

---

## 2. PR Summary & Abstract

This pull request introduces a draft SEP standardizing how Stellar anchors ingest
cross-chain USDC via Circle CCTP: transfer lifecycle, 6-to-7 decimal conversion
in integer arithmetic, `stellar.toml` `[CCTP]` + `[[CURRENCIES]]` metadata,
Soroban `mint_and_forward` interface, replay/trustline guards.

### Key Components Introduced
1. **Metadata Standard**: `stellar.toml` `[CCTP]` and `[[CURRENCIES]]` extensions advertising forwarder addresses, domain registry compatibility, and dust policies.
2. **Decimal Alignment**: Exact 6-to-7 Stroop scaling (`*10n`), net-of-fee receipts, BigInt-only math.
3. **Soroban Forwarder Interface**: `mint_and_forward(message, attestation)` calling conventions; recipient inside message hook data.
4. **Security & Replay Protections**: `(sourceDomain, burnTxHash)` idempotency, `complete`-gated settlement, opt-in capped trustline creation.

---

## 3. Specification Artifact Reference

The full specification markdown submitted in this PR is mirrored in the AnchorCCTP SDK repository at:
- [`docs/SEP-CCTP.md`](../SEP-CCTP.md)
