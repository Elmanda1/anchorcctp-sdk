# Mainnet E2E Evidence — Template

> **Status: NOT YET PRODUCED.** This file is a template. It contains no results, and it
> must not be cited as evidence until every `<…>` below is replaced with a value copied
> from a real mainnet run.

## Why this file is empty

An earlier revision of this file contained a fabricated record. Every identifier in it
was checked on 2026-10-02 and none existed:

| It claimed | Check | Result |
|---|---|---|
| Burn `0x3a4b7f8c…d3e4f5a6b` on Ethereum | Circle Iris, domain 0 | `Message not found for provided parameters` |
| Soroban tx `0x8e2b5c7d…e3f4a5b6c` | Horizon testnet | `404 Resource Missing` |
| Video `youtu.be/anchor-cctp-demo-walkthrough` | YouTube oEmbed | `400 Bad Request` |
| Destination `GBBD47IF…3ZLLFLA5` | StrKey decode | The USDC **issuer** account, not a user account |

The contents were removed rather than corrected because correcting them requires a real
mainnet transfer, which has not been run. Everything that was there was invented.

## What to read before filling this in

**[`mainnet-e2e-handoff.md`](mainnet-e2e-handoff.md)** — the full brief: what must be
proven, how mainnet differs from the testnet run, the environment variables, the
`testnet-auto.ts` mainnet gate, the balance-delta assertion, and an acceptance checklist.

**[`core-receive-sepolia.log`](core-receive-sepolia.log)** — the completed testnet
record. It shows the exact verification chain this file should follow, and names its own
limitation honestly. Match that standard.

## Template

Replace each field. Delete this section's instructions once filled.

| Field | Value |
|---|---|
| Source chain | `<chain name>` (CCTP domain `<id>`) |
| Source burn tx | `<0x…>` |
| Burn block / timestamp | `<block>` / `<ISO 8601>` |
| Burn status | `<0x1>` |
| Destination Stellar account | `<G…>` — the account that actually received, verified on chain |
| Burn amount (6 dp) | `<base units>` |
| CCTP maxFee | `<base units>` |
| Net minted (7 dp) | `<stroops>` — must equal `(burn − maxFee) × 10` |
| Dust swept | `<stroops>` |
| Iris status | `<complete>` |
| Attestation length | `<bytes>` |
| Stellar mint tx | `<hash>` |
| Mint ledger / closed at | `<ledger>` / `<ISO 8601>` |
| `mint_and_forward` event | `<contract, amount, forward_recipient>` |
| Balance delta asserted | `<before → after>`, expected `<stroops>` |
| `settled` | `<true>` |

### Reproduction

```bash
# 1. burn receipt on the source chain
# 2. Circle Iris (mainnet):  https://iris-api.circle.com/v2/messages/<domain>?transactionHash=<burn>
# 3. Stellar mint:           https://horizon.stellar.org/transactions/<stellarTx>
# 4. mint event (Soroban RPC, archive the output — event retention is a rolling window)
```

### What this record does not prove

`<State the limitations, the way core-receive-sepolia.log section 6 does. At minimum: who
ultimately received the funds, and whether a single receive() call produced the whole
sequence.>`

---

Do not commit this file with any field left as `<…>`, and do not commit it with a value
that has not been pasted from a real API response.
