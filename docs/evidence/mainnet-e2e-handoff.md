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
| Soroban RPC | `https://soroban-testnet.stellar.org` | `https://mainnet.sorobanrpc.com` |
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
curl -s -X POST https://mainnet.sorobanrpc.com -H 'content-type: application/json' \
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

---

# 12. Run log — manual mainnet leg

**Method:** manual path, not `scripts/*`. Burns are submitted from the CCTP
`TokenMessengerV2` Write-as-Proxy tab on BaseScan; the claim is submitted from the
`anchorcctp.dev` portal. No local keys, no `STELLAR_SECRET`. This is a different route
from §5–§7 and produces a different receipt shape; the §8 verification commands still
apply unchanged.

**Status: in progress.** Destination `GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56`.

## 12.1 Step 1 — destination trustline: DONE, verified on chain

Not inferred from the wallet UI. Read from pubnet:

```bash
curl -s "https://horizon.stellar.org/accounts/GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56"
```

```
account exists: GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56
XLM: 3.6529092
USDC trustlines: 1
  issuer GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN  bal 0.0000000  limit 922337203685.4775807
signers: GBAWIK…w=1
```

Issuer matches the §4 mainnet value. Reserve: account + 1 trustline = 2 entries × 0.5 XLM
= 1.0 XLM locked, ~2.65 spendable, above the 1.0 XLM minimum.

## 12.2 Step 2 — recipient encoding: DONE, with a correction to §3

**§3's trap applies to this leg, and the obvious manual encoding walks straight into it.**

The intuitive reading is `mintRecipient` = the destination `G…` account as 32 raw bytes.
That is a *direct* mint, and it is **not** what this system does. `planBurn`
(`packages/core/src/evm/burn.ts:141`) binds all three recipient-ish arguments to the
forwarder contract:

```js
const fwd = contractStrkeyToBytes32(params.forwarderContractId);
return {
  mintRecipient:     fwd,                                          // forwarder, NOT the account
  destinationCaller: fwd,                                          // forwarder
  hookData: buildCctpForwarderHookData(params.stellarDestination), // the G… account lives here
};
```

Independent confirmation from the deployed bundle, which is configured
`VITE_NETWORK: mainnet` and whose only burn ABI entry is
`depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)` —
there is no four- or seven-argument `depositForBurn` in it at all:

```
VITE_FORWARDER_CONTRACT_ID: CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T
VITE_STELLAR_NETWORK_PASSPHRASE: Public Global Stellar Network ; September 2015
VITE_ATTESTATION_URL: https://iris-api.circle.com
```

So the correct encoding is two values, not one:

| | Value |
|---|---|
| `mintRecipient` | `0x72bd20ff2f8281801bb05b7c29179026933256fabafeb13e94efd8ddbcfcf291` (= forwarder `CBZL2IH…`) |
| `hookData` | `0x000000000000000000000000000000000000000000000000000000000000003847424157494b334541544344475a334c455147364241414c56583356345a3242545a4f334b3650325a463656534e484b55445252434f3536` |

`hookData` decodes as specified in `packages/core/src/evm/hook.ts:11` — 24 zero magic
bytes │ `u32be` version `0` │ `u32be` length `56` │ utf8 strkey:

```
total bytes : 88
magic[0:24]: 000000000000000000000000000000000000000000000000 (all zero: true)
version    : 0
length     : 56
payload    : GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56
```

**Record this as a live instance of §3.** The rejected encoding was
`0x41642b6404c433676b240de0800badf75e67419e5db579fac97d5934eaa0e311` — correctly
derived from the destination account, and wrong for this system. Had it been used with a
plain `depositForBurn`, the mint would have had no forward instruction attached, which is
the §3 failure mode exactly. Nothing was burned; no funds are at risk.

## 12.3 Step 3 — burn parameters: READY, not executed

Function is `depositForBurnWithHook` (8 args). Source: Base (`burnToken` = Base USDC).

| Field | Value |
|---|---|
| `amount` | `100000` (0.10 USDC) |
| `destinationDomain` | `27` |
| `mintRecipient` | `0x72bd20ff…fcf291` (§12.2) |
| `burnToken` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913` |
| `destinationCaller` | `0x72bd20ff…fcf291` (same as `mintRecipient`) |
| `maxFee` | `0` |
| `minFinalityThreshold` | `2000` |
| `hookData` | `0x0000…0038` + utf8 strkey (§12.2) |

Fee tier standard (`2000`) carries `maxFee` `0`. Circle's live quote for Base→Stellar at
`GET https://iris-api.circle.com/v2/burn/USDC/fees/6/27` on 2026-10-02:
`[{"finalityThreshold":1000,"minimumFee":1.3},{"finalityThreshold":2000,"minimumFee":0}]`.
Re-fetch before signing; the quote moves.

Two transactions, in order: `approve` on the USDC token for spender
`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, then the burn. BaseScan's Write-as-Proxy
targets a proxy; implementation is `0x555E272506C06e7E559d57418563742AFE363ec8`
(`src/v2/TokenMessengerV2.sol`).

### 12.3.1 Transaction 1 — `approve`: DONE, verified on Base

`0x403344ed0bba370dcb7d3a210e64741cb7ee8962a1379e45832b73b7ad9da79a`

Read from Base RPC (`eth_getTransactionReceipt`), not from the wallet UI:

```
status      : 0x1
blockNumber : 52080492
timestamp   : 2026-10-02T11:49:15.000Z
to          : 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913   (Base USDC)
from        : 0xedd1b3b72e41d16425075eabe699612fe22c0e63
logs        : 1
  topic0    : 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925  (Approval)
  owner     : 0xedd1b3b72e41d16425075eabe699612fe22c0e63
  spender   : 0x28b5a0e9c621a5badaa536219b3a228c8168cf5d   (TokenMessengerV2 proxy)
  value     : 0x186a0 = 100000                             (0.10 USDC, 6 dp)
```

Spender is the messenger proxy, not an arbitrary address. Allowance re-read after the
transaction confirms `0.1 USDC`. Pre-flight state at the same block: USDC `8.990579`,
ETH `0.000483511138169693`, Base gas price `0.006 gwei` — a 150k–400k gas burn costs
`0.0000009`–`0.0000024` ETH, so gas is not a constraint by roughly two orders of
magnitude.

Note the burn amount is `100000` (0.10 USDC), which sets the §7 arithmetic for this leg:
`net = (100000 − maxFee) × 10`. With `maxFee` `0` at threshold `2000`, expected minted
stroops = `1000000`.

## 12.4 Open blocker — portal connect returns nothing

`anchorcctp.dev` → `www.anchorcctp.dev` (308). The bundle is correctly pinned to mainnet
on all four settings listed in §12.2, so a network-mismatch explanation is **not**
supported by the bundle. Whatever it is, it reproduces as: click Connect, no visible
change, no address, no error text.

This blocks step 4 only. It does not block the burn. Unresolved as of this entry.

## 12.5 To fill when it lands

- [ ] Burn tx hash + receipt (`status: 0x1`, `to` = the messenger proxy)
- [ ] Mainnet Iris: `status: "complete"`, `cctpVersion: 2`, attestation ≥ 131 bytes
- [ ] Decoded message: `destinationDomain = 27`, `mintRecipient` = `0x72bd20ff…`, non-empty `hookData`
- [ ] Pubnet tx: `successful: true`, `mint_and_forward` emitted by `CBZL2IH…`
- [ ] Minted stroops = `(100000 − maxFee) × 10`
- [ ] **Balance-delta assert on `GBAWIK3…`** — the account §12.2 proves is the forward target, not the address passed to the burn (§3)
- [ ] Soroban `getEvents` output archived verbatim (§8, ~7-day retention)

## 12.6 Transaction 2 — the burn: DONE, verified on Base

`0x6773768a20c384bd5fdfda150d5e4892082f36595b2485da881c15eedc1ddc81`

Source chain **Base** (CCTP domain 6), function `depositForBurnWithHook`, submitted from
the BaseScan Write-as-Proxy tab of `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.

```
status       : 0x1
blockNumber  : 52081113
timestamp    : 2026-10-02T14:32:53Z
from         : 0xedd1b3b72e41d16425075eabe699612fe22c0e63
to           : 0x28b5a0e9c621a5badaa536219b3a228c8168cf5d   (TokenMessengerV2 proxy)
gasUsed      : 113084
logs         : 5
  0x833589…2913  Transfer              (USDC in)
  0x833589…2913  Burn                  (USDC destroyed)
  0x833589…2913  Transfer
  0x81d40f21…4b64  MessageSent         (MessageTransmitterV2)
  0x28b5a0e9…cf5d  DepositForBurn
```

### 12.6.1 The message, decoded from the burn itself

Derived from the `MessageSent` event in the burn receipt, **not** from Iris — so this leg
is verifiable even while the attestation is still pending. 464 bytes total: a 148-byte
header, a 228-byte burn body, and 88 bytes of `hookData`.

| Field | Value | Expected |
|---|---|---|
| `version` | 1 | — |
| `sourceDomain` | 6 | Base |
| `destinationDomain` | **27** | Stellar ✓ |
| `sender` | `0x000…028b5a0e9…cf5d` | the messenger ✓ |
| header `recipient` | `0x09a3773f…ded2` | protocol-set, see below |
| `destinationCaller` | `0x72bd20ff…f291` | the forwarder ✓ |
| `minFinalityThreshold` | 2000 | standard tier ✓ |
| `burnToken` | `0x000…0833589…2913` | Base USDC ✓ |
| body `mintRecipient` | `0x72bd20ff…f291` | the forwarder ✓ |
| `amount` | **100000** | 0.10 USDC ✓ |
| `messageSender` | `0x000…0edd1b3b7…e63` | the burner ✓ |
| `maxFee` | 0 | standard tier ✓ |
| `feeExecuted` | 0 | — |
| `hookData` | 88 bytes, payload `GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56` | the destination account ✓ |

Every field the burner controls is correct, and the `hookData` payload decodes to the
destination account byte-for-byte. This is the §12.2 encoding executed correctly — the
mistake §12.2 warned about did not happen.

### 12.6.2 Corroboration: the `DepositForBurn` event

The same arguments, read from a second and structurally independent source — the
`DepositForBurn` event emitted by the messenger, topic0
`0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5`:

```
DepositForBurn(address,uint256,address,bytes32,uint32,bytes32,bytes32,uint256,uint32,bytes)

indexed burnToken            : 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
indexed depositor            : 0xedd1b3b72e41d16425075eabe699612fe22c0e63
indexed minFinalityThreshold : 2000
amount                       : 100000
mintRecipient                : 0x72bd20ff…f291  = CBZL2IH…  (forwarder)
destinationDomain            : 27
destinationTokenMessenger    : 0x09a3773f…ded2  = CAE2G5Z…
destinationCaller            : 0x72bd20ff…f291  = CBZL2IH…  (forwarder)
maxFee                       : 0
hookData                     : 88 bytes, payload GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56
```

Fields agree with §12.6.1 on every value. Note the signature is not the four- or
seven-argument `DepositForBurn` a reviewer might expect — v2 emits a ten-parameter form
carrying `hookData`, `maxFee`, and `minFinalityThreshold`. It is `DepositForBurn`
nonetheless; the selector resolves in 4byte.directory.

### 12.6.3 The header `recipient` is `destinationTokenMessenger`, not the forwarder

Header `recipient` decodes to `CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL`,
which is a contract distinct from the forwarder at `destinationCaller` and
`body.mintRecipient`. §12.6.2 identifies it: it is the `destinationTokenMessenger`
argument — **Circle's TokenMessenger on Stellar**, supplied by the protocol rather than
chosen by the burner. The message header carries the destination chain's messenger so the
destination knows which contract handles it; the burner's own destination travels in
`destinationCaller` and `body.mintRecipient`, both of which are the forwarder.

The testnet run shows the same shape, and it settled: header `recipient`
`CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` against forwarder
`CA66Q2W…` at `destinationCaller`/`body.mintRecipient`.

The fields a burner actually chooses are `destinationCaller`, `body.mintRecipient`,
`amount`, `maxFee`, `minFinalityThreshold`, and `hookData` — all six are correct above.
`expirationBlock` and `nonce` are both `0`, matching the testnet precedent.

### 12.6.4 Attestation: COMPLETE

`GET https://iris-api.circle.com/v2/messages/6?transactionHash=0x6773768a…`

```
status                    : complete
cctpVersion               : 2
attestation               : 260 hex chars / 130 bytes
message                   : 464 bytes
delayReason               : null
decodedMessage.sourceDomain        : 6
decodedMessage.destinationDomain   : 27
decodedMessage.sender              : 0x28b5a0e9c621a5badaa536219b3a228c8168cf5d
decodedMessage.minFinalityThreshold: 2000
decodedMessage.finalityThresholdExecuted: 2000
decodedBody.burnToken     : 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
decodedBody.amount        : 100000
decodedBody.messageSender : 0xedd1b3b72e41d16425075eabe699612fe22c0e63
decodedBody.maxFee        : 0
decodedBody.feeExecuted   : 0
decodedBody.expirationBlock: 0
decodedBody.hookData      : 0x636374702d666f7277617264…47424157494b33…
```

Attestation arrived at approximately 14:53Z, about **20 minutes** after the burn —
consistent with the standard tier (`finalityThresholdExecuted` also 2000). The
`pending_confirmations` state recorded while waiting was never a fault; `delayReason`
stayed `null` throughout.

**Three corrections to earlier sections.**

*hookData magic — §12.2/§12.3 record a value that was not used, and the outlier is the
burn.* This burn's hookData carries the ASCII magic `cctp-forward`:

```
636374702d666f7277617264 00000000000000000000000000000000000000 38 47424157494b33…
└────── "cctp-forward" ──┘ └──────────── 12 zero bytes ─────┘ │  └─ utf8 strkey ─┘
                                                       u32be version 0 / length 56
```

`buildCctpForwarderHookData` (`packages/core/src/evm/hook.ts:12`) emits **24 zero magic
bytes** instead. Checked against the two completed testnet burns in
`core-receive-sepolia.log`, read from their `MessageSent` events on Base Sepolia — the
only on-chain burns in this project that are known to have minted and forwarded:

```
0x39e8bd0cdb0326d2847391e2abf7cd3573a59110f25c0c86f64b7dd7acad2acd
  hookData magic: 000000000000000000000000000000000000000000000000   (24 zero bytes)
0x89f69bc36b1830da999f9a300dd2dd08499e1faf6b44d0157091f18b1944f6e2
  hookData magic: 000000000000000000000000000000000000000000000000   (24 zero bytes)
```

Both match the SDK. So the SDK is **not** shown to be wrong — it matches the only
on-chain evidence of a hook the forwarder has actually honoured. `cctp-forward` appears
nowhere in the repository and nowhere in the deployed site bundle, so the mainnet burn's
magic came from outside this project.

**Unresolved, and the reason this is flagged rather than dismissed:** testnet and mainnet
use different forwarder contracts (`CA66Q2W…` vs `CBZL2IH…`). Identical hook formats are
likely but not proven, so a mainnet-only magic cannot be ruled out. Settling it needs the
`CBZL2IH…` contract source, which is not in this repository. What can be said now: the
value **§12.2 and §12.3 record is not the value that was burned**, and the burned value
has no precedent anywhere in this project.

The rest of the payload agrees in both forms — version `0`, length `56`, utf8 strkey
decoding to `GBAWIK3…`.

*Attestation length.* §12.5 as originally drafted asked for "at least 131 bytes". The
real value here is **130 bytes / 260 hex chars**. The code's actual gate is far lower —
`packages/core/src/attestation/index.ts:85` rejects only when
`sig.slice(2).length < 130 || sig.length < 132`, i.e. it requires **65 bytes**, which
this passes with room to spare. The testnet record (`core-receive-sepolia.log:43`) shows
131 bytes, so the two runs differ by one byte and the figure is not fixed. §12.5's
threshold was derived from that single testnet observation and should be restated as the
code's 65-byte minimum, not 131.

*Nonce and finality threshold.* §12.6.1 decoded the message from the burn's `MessageSent`
event and compared it to Iris's copy. The two are **not** byte-identical, and a full
byte-level diff against the attested message shows the difference is exactly **34 bytes**,
in two protocol-assigned fields:

| Bytes | Field | `MessageSent` event | Iris (attested) |
|---|---|---|---|
| 12–43 | `nonce` | all zeros | `0xf17dca79b078d1df13675adba20e11e3faedbb443818eb74645644a37ca5c06f` (matches Iris `eventNonce`) |
| 146–147 | `finalityThresholdExecuted` | `0x0000` | `0x07d0` (2000) |

Both are written *after* the event is emitted: the nonce when the message is sent, the
executed threshold when Circle attests. So the event copy is the pre-completion message
and Iris's is the completed one. The other **430 bytes match exactly**, including every
field §12.6.1 relies on — `destinationDomain`, `amount`, `mintRecipient`, `hookData`. The
event-derived decode is field-accurate but not byte-exact; Iris's copy is authoritative,
and §12.6.1's "derived from the burn itself" holds for every field except these two.

### 12.6.5 Still outstanding

Legs 2, 4, and 5 of §12.5 remain. The claim has not been submitted, so there is no
Stellar mint, no `mint_and_forward` event, and no balance delta to assert. Nothing in
this section proves settlement — it proves the burn was constructed correctly, which is a
strictly weaker claim and is labelled as such.
