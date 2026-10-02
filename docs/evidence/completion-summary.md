# AnchorCCTP SDK — Instaward Completion Summary

**Builder:** Falih (@Elmanda1) & Juen (@Dyjuen), Mother's Grace
**Program:** Stellar Chapter Ambassador Indonesia Instaward
**Repo:** github.com/Elmanda1/anchorcctp-sdk · **Site:** anchorcctp.dev
**Packages:** `@anchor-cctp/core-sdk` (1.0.1), `@anchor-cctp/cli` (1.0.2) on npm
**Date:** 2026-10-02

## What AnchorCCTP is

AnchorCCTP is an open-source TypeScript SDK, CLI, and demo anchor that lets a Stellar
anchor accept USDC from any Circle CCTP-connected chain with a single `receive()` call.
It absorbs the friction an anchor would otherwise reimplement by hand: 6-decimal CCTP
USDC → 7-decimal Stellar stroops with sub-stroop dust routing, EVM 32-byte address →
Stellar `G…` translation through Circle's forwarder contract, Circle Iris attestation
polling with cryptographic verification, replay protection keyed on
`(sourceDomain, burnTxHash)`, and opt-in, spend-capped USDC trustline creation. A draft
SEP ([`docs/SEP-CCTP.md`](../SEP-CCTP.md)) standardises the `[CCTP]` `stellar.toml`
block and the `mint_and_forward` interface.

## Deliverables against the SOW

| Deliverable | Status | Evidence |
|---|---|---|
| D1 — Core SDK (`@anchor-cctp/core-sdk`), single `receive()` API | **Done** | npm package; coverage ([L01](coverage.md)); testnet settlement record ([L02](core-receive-sepolia.log)) |
| D2 — CLI (`@anchor-cctp/cli`): `init`, `listen`, `verify`, `domains` | **Done, two named gaps** | npm package; recordings [L03](cli-domains.gif)–[L06](cli-verify.gif); `listen` recorded with `--simulate` ([L05](cli-listen.gif)); error-branch log predates 1.0.2 ([L07](cli-commands.log)) |
| D3 — Demo anchor, Freighter UI, SEP-CCTP PR, walkthrough video | **Partial** | Portal + docs live ([L09](ui-demo-portal.png), [L10](ui-docs-site.png)); live `stellar.toml` carries mainnet values ([L08](demo-deploy.md)); SEP PR [L12](sep-pr-link.md); 4:09 walkthrough video. Mainnet E2E not produced ([L13](mainnet-e2e.md)); settle API unhealthy; cancelled/credit shots pending |
| Overall — completion summary + walkthrough video | Summary: this document. Video: [walkthrough](https://youtu.be/jTVbVezrICM) | — |

## What "done" means here

Every claim maps to one numbered proof in [the evidence index](README.md), and each is
labelled **Real**, **Gap**, or **Partial** there. The testnet settlement is the strongest
item: two real USDC burns on Base Sepolia (domain 6) attested by Circle Iris as
`complete`, minted on Stellar testnet (domain 27) by the exact contract named as
`mintRecipient` in the CCTP message. The minted 9,998,700 stroops equal
`(1,000,000 − 130) × 10`, so the 6→7 decimal conversion is confirmed **on chain**, from
the forwarder's own `mint_and_forward` event — not from the target's claim of success.
Coverage ([L01](coverage.md), measured 2026-10-02) is 31 suites / 364 specs; core 96.48%
lines and 91.49% branches, CLI 100% lines and 94.07% branches. The published packages
were exercised as published: the CLI recordings run `npx @anchor-cctp/cli@1.0.1`
(`verify` at `1.0.2`), not a local build.

## What is deliberately not claimed

Consistent with the rest of the evidence package, this summary names its own gaps rather
than rounding them up:

- **Final credit to an end-user account is not evidenced.** The CCTP message's
  `mintRecipient` is Circle's forwarder contract, and the forwarder's `forward_recipient`
  is the demo's sponsor account. The recorded destination and the settled destination do
  not match; see [L02 §6](core-receive-sepolia.log).
- **No mainnet transfer.** An earlier `mainnet-e2e.md` contained a fabricated record;
  every identifier in it was checked on 2026-10-02 and none existed, so the contents were
  deleted. What the mainnet leg must prove and how a reviewer checks it is specified in
  [the handoff brief](mainnet-e2e-handoff.md).
- **Open:** no mainnet transfer (skipped by builder decision), no cancelled/credit screenshots.
- **`listen` is recorded with `--simulate`**, so its output shape is real but it is not a
  live Horizon stream ([L05](cli-listen.gif)).
- **No captured Freighter session, and no `receive()` runtime stdout.** [L02](core-receive-sepolia.log)
  is a verification record re-derived from public APIs, not the stdout of one `receive()`
  call. The SDK's own orchestration is covered by the test suite instead.
- **Not security-audited.** The SDK is provided as-is for integration acceleration
  (PRD §7.10).

## External links

- Walkthrough video: https://youtu.be/jTVbVezrICM ("Anchor CCTP SDK Walkthrough & Demo")
- Live demo anchor: https://anchorcctp.dev · live `stellar.toml`: https://anchorcctp.dev/.well-known/stellar.toml
- SEP-CCTP pull request (open, awaiting review): https://github.com/stellar/stellar-protocol/pull/2031
- Core SDK on npm: https://www.npmjs.com/package/@anchor-cctp/core-sdk
- CLI on npm: https://www.npmjs.com/package/@anchor-cctp/cli
- Full evidence package, mapping every claim to its proof: [docs/evidence/README.md](README.md)
