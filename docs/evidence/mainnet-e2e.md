# Mainnet E2E Evidence — Record

> **Status: PRODUCED.** One completed CCTP v2 transfer: a USDC burn on Base, attested by
> Circle, minted to Stellar pubnet through the forwarder contract, and credited to a
> Stellar account whose balance delta was measured. Every identifier below was read back
> from the chain or from Circle, not transcribed from a run log.

## The transfer

| Field | Value |
|---|---|
| Source chain | **Base** (CCTP domain `6`, chain id 8453) |
| Source burn tx | `0x6773768a20c384bd5fdfda150d5e4892082f36595b2485da881c15eedc1ddc81` |
| Burn block / timestamp | `52081113` / `2026-10-02T14:32:53Z` |
| Burn status | `0x1` |
| Burn `to` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (TokenMessengerV2 proxy) |
| Burn amount (6 dp) | `100000` (0.10 USDC) |
| CCTP `maxFee` | `0` |
| `feeExecuted` | `0` |
| Destination Stellar account | `GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56` — verified on chain as the account that received |
| Message `destinationDomain` | `27` (Stellar) |
| Message `mintRecipient` | `0x72bd20ff…fcf291` = `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T` (forwarder) |
| Message `hookData` | 88 bytes, `"cctp-forward"` magic, payload `GBAWIK3…` |
| Iris status | `complete` |
| `cctpVersion` | `2` |
| Attestation length | `130` bytes (260 hex) |
| `finalityThresholdExecuted` | `2000` (standard) |
| Stellar mint tx | `44b2a28a7497528a48a69a0e311ff9e3a82c537ba70295385bec661bf44a59c5` |
| Mint ledger / closed at | `64734117` / `2026-10-02T15:52:47Z` |
| Mint `successful` | `true` |
| Mint source | `GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES` (sponsor) |
| Mint fee charged / max | `274878` / `420249` stroops |
| `mint_and_forward` event | contract `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T`, `amount` `1000000`, `forward_recipient` `GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56`, `token` `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Net minted (7 dp) | `1000000` stroops |
| Dust swept | `0` |
| Balance delta asserted | `0.0000000 → 0.1000000` USDC, expected `1000000` stroops |

The delta assertion — the part that makes this a *credit* proof rather than a *mint*
proof — passes exactly:

```
expected = (burn 100000 − maxFee 0) × 10 = 1_000_000 stroops
proven   = balanceAfter − balanceBefore = 1_000_000 stroops   ✓
```

The account measured is the one named in `forward_recipient`, confirmed by decoding the
event's raw bytes to `GBAWIK3…` rather than by trusting the value the burn was given.

## Reproduction

```bash
# 1. the burn exists on Base
curl -s -X POST https://mainnet.base.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x6773768a20c384bd5fdfda150d5e4892082f36595b2485da881c15eedc1ddc81"]}'

# 2. Circle attested it (mainnet Iris, source domain 6)
curl -s "https://iris-api.circle.com/v2/messages/6?transactionHash=0x6773768a20c384bd5fdfda150d5e4892082f36595b2485da881c15eedc1ddc81"

# 3. the Stellar mint landed
curl -s "https://horizon.stellar.org/transactions/44b2a28a7497528a48a69a0e311ff9e3a82c537ba70295385bec661bf44a59c5"

# 4. the mint event, archived rather than linked (Soroban retention is a rolling window)
curl -s -X POST https://mainnet.sorobanrpc.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getEvents","params":{"startLedger":64734117,"endLedger":64734118,"filters":[{"type":"contract","contractIds":["CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T"]}],"pagination":{"limit":20}}}'

# 5. the credit, on the destination account
curl -s "https://horizon.stellar.org/accounts/GBAWIK3EATCDGZ3LEQG6BAALVX3V4Z2BTZO3K6P2ZF6VSNHKUDRRCO56"
```

## What this record does not prove

Three things, stated plainly.

**The application did not record the settlement.** The portal reported
`MINT_UNCONFIRMED` for this transfer — "a mint was broadcast but not confirmed" — while
the chain shows a successful mint two seconds after broadcast. `submitMint` polls for
`DEFAULT_CONFIRM_ATTEMPTS × DEFAULT_CONFIRM_POLL_MS` and reports unconfirmed on
exhaustion; "unconfirmed" is not "failed", and this transfer is the proof that the two
diverge. No `settled` receipt was written, so `GET /api/receive/status` still answers
`ready` for this burn even though the funds arrived. **The chain is authoritative here,
not the application.**

**The run required five code fixes to complete**, each masking the next: the serverless
CORS allowlist, `@upstash/redis` auto-deserialization (writes succeeded, every read
returned `null`), a dead Soroban RPC host (`soroban-mainnet.stellar.org` is NXDOMAIN),
a `*.stellar.org`-only host allowlist that made mainnet unconfigurable, and a base-fee
bid of 100 stroops that fell below the surge-adjusted minimum. Commits `3b7f96e`,
`a3a5a50`, `d288fc1`, `7099246` and `0334d15`. A reader reproducing this should expect
the current code, not the code as it stood when the burn was made.

**The recorded `transferMode` is `fast`; the chain says standard.** The settlement used a
stale intent that first-claimer-wins had bound during the KV defect, and settle checks
the mode against the intent, never against the burn. The chain is unambiguous —
`minFinalityThreshold` and `finalityThresholdExecuted` are both `2000` — so treat
`standard` as the true tier and the `fast` label as an artifact. Clearing that stale
binding, and reconciling a broadcast that provably never landed, are both open gaps in
the handler.

**This is one transfer, not a soak test.** It demonstrates that the path works end to
end, on one source chain (Base), for one amount, at one point in time. It says nothing
about behaviour under load, across other source domains, or at other amounts.
