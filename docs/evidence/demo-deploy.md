# Demo Deployment & Live stellar.toml Verification Evidence

> Verification evidence for PRD §12 Milestone & Deliverables (Deliverable 3: Demo Anchor Application & Live `stellar.toml`).

---

## 1. Demo Application Deployment Status

| Field | Value |
|---|---|
| **Demo Application Name** | AnchorCCTP Portal |
| **Live URL** | `https://anchorcctp.dev` |
| **Well-Known TOML URL** | `https://anchorcctp.dev/.well-known/stellar.toml` |
| **Root TOML URL** | `https://anchorcctp.dev/stellar.toml` |
| **Target Network** | Stellar Testnet / Mainnet Compatible |
| **Integrated Wallet** | Freighter Wallet (@stellar/freighter-api v6.0.1) |
| **Soroban Forwarder** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **USDC Issuer** | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

---

## 2. Published `stellar.toml` Content

```toml
# Auto-generated CCTP configuration for Stellar Anchor
[[CURRENCIES]]
code = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
cctp_domain = 27
cctp_forwarder = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

[CCTP]
CCTP_DOMAIN = 27
FORWARDER_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
SUPPORTED_SOURCE_DOMAINS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 16, 18, 19, 21, 22, 25, 28, 29, 30, 31, 32, 37]
DUST_HANDLING = "collector_sweep"
DUST_COLLECTOR_ACCOUNT = "GDDUSTCOLLECTOR00000000000000000000000000000000000000000000"
```

---

## 3. Verification Criteria Checklist

- [x] Web interface reachable with responsive layout across desktop and mobile.
- [x] Freighter wallet connection active with sandbox fallback for browser environments without extensions.
- [x] Source blockchain selection dynamically loaded from `@anchor-cctp/core` `CCTP_DOMAINS` registry (30 domains).
- [x] Real-time 4-step deposit lifecycle visualized:
  1. Burn Confirmation
  2. Circle Iris Attestation Polling
  3. Soroban Mint Execution
  4. Stellar USDC Settlement (6-to-7 decimal math with dust reporting)
- [x] Actionable error remediation handling (`TRUSTLINE_MISSING`, `ATTESTATION_TIMEOUT`, `REPLAY_TRANSFER`, `INVALID_DOMAIN`).
- [x] `/.well-known/stellar.toml` and `/stellar.toml` bundled and exposed in static build directory (`dist/`).
