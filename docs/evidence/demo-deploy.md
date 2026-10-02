# Demo Deployment & Live stellar.toml Verification Evidence

> Verification evidence for PRD §12 Milestone & Deliverables (Deliverable 3: Demo Anchor Application & Live `stellar.toml`).
>
> **Last verified:** 2026-10-02. Live `stellar.toml` below was copied from
> `https://anchorcctp.dev/.well-known/stellar.toml` on that date.

---

## 1. Demo Application Deployment Status

| Field | Value |
|---|---|
| **Demo Application Name** | AnchorCCTP Portal |
| **Live URL** | `https://anchorcctp.dev` (apex `308` → `https://www.anchorcctp.dev`, `200`) |
| **Well-Known TOML URL** | `https://anchorcctp.dev/.well-known/stellar.toml` |
| **Root TOML URL** | `https://anchorcctp.dev/stellar.toml` |
| **Target Network** | Stellar Mainnet (`VITE_NETWORK=mainnet`, Public Global Stellar Network passphrase) |
| **Integrated Wallet** | Freighter Wallet (@stellar/freighter-api v6.0.1) |
| **Soroban Forwarder** | `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T` |
| **USDC Issuer** | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| **Dust Collector / Distribution** | `GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES` (funded 6.68 XLM, USDC trustline live) |
| **Fee Account** | `GAX2TZZKSHRVULE4XOYWPVGDUM2U2H7ETUHL23624I52DCFDKUFT7CE6` (funded 6.68 XLM, USDC trustline live) |
| **API (`/api/*`)** | `FUNCTION_INVOCATION_FAILED` at last check — frontend + `stellar.toml` live, settle API not yet healthy |

---

## 2. Published `stellar.toml` Content

```toml
# CCTP configuration for Stellar Anchor (mainnet)
[[CURRENCIES]]
code = "USDC"
issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
cctp_domain = 27
cctp_forwarder = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T"

[CCTP]
CCTP_DOMAIN = 27
FORWARDER_ADDRESS = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T"
SUPPORTED_SOURCE_DOMAINS = [0, 6]
DUST_HANDLING = "collector_sweep"
DUST_COLLECTOR_ACCOUNT = "GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES"
```

Scope is Ethereum (domain 0) + Base (domain 6) only. Every `G...`/`C...`
above passes StrKey validation (checked pre-publish).

---

## 3. Verification Criteria Checklist

- [x] Web interface reachable with responsive layout across desktop and mobile.
- [x] Freighter wallet connection active with network-passphrase check (Public Global Stellar Network).
- [x] Source blockchain selection dynamically loaded from `@anchor-cctp/core` `CCTP_DOMAINS` registry; live scope is `[0, 6]`.
- [x] Deposit lifecycle visualized (Burn → Attest → Settle) with poll, cancel/retry, and receipt (mint output, dust sweep, Stellar tx link).
- [x] Error remediation surfaced from server `remediation` + simulated client paths (rejected signing, insufficient XLM, network mismatch) — see `ui-err-*.png`.
- [x] `/.well-known/stellar.toml` and `/stellar.toml` served live with mainnet values.
- [ ] Settle API healthy (`/api/config` JSON, no `FUNCTION_INVOCATION_FAILED`).
- [ ] Cancelled-state and final-credit screenshots (`ui-cancelled.png`, `ui-credit.png` still to capture).
