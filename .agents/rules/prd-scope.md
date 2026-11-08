# PRD Requirements & Project Scope Bindings

This rule enforces strict alignment with [docs/PRD.md](file:///c:/Users/lunox/Documents/anchorcctp-sdk/docs/PRD.md).

## 1. Project Context
- **Name**: AnchorCCTP SDK
- **Sprint Window**: 30 calendar days
- **Target**: Production-ready TypeScript SDK + CLI published to npm + live testnet/mainnet demo anchor + `SEP-CCTP.md` draft PR.

## 2. Core Deliverables (Definition of Done)
1. **Deliverable 1 (`@anchor-cctp/core`)**: `AnchorCCTP.receive()` entrypoint, Circle Attestation API polling, BigInt 6↔7 decimal math, Soroban CCTP forwarder address translation, CCTP domain ID registry (Stellar = 27), opt-in trustline auto-creation, typed lifecycle events, $\ge 90\%$ unit test coverage.
2. **Deliverable 2 (`@anchor-cctp/cli`)**: `init`, `listen`, `verify`, `domains` commands with machine-readable JSON on `stdout`.
3. **Deliverable 3 (Demo Anchor & Specification)**: React + Vite demo UI (`apps/demo`) with Freighter wallet integration, live mainnet `stellar.toml`, draft PR for `SEP-CCTP.md` submitted to `stellar/stellar-protocol`.

## 3. Scope Guardrails
- Reject any attempt to silently pull out-of-scope features (SEP-6/24 auto-deposits, outbound CCTP, Soroban custom contracts, APM dashboards, non-Freighter wallets).
