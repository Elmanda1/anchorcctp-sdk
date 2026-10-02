# Mainnet E2E Evidence — Handoff Brief

**Status: not yet produced.** This document explains what the mainnet evidence has to
prove, what the tooling does and does not give you, and how a reviewer will check the
result. It is written to be handed to whoever runs the mainnet leg.

Read this together with [`mainnet-e2e.md`](mainnet-e2e.md), the evidence slot you will
fill in, and [`core-receive-sepolia.log`](core-receive-sepolia.log), the testnet record
that already exists and shows the exact verification chain to reproduce.

---

## 1. What has to be proven

One completed CCTP v2 transfer: a USDC burn on a **mainnet** source chain, attested by
Circle, minted to **Stellar pubnet**, and credited to a Stellar account whose balance
delta you can measure.

"Credited to a Stellar account" is the part that needs care — see §3 and §7.

---

## 2. Do not reuse the current `mainnet-e2e.md`

Its contents are fabricated. Every identifier in it was checked on 2026-10-02:

| Claim in the file | Check | Result |
|---|---|---|
| Burn `0x3a4b7f8c…d3e4f5a6b` on Ethereum | `GET https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=…` | `Message not found for provided parameters` |
| Soroban tx `0x8e2b5c7d…e3f4a5b6c` | `GET https://horizon-testnet.stellar.org/transactions/8e2b5c7d…` | `404 Resource Missing` |
| Video `https://youtu.be/anchor-cctp-demo-walkthrough` | `GET https://www.youtube.com/oembed?url=…` | `400 Bad Request` — no such video |
| Destination `GBBD47IF…3ZLLFLA5` | StrKey decode | The **USDC issuer** account, not a user account |

It also claims *mainnet* while describing a flow with no mainnet identifiers anywhere.
Treat the file as a shape to fill, not a source of values.

---

## 3. Before you start: the trap that already caught the testnet run

On testnet, two real burns settled successfully — and the USDC still did **not** land
where the demo recorded it should.

The CCTP message's `mintRecipient` field is **Circle's forwarder contract**, not the
user's Stellar account:

- `mintRecipient` decoded to `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ`,
  a Soroban contract.
- That contract emitted `mint_and_forward` with
  `forward_recipient = GCX2EQXSPCHMBSEGYZRVTZWOIDRXWRWYEFRTCNVOZPYXE4QEFPKNUF3V`,
  the demo's **sponsor** account.
- The address the demo recorded as the destination, `GB2F4NE3YMIVJ…`, received nothing
  from CCTP. Its USDC arrived via `path_payment_strict_send` on the Stellar DEX.

So: **decide and confirm which account actually receives before you write a receipt.**
Do not assume the address you passed to the burn is the address that gets the USDC. On
testnet that assumption was wrong. Verify it on chain, then assert on the account you
verified.

---

## 4. What changes from testnet to mainnet

| | Testnet (`core-receive-sepolia.log`) | Mainnet |
|---|---|---|
| Network selector | `STELLAR_NETWORK` unset (defaults `testnet`) | `STELLAR_NETWORK=mainnet` |
| Attestation API | `https://iris-api-sandbox.circle.com` | `https://iris-api.circle.com` |
| Horizon | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| Soroban RPC | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` |
| USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (built-in default) | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (must be set explicitly) |
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| Source chain | Base Sepolia (chain id 84532) | A CCTP **mainnet** chain, e.g. Base (8453) or Ethereum (1) |
| Funding | friendbot | real funds |
| CCTP destination domain | 27 | 27 (domain IDs are the same on both networks) |

Values above are from [`apps/demo/.env.mainnet.example`](../../apps/demo/.env.mainnet.example).

> **Confirm the mainnet forwarder contract before use.** That file carries
> `VITE_FORWARDER_CONTRACT_ID=CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T`,
> but the equivalent testnet line was itself marked `BLOCKED: resolve canonical testnet
> forwarder` — and the value in core (`CA66Q2W…`) turned out to be correct on chain while
> the demo's `.env.testnet.example` had a different one. Check the mainnet contract
> against Circle's published CCTP addresses rather than trusting either file.

---

## 5. The existing script will refuse to run mainnet, on purpose

`scripts/testnet-auto.ts` is pinned to Base Sepolia and must stay that way:

- `chain` is built by spreading `baseSepolia` from `viem/chains` (line ~226).
- `EVM_CHAIN_ID` defaults to `84532` (line ~216).
- The `EVM_CHAIN_PIN` remediation string reads: *"Set EVM_CHAIN_ID=84532 +
  EVM_RPC_URL=https://sepolia.base.org; never mainnet."*

That is a deliberate safety gate, not an oversight. **Do not flip `EVM_CHAIN_ID` and
call it done** — the `chain` object would still describe Base Sepolia while the RPC
points elsewhere. Write a separate mainnet path (for example `scripts/mainnet-auto.ts`)
and leave the testnet script untouched.

The testnet script is still the right reference for the *shape* of the run:

```
env identity → fund check → forwarder liveness → trustline ensure (opt-in, capped)
→ receive() → balance-delta assert → receipt JSON on stdout
```

Replace the friendbot funding step and the chain pin; keep the rest.

---

## 6. Environment

`createAnchorCCTPFromEnv` reads these (`packages/core/src/testnet-config.ts`). Names are
identical on both networks — only the values change.

| Variable | Required | Notes |
|---|---|---|
| `STELLAR_NETWORK` | mainnet run | `testnet` \| `mainnet`, defaults to `testnet` |
| `STELLAR_DESTINATION` | yes | `G…` account. Also used as `sponsorAccount` (the mint tx source) |
| `STELLAR_SECRET` | yes, to submit | `S…`. **Must match `STELLAR_DESTINATION`** or startup throws |
| `USDC_ISSUER` | yes on mainnet | No mainnet default — `receive()` fails closed without it |
| `FORWARDER_CONTRACT_ID` | yes | `C…`. The signer refuses any XDR targeting a different contract |
| `HORIZON_URL` | yes | https, host must end in `.stellar.org` (or be `localhost`) |
| `SOROBAN_RPC_URL` | yes | https |
| `CIRCLE_ATTESTATION_BASE_URL` | yes | https, **mainnet** Iris. There is no cross-network default |
| `DUST_COLLECTOR_ADDRESS` | optional | `G…`. If set and ≠ destination, the delta assert subtracts the dust |
| `TRUSTLINE_ALLOW_CREATION` | optional | Defaults `false`; creating a trustline spends XLM |
| `SPEND_CAP_XLM` | optional | Finite, ≥ 0. Bounds the trustline reserve spend |

EVM side, if you burn from the script: `EVM_PRIVATE_KEY`, `EVM_RPC_URL`,
`EVM_CHAIN_ID`, `EVM_USDC_ADDRESS`, `EVM_MESSENGER_ADDRESS`, `EVM_TRANSFER_MODE`
(`fast` \| `standard`), `EVM_MAX_FEE`. `maxFee` is required and must not exceed
`--amount`; `planBurn` refuses to guess it.

Keep secrets out of the repo. `.env*` is gitignored; `parseTestnetConfig` actively
rejects secret-like keys and `S…` values if anyone tries to put them in a public config.

---

## 7. The receipt to produce

`testnet-auto.ts` prints this shape and exits non-zero unless the balance delta proves
out:

```json
{"settled":true,"txHash":"…","amount":"…","dust":"…","balanceBefore":"…",
 "balanceAfter":"…","delta":"…","burnTxHash":"0x…","sourceDomain":6,"destination":"G…"}
```

The assertion behind it is the strongest part of the evidence:

```
expected = dustCollectorSet && dustCollector !== destination
             ? stellarAmount - dust
             : stellarAmount
proven   = (balanceAfter - balanceBefore) === expected
```

This is what makes the record a *credit* proof rather than a *mint* proof. The testnet
record could not complete this step, which is exactly why it is flagged. Make sure the
account you measure in `before`/`after` is the one from §3.

`stellarAmount` must account for the CCTP fee. Verified on chain from the testnet run:

```
burn amount (6 dp)    1_000_000
less maxFee                 -130
net (6 dp)               999_870
× 10 → stroops         9_998_700     ← the mint_and_forward event reported exactly this
```

If the receipt asserts `amount × 10` without subtracting `maxFee`, it will not match.

---

## 8. Independent verification a reviewer will run

Reproduce all four legs. This is the chain the testnet record uses; the mainnet record
should be checkable the same way.

```bash
# 1. the burn exists on the source chain
curl -s -X POST https://mainnet.base.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x<burn>"]}'

# 2. Circle has attested it  (mainnet Iris, source domain in the path)
curl -s "https://iris-api.circle.com/v2/messages/<srcDomain>?transactionHash=0x<burn>"

# 3. the Stellar mint landed
curl -s "https://horizon.stellar.org/transactions/<stellarTxHash>"

# 4. the mint event, from Soroban RPC
curl -s -X POST https://soroban-mainnet.stellar.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getEvents","params":{"startLedger":<ledger>,"endLedger":<ledger+1>,"filters":[{"type":"contract"}],"pagination":{"limit":10000}}}'
```

Or via the CLI:

```bash
npx @anchor-cctp/cli@1.0.2 verify 0x<burn> --source-domain <srcDomain>
```

**Archive step 4 immediately.** Soroban RPC event retention is a rolling window (roughly
seven days on testnet). Once the ledger ages out, `getEvents` returns an empty set and
that leg stops being reproducible. Paste the decoded event into the record rather than
linking to a query that will rot.

Check the source-domain number in step 2's URL against the registry — run
`npx @anchor-cctp/cli@1.0.2 domains`. Domain IDs are not contiguous.

---

## 9. Acceptance checklist

- [ ] Burn transaction is `status: 0x1` on a CCTP **mainnet** chain, with the real
      receipt fields (block, timestamp, `to` = the CCTP TokenMessenger).
- [ ] Mainnet Iris returns `status: "complete"`, `cctpVersion: 2`, non-null `message`,
      and an attestation at least 131 bytes.
- [ ] The decoded message shows `destinationDomain = 27`, and `burnToken` = the USDC
      contract for that source chain.
- [ ] Stellar transaction is `successful: true` on **pubnet**, and emits
      `mint_and_forward` from the contract that appears as `mintRecipient` in the message.
- [ ] The minted stroops equal `(burnAmount − maxFee) × 10`.
- [ ] A balance-delta assert passes on an account you confirmed actually receives.
- [ ] Every identifier in the record is copy-pasteable into the §8 commands.
- [ ] No placeholder, sequential, or invented values anywhere in the file.

---

## 10. What to update when it lands

1. Replace the contents of [`mainnet-e2e.md`](mainnet-e2e.md) — keep the filename, it is
   linked from the evidence index, the repo README, and the docs site.
2. In [`README.md`](README.md) (this directory), change the **L13** row from
   *"Gap — do not cite"* to **Real**, with its how-to-verify command.
3. State plainly what the record does **not** prove, the way `core-receive-sepolia.log`
   §6 does. A reviewed record with a named limitation is worth more than one that claims
   everything.

---

## 11. Cost and risk

This leg moves real money. An approve plus a burn costs actual USDC for the transfer, a
CCTP fee (`maxFee`), gas on the source chain, and XLM for the Stellar side (base fee plus
a trustline reserve if the destination has no USDC trustline). Use a small amount — the
testnet run used 1.000000 USDC — and treat the sponsor key as production material.
