# AnchorCCTP SDK Documentation Portal

Welcome to the comprehensive documentation directory for the AnchorCCTP SDK and CLI monorepo. This directory houses all protocol specifications, architectural designs, security reviews, developer guides, and verifiable onchain evidence.

---

## 📚 Documentation Index

```
docs/
├── README.md                      # Master documentation index (this document)
│
├── 🏛️ Specifications & Protocols
│   ├── SEP-CCTP.md                # Stellar Ecosystem Proposal: [CCTP] stellar.toml block & forwarder interface
│   ├── superpowers/specs/         # Circle CCTP Official-Parity Specification for Stellar (Domain 27)
│   └── LOGIC_PROOF.md             # System architecture, logic specifications, and formal mathematical proofs
│
├── 🛠️ Developer & Integration Guides
│   ├── api-reference.md           # Full TypeScript API reference for @anchor-cctp/core-sdk
│   └── migration-guide.md         # Migration guide for existing Stellar anchors
│
├── 🛡️ Security, Audits & Waivers
│   ├── SECURITY-REVIEW.md         # Comprehensive security review, threat matrix, and mitigations
│   └── AUDIT-WAIVERS.md           # Dependency audit waivers and rationale
│
├── 🚀 Release & Governance
│   ├── RELEASE-1.0-PREPARATION.md # Pre-release checklist, DoD sign-off, and GitHub release notes
│   └── proposals/                 # Original project proposals and grant SOW documentation
│
└── 🧪 Verification & Evidence
    └── evidence/                  # Verification proofs, testnet logs, mainnet records, and CLI artifacts
```

---

## 1. Specifications & Standards

| Document | Purpose | Audience |
|---|---|---|
| [**SEP-CCTP Specification**](./SEP-CCTP.md) | Standard draft submitted to `stellar/stellar-protocol#2031` standardizing the `[CCTP]` `stellar.toml` metadata block and Soroban forwarder contract standard. | Anchor Operators, Protocol Architects |
| [**Circle CCTP Parity Design**](./superpowers/specs/2026-11-05-circle-cctp-parity-design.md) | Official 62-line normative specification mapping Circle CCTP canonical patterns (EVM/Solana) to Stellar (Domain 27, 6-to-7 decimals, `CctpForwarder` hook encoding). | Core Developers, Protocol Reviewers |
| [**System Logic & Proofs**](./LOGIC_PROOF.md) | Architectural invariants, decimal scaling math proofs ($10^{-6} \to 10^{-7}$), and state machine definitions. | Security Auditors, System Engineers |

---

## 2. Developer & Integration Guides

| Document | Purpose |
|---|---|
| [**API Reference**](./api-reference.md) | Exhaustive API reference for `createAnchorCCTP`, `receive()`, event emitters (`onReceiving`, `onSettled`), error types, and client options. |
| [**Migration Guide**](./migration-guide.md) | Guide for existing Stellar anchors upgrading from legacy deposit rails (SEP-6 / SEP-24) or older manual bridge scripts to AnchorCCTP SDK. |

---

## 3. Security & Trust Architecture

| Document | Purpose |
|---|---|
| [**Security Review**](./SECURITY-REVIEW.md) | Threat modeling, cryptographic signature validation, replay attack mitigation, trustline spend cap limits, and attack trees. |
| [**Audit Waivers**](./AUDIT-WAIVERS.md) | Explicit justification and review for pinned dependencies and upstream audits. |

---

## 4. Release & Operations

| Document | Purpose |
|---|---|
| [**Release 1.0 Preparation**](./RELEASE-1.0-PREPARATION.md) | Complete pre-release quality gate, test coverage records, DoD verification, and copy-pasteable GitHub release notes template (mirrors root [`RELEASE-1.0-CHECKLIST.md`](../RELEASE-1.0-CHECKLIST.md)). |
| [**Instaward SOW Proposal**](./proposals/Instawards-SOW-Proposal.docx) | Archived project Statement of Work proposal. |

---

## 5. Verifiable Evidence Index

All verifiable claims, logs, and artifacts are cataloged in [**`docs/evidence/README.md`**](./evidence/README.md):
* **[Mainnet E2E Settlement Record](./evidence/mainnet-e2e.md):** Base to Stellar Pubnet settled transfer (Ledger `64734117`, exact $\Delta = 1,000,000$ stroops).
* **[Testnet Receive Log](./evidence/core-receive-sepolia.log):** Multi-hop CCTP testnet transfer execution record.
* **[CLI Commands Output](./evidence/cli-commands.log):** Deterministic JSON output verification for `init`, `listen`, `verify`, and `domains`.
* **[Test Coverage Report](./evidence/coverage.md):** 96.49% line coverage evidence across monorepo test suites.

