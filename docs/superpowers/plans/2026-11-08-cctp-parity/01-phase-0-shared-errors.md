# Phase 0 — Shared Error Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add every error type and constructor parameter that downstream tracks need, and correct the two source comments that claim cryptographic verification, so no later track has to edit `errors/index.ts`.

**Wave:** 0. Must merge before any other phase file starts.
**Files owned:** `packages/core/src/errors/index.ts`, `packages/core/src/index.ts` (comment only)
**Preconditions:** `npm run lint && npm run typecheck` green.

---

### Task 0.1: Add `AttestationRequestError`

**Files:**
- Modify: `packages/core/src/errors/index.ts`
- Test: `packages/core/test/errors.test.ts`

**Interfaces:**
- Produces: `AttestationRequestError(status: number, retryAfterMs?: number)` with public readonly `status` and `retryAfterMs`. Consumed by track C.

- [ ] **Step 1: Write the failing test**

```typescript
import { AttestationRequestError } from '../src/errors/index.js';

test('AttestationRequestError names the status and the rate-limit recovery', () => {
  const rateLimited = new AttestationRequestError(429, 300_000);
  expect(rateLimited.status).toBe(429);
  expect(rateLimited.retryAfterMs).toBe(300_000);
  expect(rateLimited.message).toMatch(/429/);
  expect(rateLimited.message).toMatch(/five minutes/);

  expect(new AttestationRequestError(400).message).toMatch(/malformed or unauthorized/);
  expect(new AttestationRequestError(400).code).toBe('ATTESTATION_REQUEST_FAILED');
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/errors.test.ts --no-coverage -t "AttestationRequestError"`
Expected: FAIL — no such export.

- [ ] **Step 3: Implement**

Append to `errors/index.ts`, matching the file's existing class pattern (inspect one neighbouring class first — the base constructor sets `code` and a remediation string):

```typescript
/**
 * Thrown when Iris rejects a request that retrying cannot fix: 400 (malformed),
 * 401/403 (unauthorized), or 429 (rate-limit block — Circle blocks the client for
 * five minutes).
 */
export class AttestationRequestError extends AnchorCCTPError {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number
  ) {
    super(
      'ATTESTATION_REQUEST_FAILED',
      `Iris returned HTTP ${status}.` +
        (status === 429
          ? ' Rate limited — Circle blocks the client for five minutes; wait before retrying.'
          : ' The request is rejected as malformed or unauthorized; retrying cannot succeed.')
    );
  }
}
```

Use whichever constructor signature the neighbouring classes actually use; do not invent a second base API.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/errors.test.ts --no-coverage`
Expected: PASS.

### Task 0.2: Give `MintFailedError` a contract code

**Files:**
- Modify: `packages/core/src/errors/index.ts`
- Test: `packages/core/test/errors.test.ts`

**Interfaces:**
- Produces: `new MintFailedError(burnTxHash, reason?, contractCode?)`, public readonly `contractCode?: number`. Consumed by track D.

- [ ] **Step 1: Write the failing test**

```typescript
test('MintFailedError carries a Soroban contract code when known', () => {
  const err = new MintFailedError('0x' + 'ab'.repeat(32), 'simulate: Error(Contract, #7301) (InvalidMintRecipient)', 7301);
  expect(err.contractCode).toBe(7301);
  expect(new MintFailedError('0x' + 'ab'.repeat(32)).contractCode).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/errors.test.ts --no-coverage -t "Soroban contract code"`
Expected: FAIL — third parameter not accepted.

- [ ] **Step 3: Implement**

Add the optional third constructor parameter and field. Do not change the existing message format; the contract name is appended by the caller in track D, not by the error class.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/errors.test.ts --no-coverage`
Expected: PASS.

### Task 0.3: Correct the verification claims in public comments

**Files:**
- Modify: `packages/core/src/index.ts:27`
- Modify: `packages/core/src/errors/index.ts` (`AttestationVerificationError` docblock and `AttestationTimeoutError` remediation)

**Interfaces:** none — comments only.

- [ ] **Step 1: Make the three edits**

`index.ts` attestation export comment:

```typescript
/**
 * Circle Attestation API client with exponential backoff. The SDK validates
 * attestation shape only; the on-chain forwarder contract is the sole
 * cryptographic signature verifier.
 */
```

`errors/index.ts` `AttestationVerificationError` docblock: replace "fails cryptographic verification" with "is malformed or contradicts the caller's parameters".

`errors/index.ts` `AttestationTimeoutError` remediation: replace the reference to a nonexistent `pollTimeoutMs` option with the real `attestationTimeoutMs` (added by track C) and `maxRetries`.

- [ ] **Step 2: Verify nothing asserts the old text**

Run: `grep -rn "cryptographic verification\|pollTimeoutMs" packages/core/src packages/core/test`
Expected: matches only inside the `isWellFormedAttestation` deprecation note, which legitimately says verification happens on-chain. Adjust the grep target if the phrase is required there.

- [ ] **Step 3: Gate and commit**

```bash
npm run lint && npm run typecheck && npx jest packages/core/test/errors.test.ts --no-coverage
git add packages/core/src/errors/index.ts packages/core/src/index.ts packages/core/test/errors.test.ts
git commit -m "refactor(core): add shared attestation and mint error surface"
```

---

## Exit criteria

- `AttestationRequestError` and `MintFailedError.contractCode` exist and are exported.
- No source comment claims the SDK verifies attestation signatures.
- `npm run lint && npm run typecheck` clean; `errors.test.ts` green.
