# Scope of Work — Statement of Completion (aligned to code + evidence)

**Builder:** Falih (@Elmanda1) & Juen (@Dyjuen), Mother's Grace
**Program:** Stellar Chapter Ambassador Indonesia Instaward
**Repo:** https://github.com/Elmanda1/anchorcctp-sdk
**Site:** https://anchorcctp.dev
**Packages:** `@anchor-cctp/core-sdk@1.0.1`, `@anchor-cctp/cli@1.0.2`
**Date:** 2026-10-02
**Ground truth:** package source under `packages/`, evidence index at `docs/evidence/README.md`
(L01–L15). Where this statement and an older artifact disagree, code + evidence index win.

## In-Scope Deliverables

| Deliverable | Description | Status | Proof |
|---|---|---|---|
| Deliverable 1: Core SDK (`@anchor-cctp/core-sdk`) | TypeScript npm package exposing `AnchorCCTP.receive(params)`, which drives one inbound CCTP transfer to USDC on a Stellar account. It polls Circle Attestation API **V2** (`pollAttestationByTx`, `GET /v2/messages/{domain}?transactionHash=0x…`) with configurable retry/backoff; converts CCTP 6-decimal USDC to Stellar 7-decimal stroops with integer BigInt math (`×10n`, dust `0n` by construction on the exact 6→7 path; dust routing exists for the 7→6 direction / sub-unit remainders) to a configurable dust-collector address; decodes EVM 20/32-byte addresses to Stellar `G…` via pure `translateToStellar` and submits mint through the Soroban forwarder (`submitMint`, `mint_and_forward`); inspects missing USDC trustline and creates it only with explicit opt-in (`allowCreation`, default `false`) under `spendCapXlm`; maps **30 CCTP domains total (29 source chains + Stellar 27)** in `CCTP_DOMAINS`; emits **four** typed lifecycle events — `onReceiving`, `onSettled`, `onDustCollected` (only when `dust > 0n`), `onError`. Ships TypeScript declarations, unit tests at **core 96.48% lines / 91.49% branches** (31 suites, 364 specs combined; CLI 100% lines / 94.07% branches), README quickstart. | Complete, one named caveat | Repo: anchorcctp-sdk · npm: https://www.npmjs.com/package/@anchor-cctp/core-sdk · Coverage output `npm test -- --coverage`: L01 · Settlement verification record (Base Sepolia → Stellar testnet, re-derived from public APIs, **not** single-`receive()` stdout; end-user credit **not** evidenced): L02 |
| Deliverable 2: CLI (`@anchor-cctp/cli`) | Node.js CLI wrapping core SDK. Programmatic data → JSON on stdout; diagnostics → stderr; failures → structured `{ error, code, remediation }` + nonzero exit. `init` generates `stellar.toml` CCTP block (`--domain`, `--usdc-issuer`, `--forwarder`, `--dust-collector` optional — `DUST_COLLECTOR_ACCOUNT` omitted unless flag passed, `--output`, `--force`); `listen <address>` streams NDJSON (recorded run uses `--simulate`, i.e. output-shape evidence, not live CCTP stream; live path is a Horizon effects stub); `verify <txHash>` returns Iris attestation status for a burn (`attested`, `status`, `sourceDomain`, `destinationDomain`, `attestation`/`message`); `domains` lists supported domains with chain names + IDs. | Partial (shape + stub gaps named) | npm: https://www.npmjs.com/package/@anchor-cctp/cli · `init` recording: L04 · `listen --simulate` recording: L05 · `domains` recording + table: L03 · `verify` recording: L06 · JSON + error branches (log predates 1.0.2, stale `init` block + placeholder verify hash — re-record owed): L07 |
| Deliverable 3: Demo anchor + SEP-CCTP proposal | Demo anchor on mainnet at anchorcctp.dev with `stellar.toml` advertising CCTP deposits (mainnet issuer `GA5ZSE…`, forwarder `CBZL2I…`, source scope `[0, 6]` Ethereum + Base, funded dust collector `GAM2LT…`; `/api/config` + `/api/fees` healthy). Freighter web UI covers: wallet connection, balance + network badge, **external** burn-hash intake (paste `0x…`; no in-UI EVM burn signing), attestation wait with cancel/retry, server-side settle receipt (mint output, dust sweep, Stellar tx link), rejected-signing / insufficient-XLM / network-mismatch paths via simulation dropdown. Source-chain burn + trustline `changeTrust` stay **external/manual** (no in-UI EVM burn, no Freighter trustline prompt). Public draft PR adds SEP-CCTP text to `stellar/stellar-protocol` (no SEP number assigned). Walkthrough video exists (4:09) covering testnet/simulated flow; it shows **no** mainnet settlement and **no** captured Freighter signing session. | Partial | Live URL: https://anchorcctp.dev · Deployment record: L08 · UI screenshots: deposit flow states L09 (connect, burn form, attesting, settled, 3 error states; cancelled + final-credit shots missing), docs site L10, balance/error panel L11 (Partial — manual browser rerun owed) · PR stellar-protocol #2031: L12 · Video (testnet/sim scope): https://youtu.be/jTVbVezrICM |

## Evidence of Completion (Required)

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1 | Repo, npm link, coverage report, settlement record | Public TypeScript source: anchorcctp-sdk. Live npm listing: `@anchor-cctp/core-sdk@1.0.1`. Coverage **core 96.48% lines / 91.49% branches** (combined 31 suites / 364 specs): L01. Verification record of two Base Sepolia burns (domain 6) attested `complete` by Circle Iris V2 and minted on Stellar testnet (domain 27) via `mint_and_forward`; minted 9,998,700 stroops = (1,000,000 − 130) × 10, confirming 6→7 conversion **on chain**. Explicitly **not** shown: end-user credit (`forward_recipient` = sponsor `GCX2EQX…`), single-`receive()` stdout, matching recorded-vs-settled destination: L02. |
| Deliverable 2 | npm package, terminal recordings, JSON examples | Published `@anchor-cctp/cli` (recordings at 1.0.1, `verify` at 1.0.2): npm. `init` → `stellar.toml` block (L04); `listen --simulate` → NDJSON shape with chain source, amount, status (L05 — simulated, not live); `domains` → full table, 30 entries (L03); `verify` → attestation for completed Base Sepolia burn (L06). JSON + error branches renewed 2026-10-02 on 1.0.2: current `CA66…` forwarder, 29 source domains, dust line only with `--dust-collector`, live `verify` (`attested: true`), three error branches each exit 1: L07. |
| Deliverable 3 | Mainnet URL, UI screenshots, PR link, demo video | Live demo anchor + working `stellar.toml`: anchorcctp.dev, record L08. UI screenshots: deposit flow L09 (9 states listed above; `ui-cancelled.png`, `ui-credit.png` missing), docs site L10, balance refresh + error panel L11 (Partial). Public SEP-CCTP PR (draft, open, awaiting maintainer review): stellar-protocol #2031, L12. 4:09 walkthrough video of testnet/simulated flow with Freighter connect: YouTube link below — **not** a mainnet-settlement demo. Mainnet E2E record: **not produced** (L13 is an empty template, cited nowhere as proof). |
| Overall | Completion summary doc + walkthrough video | One-page plain-language summary with gaps named: L15 (`docs/evidence/completion-summary.md`). 4:09 walkthrough: https://youtu.be/jTVbVezrICM. Full evidence package mapping every item to proof: L14 (`docs/evidence/README.md`). |

## Evidence Verification Checklist

| Deliverable | Present | Partial | Missing | Comments |
|---|---|---|---|---|
| Deliverable 1 | ☑ | | | L01 Real; L02 Real with named gap (no end-user credit, no `receive()` stdout). Filename says `sepolia` — means **Base Sepolia** (domain 6). |
| Deliverable 2 | | ☑ | | L03/L04/L06 Real; L05 shape-only (`--simulate`); L07 stale (pre-1.0.2, retired values) — re-record owed. |
| Deliverable 3 | | ☑ | | Portal + mainnet `stellar.toml` + API live (L08 Real); 9 UI states (L09 Real-as-screenshots, UI only); docs site (L10); balance/error panel Partial (L11); SEP PR open (L12); video testnet/sim scope. No in-UI EVM burn; no in-UI trustline `changeTrust` (Freighter-only wallet, external/manual by design); deployed scope Ethereum + Base `[0, 6]` while picker lists all sources — restrict picker or keep scope disclosed. `ui-cancelled.png` + `ui-credit.png` missing; mainnet E2E not run (builder decision). |

## Supporting Files

| Code | File | Link |
|---|---|---|
| L01 | Test coverage report | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/coverage.md |
| L02 | Cross-chain settlement record (Base Sepolia → Stellar testnet) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/core-receive-sepolia.log |
| L03 | CLI domains recording (GIF) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/cli-domains.gif |
| L04 | CLI init recording (GIF) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/cli-init.gif |
| L05 | CLI listen recording — `--simulate` shape only (GIF) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/cli-listen.gif |
| L06 | CLI verify recording (GIF) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/cli-verify.gif |
| L07 | CLI JSON output and error branches — renewed 2026-10-02 on 1.0.2 | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/cli-commands.log |
| L08 | Demo deployment and live stellar.toml | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/demo-deploy.md |
| L09 | Demo portal screenshots (9 states) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/ui-demo-portal.png (+ `ui-connect-prompt.png`, `ui-connected.png`, `ui-burn-form.png`, `ui-attesting.png`, `ui-settled.png`, `ui-err-rejected-signing.png`, `ui-err-insufficient-xlm.png`, `ui-err-network-mismatch.png` in same dir) |
| L10 | Documentation site screenshot | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/ui-docs-site.png |
| L11 | Demo UI balance refresh and error panel — Partial | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/ui-balance-refresh.md |
| L12 | SEP-CCTP pull request (draft, open) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/sep-pr-link.md |
| L13 | Mainnet E2E record — **absent** (empty template, never cite as proof) | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/mainnet-e2e.md |
| L14 | Evidence package index | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/README.md |
| L15 | Completion summary | https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/completion-summary.md |

Video: https://youtu.be/jTVbVezrICM (4:09, testnet/simulated flow).
Live demo: https://anchorcctp.dev · live toml: https://anchorcctp.dev/.well-known/stellar.toml.
SEP-CCTP PR: https://github.com/stellar/stellar-protocol/pull/2031.
npm: https://www.npmjs.com/package/@anchor-cctp/core-sdk · https://www.npmjs.com/package/@anchor-cctp/cli.
