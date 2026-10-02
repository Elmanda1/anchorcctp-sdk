# Demo UI: Balance Refresh and Error Simulation Panel

**Date:** 2026-10-02
**Package versions:** `@anchor-cctp/core-sdk@1.0.1`, `@anchor-cctp/cli@1.0.1` (demo workspace `apps/demo`)
**Status:** Done

## What Changed

`apps/demo/src/components/CctpDepositFlow.tsx` — 4 additions:

### 1. Balance Display (lines 370–406)
- `getAccountBalances` called post-connect via `useEffect`
- Parses real Horizon response: `native` → XLM, `credit_alphanum12` USDC → USDC
- Refresh button re-calls `getAccountBalances`
- Unknown assets ignored

### 2. Network Badge (lines 393–405)
- `checkNetworkMatch(TESTNET_PASSPHRASE)` called on connect
- Shows `TESTNET ✓` (green) or mismatch error (rose) with `Wifi`/`WifiOff` icons
- Mismatch details from real `checkNetworkMatch` error message

### 3. Error Simulation Select (lines 409–427)
Three wired options:
- `rejected-signing`: calls real `signWithFreighter` → catches genuine rejection/error
- `insufficient-xlm`: checks real fetched XLM balance < 2 → remediation
- `network-mismatch`: passes `MAINNET_PASSPHRASE` to `signWithFreighter` → genuine mismatch

No fake timers. Each toggle executes genuine failing path.

### 4. Review Line (lines 429–445)
- Shows amount (from `usdcAmount`), destination (from `wallet.address`), network passphrase
- Same values passed to `signWithFreighter` — single source of truth
- No XDR logged

## Verification

Commands run from the repo root:

| Command | Result |
|---|---|
| `npm run typecheck` | Clean, no errors |
| `npm run lint` | Clean, no errors |
| `npx jest` | 363 passed, 3 skipped, 0 failed (31 passed suites) |
| `npm run build --workspace=@anchor-cctp/demo` | Builds, 1,173 kB JS bundle |
- Core SDK must be built first (`npm run build --workspace=@anchor-cctp/core-sdk`)

## Manual Verification (requires browser + Freighter)

- Connect wallet → balances appear, network badge shows
- Click Refresh → balances update
- Select each error simulation → click Execute → genuine error + remediation shown
- Happy path → full settlement lifecycle completes
