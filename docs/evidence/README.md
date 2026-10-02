# Evidence Index

Every claim in the report maps to one numbered proof below. File names are stable:
re-recording an artifact overwrites the file in place, so the links never change.
Dates and versions live inside each file and in git history.

Package versions covered: `@anchor-cctp/core-sdk@1.0.1`; `@anchor-cctp/cli@1.0.1` for
the `domains`, `init`, and `listen` recordings, and `@anchor-cctp/cli@1.0.2`
(published 2026-10-02) for `verify`. `1.0.2` fixes two defects in `1.0.1`: the version
banner was hardcoded to `v1.0.0`, and a successful `verify` exited `127` on Windows
with a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING), src\win\async.c`)
because `process.exit()` raced a pending `AbortSignal.timeout()` handle.

Status legend: **Real** = independently reproducible. **Gap** = the artifact exists
but does not yet support the claim; the gap is named in the status column.

## Deliverable 1 — Core SDK (`@anchor-cctp/core-sdk`)

| ID | Claim | Evidence | How to verify | Status |
|---|---|---|---|---|
| L01 | Test suite passes with the reported coverage | [coverage.md](coverage.md) | Run `npm test -- --coverage` at the repo root | **Real.** 31 suites, 364 specs; core 96.48% lines / 91.49% branches, CLI 100% lines / 94.07% branches |
| L02 | A cross-chain deposit reaches USDC on Stellar testnet | [core-receive-sepolia.log](core-receive-sepolia.log) | Follow section 7 of the file: Base Sepolia receipt, Iris lookup, Horizon transaction, Soroban `getEvents` | **Real, with one named gap.** Two burns settle to `mint_and_forward` on Stellar; the minted 9,998,700 stroops equals (1,000,000 − 130) × 10, confirming 6→7 conversion on chain. Final credit to an *end-user* account is not evidenced — the forwarder's `forward_recipient` is the sponsor `GCX2EQX…` |

## Deliverable 2 — CLI (`@anchor-cctp/cli`)

| ID | Claim | Evidence | How to verify | Status |
|---|---|---|---|---|
| L03 | `domains` lists supported CCTP domains with chain names and IDs | [cli-domains.gif](cli-domains.gif), [cli-commands.log](cli-commands.log) | Run `npx @anchor-cctp/cli@1.0.1 domains` in an empty directory and compare | **Real.** 30 domains, `0` ethereum → `37` X Layer, `27` stellar |
| L04 | `init` generates a CCTP block for `stellar.toml` | [cli-init.gif](cli-init.gif) | Run `npx @anchor-cctp/cli@1.0.1 init --domain 27 --usdc-issuer <G...> --output ./stellar.toml` | **Real.** Emits `cctp_domain`, `FORWARDER_ADDRESS`, `SUPPORTED_SOURCE_DOMAINS` (29 entries) |
| L05 | `listen` polls inbound transfers and logs source chain, amount, status | [cli-listen.gif](cli-listen.gif) | Run `npx @anchor-cctp/cli@1.0.1 listen <G...> --simulate --limit 2` | **Gap.** Output shape is real, but the run uses `--simulate`; this is not a live Horizon stream |
| L06 | `verify` returns the attestation for a burn | [cli-verify.gif](cli-verify.gif) | Run `npx @anchor-cctp/cli@1.0.2 verify 0xffaa63b3… --source-domain 6 --testnet` | **Real.** `attested: true`, `status: complete`, against a completed Base Sepolia burn |
| L07 | All commands emit schema-conforming JSON with `code` + `remediation` on error | [cli-commands.log](cli-commands.log) | Run `verify 0xabc`, `init --domain 9999`, `listen <G...> --limit abc`; each exits 1 | **Gap.** Real for `domains` and `init`; the log predates 1.0.2 and still carries a placeholder verify hash, so the error branches need a re-record |

## Deliverable 3 — Demo anchor & SEP-CCTP

| ID | Claim | Evidence | How to verify | Status |
|---|---|---|---|---|
| L08 | The demo portal is live and serves `stellar.toml` over HTTPS | [demo-deploy.md](demo-deploy.md) | Open https://anchorcctp.dev/.well-known/stellar.toml | **Real for the TOML.** Live file carries mainnet values (issuer `GA5ZSE…`, forwarder `CBZL2I…`, source domains `[0, 6]`, funded dust collector `GAM2LT…`). Caveat: `/api/*` returned `FUNCTION_INVOCATION_FAILED` at last check — static site + TOML live, settle API not yet healthy |
| L09 | The demo portal renders the deposit flow | [ui-demo-portal.png](ui-demo-portal.png), [ui-connect-prompt.png](ui-connect-prompt.png), [ui-connected.png](ui-connected.png), [ui-burn-form.png](ui-burn-form.png), [ui-attesting.png](ui-attesting.png), [ui-settled.png](ui-settled.png), [ui-err-rejected-signing.png](ui-err-rejected-signing.png), [ui-err-insufficient-xlm.png](ui-err-insufficient-xlm.png), [ui-err-network-mismatch.png](ui-err-network-mismatch.png) | Open https://anchorcctp.dev | **Real as screenshots of the UI.** Connect prompt, connected balances + network badge, burn form, attesting wait, settled receipt, and all three simulated error states. UI evidence only — not settlement proof; no captured Freighter signing session, no cancelled-state or final-credit shot yet |
| L10 | The documentation site is live | [ui-docs-site.png](ui-docs-site.png) | Open https://anchorcctp.dev/docs/overview/what | **Real as a screenshot of the live page** |
| L11 | The demo UI refreshes balances and surfaces real wallet errors | [ui-balance-refresh.md](ui-balance-refresh.md) | Run `npm run dev:demo`, connect Freighter, then exercise each error option | **Partial.** Real for typecheck, lint, test, and build; the manual browser steps still need a rerun |
| L12 | A SEP-CCTP draft is open against `stellar/stellar-protocol` | [sep-pr-link.md](sep-pr-link.md) | Open https://github.com/stellar/stellar-protocol/pull/2031 | **Real.** Open, authored by `@Dyjuen`. A draft *proposal*; GitHub reports it as a non-draft PR, so describe it as open, awaiting a maintainer's review |
| L13 | A mainnet transfer settles | [mainnet-e2e.md](mainnet-e2e.md) — template, not a record | — | **Not yet produced.** The fabricated contents were deleted on 2026-10-02; what remains is an empty template. What the mainnet leg has to prove, and how a reviewer checks it, is specified in [mainnet-e2e-handoff.md](mainnet-e2e-handoff.md) |
| L14 | The evidence package is indexed | this file | — | **Real** |
| L15 | A one-page completion summary exists, with its gaps named | [completion-summary.md](completion-summary.md) | Open the file; every claim links into this index | **Real.** Each claim maps to an L-item above; the gaps in this table are restated in it, not hidden |

## Not yet covered

| Deliverable item | Status |
|---|---|
| Freighter screenshots for cancelled wait and final USDC credit | Partially captured. L09 now holds connect, burn, attest, settled, and all three error states; `ui-cancelled.png` and `ui-credit.png` still missing |
| Walkthrough video (SOW asks 3–5 min demoing the mainnet workflow) | **Partially satisfied.** A 4:09 walkthrough exists — https://youtu.be/jTVbVezrICM ("Anchor CCTP SDK Walkthrough & Demo") — so the length is in range. It cannot demonstrate a mainnet settlement, because no mainnet transfer was run ([L13](mainnet-e2e.md)) |
| `receive()` runtime log produced by the SDK itself | L02 is a verification record re-derived from public APIs, not captured stdout of one `receive()` call |
| Mainnet end-to-end record | Not produced. The brief for the mainnet leg — what to prove, the environment, the `testnet-auto.ts` mainnet gate, and an acceptance checklist — is [mainnet-e2e-handoff.md](mainnet-e2e-handoff.md) |

## External links

| What | URL |
|---|---|
| Walkthrough video (4:09) | https://youtu.be/jTVbVezrICM |
| Live demo anchor | https://anchorcctp.dev |
| Live `stellar.toml` | https://anchorcctp.dev/.well-known/stellar.toml |
| SEP-CCTP pull request | https://github.com/stellar/stellar-protocol/pull/2031 |
| Core SDK on npm | https://www.npmjs.com/package/@anchor-cctp/core-sdk |
| CLI on npm | https://www.npmjs.com/package/@anchor-cctp/cli |
| Repository | https://github.com/Elmanda1/anchorcctp-sdk |

## Generated, not indexed

Everything in this directory is hand-checked evidence. Build and test output is
gitignored rather than committed — `coverage-report.html` (from `npm test -- --coverage`),
`testnet-auto.processed.json`, and `apps/demo/data/` (the demo's replay store, written
at runtime). GitHub renders `.html` as source anyway, so link [coverage.md](coverage.md)
for coverage figures.
