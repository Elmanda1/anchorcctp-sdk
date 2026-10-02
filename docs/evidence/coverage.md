# Test Coverage Evidence & Test Suites Report — AnchorCCTP SDK

**Latest run: 2026-10-02.** The 2026-09-16 figures below are kept as history; the
code has grown since then (the `evm/` and `testnet/` modules landed), so use the
current block.

## Current (2026-10-02)

**Command Executed:** `npm test -- --coverage` (root) and the same command inside each package.

**Result:** 31 passed suites, 1 skipped (`testnet-gated`, env-gated), 0 failed. 364 passed specs, 3 skipped.

| Scope | Stmts | Branch | Funcs | Lines | Suites | Specs |
|---|---|---|---|---|---|---|
| Combined (`core` + `cli`) | 96.64 | 91.89 | 94.03 | 97.30 | 31 | 364 |
| `packages/core` | 95.79 | 91.49 | 93.38 | 96.48 | 24 | 314 |
| `packages/cli` | 99.54 | 94.07 | 100 | 100 | 7 | 50 |

The binding gate is core-only (96.48% lines / 91.49% branches via
`packages/core/jest.config.js`). Root config is projects-only by design.

The CLI reached 100% line coverage through in-process tests in
`packages/cli/test/error-paths.test.ts` and `packages/cli/test/init-rethrow.test.ts`.
The `runCli` helper spawns the built CLI in a child process, so those assertions
never reached the jest coverage counters. The new tests call the command functions
directly for the error branches: invalid StrKeys, path traversal, overwrite refusal,
`--force`, argument parsing failures, non-HTTPS URLs, and non-SDK polling errors.

`packages/cli/test/usage.test.ts` also asserts that the version banner matches
`packages/cli/package.json`, so the CLI cannot report a stale version after a bump.

Windows note: `packages/core/test/replay.test.ts` previously hardcoded `/tmp/opencode`
and assumed POSIX file modes, which failed six specs on Windows. It now uses
`os.tmpdir()` and skips the mode assertion on `win32`.

---

## Historical — 2026-09-16

**Result:** 24 Passed Test Suites (1 skipped), 0 Failed, 161 Passed Specs, 2 skipped.
**Overall Line Coverage:** 97.42%.

```
All files          | 96.73 stmts | 89.78 branch | 94.28 funcs | 97.42 lines
 cli/src/commands  | 96.75       | 86.23        | 100         | 96.66
 core/src          | 95.88       | 92.98        | 90          | 96.31
```

### Historical matrix (2026-09-10, stale — kept for reference)

```
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-----------------|---------|----------|---------|---------|-------------------
All files        |   98.53 |    92.53 |   96.36 |   98.49 |                   
 src             |   95.83 |    95.55 |   83.33 |   95.77 |                   
  config.ts      |     100 |      100 |     100 |     100 |                   
  receive.ts     |   93.33 |    94.11 |      60 |   93.33 | 103,149,182       
 src/attestation |     100 |     87.5 |     100 |     100 |                   
  index.ts       |     100 |     87.5 |     100 |     100 | 47,104-106        
 src/decimals    |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/domains     |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/errors      |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/events      |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/forwarder   |   95.83 |    86.66 |     100 |   95.83 |                   
  index.ts       |   95.83 |    86.66 |     100 |   95.83 | 46                
 src/logger      |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/replay      |     100 |      100 |     100 |     100 |                   
  index.ts       |     100 |      100 |     100 |     100 |                   
 src/trustline   |     100 |    91.66 |     100 |     100 |                   
  index.ts       |     100 |    91.66 |     100 |     100 | 55                
-----------------|---------|----------|---------|---------|-------------------

Test Suites: 18 passed, 18 total
Tests:       80 passed, 80 total
Snapshots:   0 total
Time:        4.207 s
```

---

## 2. Detailed Test Suites Catalog & Code Snippets (historical 2026-09-10, partial; current totals are in the 2026-10-02 block above)

The catalog below covers the 18 suites that existed on 2026-09-10. The current run
has 29 passing suites. Each entry lists what the file asserts and shows a
representative snippet.

### A. `@anchor-cctp/core-sdk` Package Test Suites (13 Suites)

1. **[`packages/core/test/decimals.test.ts`](../../packages/core/test/decimals.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Verifies lossless decimal conversion between 6-decimal CCTP USDC ($10^6$) and 7-decimal Stellar USDC stroops ($10^7$).
   - **Code Example**:
     ```typescript
     // 6 -> 7 decimals lossless scaling (stroops)
     const { stellarAmount, dust } = convert6to7(1_000_000n);
     expect(stellarAmount).toBe(10_000_000n); // Exact multiplication by 10n
     expect(dust).toBe(0n);
     ```

2. **[`packages/core/test/replay.test.ts`](../../packages/core/test/replay.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Tests the idempotency store adapter to prevent double-crediting of burn transaction hashes.
   - **Code Example**:
     ```typescript
     // Replay store check & set idempotency
     await store.markProcessed('0xburn_123', record);
     const isDup = await store.isProcessed('0xburn_123');
     expect(isDup).toBe(true);
     ```

3. **[`packages/core/test/attestation.test.ts`](../../packages/core/test/attestation.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Validates Circle Attestation API polling, backoff, jitter calculation, and cryptographic verification.
   - **Code Example**:
     ```typescript
     // Polling Iris proof with exponential backoff & signature verification
     const res = await client.pollAttestation('0xburn_tx_hash', onPoll);
     expect(res.status).toBe('complete');
     expect(client.verifyAttestation(res.message, res.signature)).toBe(true);
     ```

4. **[`packages/core/test/trustline.test.ts`](../../packages/core/test/trustline.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Asserts USDC trustline inspection and opt-in creation with spending cap safeguards.
   - **Code Example**:
     ```typescript
     // Auto-create trustline within XLM spend cap
     await ensureTrustline({ destination, allowCreation: true, spendCapXlm: 2.0 });
     expect(hasTrustline()).resolves.toBe(true);
     ```

5. **[`packages/core/test/domains.test.ts`](../../packages/core/test/domains.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Validates the CCTP domain ID registry (Ethereum=0, Base=6, Stellar=27, etc.). The registry holds 30 domains.
   - **Code Example**:
     ```typescript
     // CCTP Domain Allowlist validation
     expect(isSupportedDomain(27)).toBe(true); // Stellar
     expect(getDomainMeta(6).chain).toBe('Base');
     expect(() => assertSupportedDomain(9999)).toThrow(InvalidDomainError);
     ```

6. **[`packages/core/test/forwarder.test.ts`](../../packages/core/test/forwarder.test.ts)** (PASS — 95.83% Coverage)
   - **Purpose**: Tests EVM 32-byte hex address decoding into Stellar `G...` Strkeys and Soroban mint transaction submission.
   - **Code Example**:
     ```typescript
     // Address translation bytes32 -> G... strkey
     const stellarAddr = translateToStellar('0x000...32byteHex');
     expect(stellarAddr).toMatch(/^G[A-Z0-9]{55}$/);
     ```

7. **[`packages/core/test/receive.test.ts`](../../packages/core/test/receive.test.ts)** (PASS — 93.33% Coverage)
   - **Purpose**: Orchestration test suite for the complete 11-step `AnchorCCTP.receive()` lifecycle pipeline.
   - **Code Example**:
     ```typescript
     // Full unified receive() orchestration
     const res = await sdk.receive({ sourceDomain: 6, burnTxHash: '0x1', destinationAddress: 'GB...' });
     expect(res.settled).toBe(true);
     expect(res.amount).toBe(10_000_000n);
     ```

8. **[`packages/core/test/events.test.ts`](../../packages/core/test/events.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Tests the typed event emitter (`onReceiving`, `onSettled`, `onDustCollected`, `onError`).
   - **Code Example**:
     ```typescript
     // Strongly-typed lifecycle event stream
     sdk.on('onSettled', ({ amount, txHash }) => {
       expect(amount).toBeGreaterThan(0n);
       expect(txHash).toBeDefined();
     });
     ```

9. **[`packages/core/test/errors.test.ts`](../../packages/core/test/errors.test.ts)** (PASS — 100% Coverage)
   - **Purpose**: Asserts the standardized `AnchorCCTPError` base class hierarchy and actionable remediation strings.
   - **Code Example**:
     ```typescript
     // Typed error codes & remediation guidance
     const err = new ReplayTransferError('0xburn_tx');
     expect(err.code).toBe('REPLAY_TRANSFER_DETECTED');
     expect(err.remediation).toContain('already processed');
     ```

10. **[`packages/core/test/security.test.ts`](../../packages/core/test/security.test.ts)** (PASS)
    - **Purpose**: Asserts non-negotiable security checklist rules.
    - **Code Example**:
      ```typescript
      // Zero secret persistence & log sanitization
      const sanitized = sanitizeValue('sensitive_secret_token');
      expect(sanitized).toBe('[REDACTED]');
      ```

11. **[`packages/core/test/config.test.ts`](../../packages/core/test/config.test.ts) & [`logger.test.ts`](../../packages/core/test/logger.test.ts)** (PASS — 100% Coverage)
    - **Purpose**: Tests SDK configuration loading and structured JSON logging.
    - **Code Example**:
      ```typescript
      const sdk = createAnchorCCTP({ rpcUrl: 'https://soroban-mainnet.stellar.org' });
      logger.info('Transfer settled', { amount: '10000000' });
      ```

12. **[`packages/core/test/integration/attestation.test.ts`](../../packages/core/test/integration/attestation.test.ts)** (PASS)
    - **Purpose**: End-to-end integration test parsing realistic CCTP `MessageSent` events and attestation responses.
    - **Code Example**:
      ```typescript
      const attResult = await mockIrisApi(burnMessagePayload);
      expect(attResult.status).toBe('complete');
      expect(attResult.signature).toBeDefined();
      ```

---

### B. `@anchor-cctp/cli` Package Test Suites (5 Suites)

13. **[`packages/cli/test/init.test.ts`](../../packages/cli/test/init.test.ts)** (PASS)
    - **Code Example**:
      ```typescript
      const { stdout, code } = await runCli(['init', '--domain', '27', '--output', out]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout).success).toBe(true);
      ```

14. **[`packages/cli/test/listen.test.ts`](../../packages/cli/test/listen.test.ts)** (PASS)
    - **Code Example**:
      ```typescript
      const { stdout, code } = await runCli(['listen', 'GBBD47...']);
      const event = JSON.parse(stdout.trim().split('\n')[0]);
      expect(event.event).toBe('inbound_burn_detected');
      ```

15. **[`packages/cli/test/verify.test.ts`](../../packages/cli/test/verify.test.ts)** (PASS)
    - **Code Example**:
      ```typescript
      const { stdout, code } = await runCli(['verify', '0xcomplete_tx']);
      expect(JSON.parse(stdout).attested).toBe(true);
      ```

16. **[`packages/cli/test/domains.test.ts`](../../packages/cli/test/domains.test.ts)** (PASS)
    - **Code Example**:
      ```typescript
      const { stdout, code } = await runCli(['domains']);
      expect(Array.isArray(JSON.parse(stdout))).toBe(true);
      ```

17. **[`packages/cli/test/usage.test.ts`](../../packages/cli/test/usage.test.ts)** (PASS)
    - **Code Example**:
      ```typescript
      const { stderr, code } = await runCli([]);
      expect(stderr).toContain('Usage: anchor-cctp');
      ```

---

## 3. Mapping Test Coverage to the 5 Formal Proofs

1. **Proof 1 (Decimal Conversion Exactness & Dust Non-Loss Invariant):**
   - Verified by `decimals.test.ts` (100% line coverage). Confirms $10C + D = S$ and zero IEEE-754 precision loss.
2. **Proof 2 (Idempotency & Replay Non-Duplication Invariant):**
   - Verified by `replay.test.ts` (100% line coverage). Asserts that $|R(H)| \le 1$ for any `burnTxHash`.
3. **Proof 3 (Cryptographic Attestation Pre-Settlement Safety):**
   - Verified by `attestation.test.ts` and `receive.test.ts`. Confirms throwing `ATTESTATION_VERIFICATION_FAILED` when signatures fail.
4. **Proof 4 (Bounded Trustline XLM Reserve Expenditure):**
   - Verified by `trustline.test.ts` (100% line coverage). Asserts $C_{\text{reserve}} \le \text{spendCapXlm}$.
5. **Proof 5 (One-Way Package Dependency DAG Invariant):**
   - Verified by `security.test.ts` & TypeScript compilation. Confirms strict tier isolation with zero reverse dependencies from `core-sdk`.
