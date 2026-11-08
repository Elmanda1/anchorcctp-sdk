# Track C — Iris Client Semantics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Make the attestation client behave like `circlefin/cctp-go` and Circle's documented Iris contract: terminal on client errors, bounded on 404, long enough for Standard finality, and never pointed at the wrong network by accident.

**Wave:** 2. Starts after tracks A and D are merged, because this track removes the constructor's implicit mainnet host and rebuilds `config.ts` host resolution — shared fixtures those tracks rely on must be final first.
**Files owned:** `packages/core/src/attestation/index.ts`, `packages/core/src/config.ts`, `packages/core/test/attestation.test.ts`, `packages/core/test/config.test.ts`.
**Preconditions:** phase 0 merged (`AttestationRequestError` exists).

**Sources:** `cctp-go/client.go` (`Message` struct, `DelayReason`, retry constants `2s`/`10s`/`max404Retries=3`, 429 terminal), Circle technical guide (40 rps, 429 block five minutes), `GET /v2/messages` API reference (`status`, `decodedMessage`), Circle finality page (Standard 15–19 min).

---

### Task C1: Classify Iris responses instead of retrying everything

**Files:**
- Modify: `packages/core/src/attestation/index.ts`
- Test: `packages/core/test/attestation.test.ts`

**Interfaces:**
- Consumes: `AttestationRequestError` (phase 0).
- Produces: `AttestationClientOptions.max404Retries?: number` (default 3).

- [ ] **Step 1: Write the failing tests**

```typescript
test('treats 400 as terminal instead of retrying to timeout', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0, maxRetries: 5 });
  await expect(client.pollAttestationByTx(6, '0x' + 'ab'.repeat(32))).rejects.toThrow(AttestationRequestError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('treats 429 as terminal and reports the block', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: false, status: 429, headers: { get: () => '300' }, json: async () => ({}),
  });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0 });
  await expect(client.pollAttestationByTx(6, '0x' + 'cd'.repeat(32))).rejects.toMatchObject({ status: 429, retryAfterMs: 300_000 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('gives up after three consecutive 404s', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0, maxRetries: 20 });
  await expect(client.pollAttestationByTx(6, '0x' + 'ef'.repeat(32))).rejects.toMatchObject({ status: 404 });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test('reads delayReason from the top-level message row', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      messages: [{
        message: '0x' + 'ab'.repeat(400), attestation: '0x' + 'cd'.repeat(65), status: 'complete',
        delayReason: 'insufficient_fee',
        decodedMessage: { finalityThresholdExecuted: '2000' },
      }],
    }),
  });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0 });
  const result = await client.pollAttestationByTx(6, '0x' + '12'.repeat(32));
  expect(result.delayReason).toBe('insufficient_fee');
  expect(result.finalityThresholdExecuted).toBe(2000);
});

test('treats complete-with-empty-attestation as terminal', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ messages: [{ message: '0x' + 'ab'.repeat(400), attestation: '', status: 'complete' }] }),
  });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0, maxRetries: 5 });
  await expect(client.pollAttestationByTx(6, '0x' + '34'.repeat(32))).rejects.toThrow(AttestationVerificationError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('keeps retrying 5xx and network drops (documented divergence)', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    .mockRejectedValueOnce(new Error('ECONNRESET'))
    .mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ messages: [{ message: '0x' + 'ab'.repeat(400), attestation: '0x' + 'cd'.repeat(65), status: 'complete' }] }),
    });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0, maxRetries: 5 });
  await expect(client.pollAttestationByTx(6, '0x' + '56'.repeat(32))).resolves.toMatchObject({ status: 'complete' });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage`
Expected: FAIL — client errors retry; `delayReason` null; empty attestation retries.

- [ ] **Step 3: Implement**

Add the classifier and the 404 counter to both poll methods:

```typescript
  /** 4xx retrying cannot fix, except 404 (not indexed yet). */
  private classify(res: Response): 'retry' | 'terminal' {
    if (res.status === 404 || res.status === 408 || res.status === 425) return 'retry';
    if (res.status >= 500) return 'retry'; // deliberate divergence: cctp-go is stricter
    return 'terminal';
  }
```

In the `else` (non-OK) branch:

```typescript
        if (res.status === 404) {
          consecutive404 += 1;
          if (consecutive404 >= this.max404Retries) throw new AttestationRequestError(404);
        } else if (this.classify(res) === 'terminal') {
          const header = res.headers?.get?.('retry-after');
          throw new AttestationRequestError(res.status, header ? Number(header) * 1000 : undefined);
        }
```

In the OK branch:

```typescript
        if (msg?.status === 'complete' && msg.attestation === '') {
          throw new AttestationVerificationError(txHash, 'attestation status is complete but attestation is empty');
        }
        // ...
        delayReason: msg.delayReason ?? msg.decodedMessage?.delayReason ?? null,
```

Wrap the `fetch` call so `AttestationVerificationError` and `AttestationRequestError` are rethrown, not swallowed by the retry catch.

Add `max404Retries` to options and constructor (`this.max404Retries = options.max404Retries ?? 3`).

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage`
Expected: PASS. The pre-existing retry-on-500 test stays; add a comment above it naming the deliberate divergence.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attestation/index.ts packages/core/test/attestation.test.ts
git commit -m "fix(core): classify Iris responses instead of retrying every failure"
```

---

### Task C2: Give polling a route-aware deadline

**Files:**
- Modify: `packages/core/src/attestation/index.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/test/attestation.test.ts`

**Interfaces:**
- Produces: `AttestationClientOptions.timeoutMs` (default `25 * 60 * 1000`) and `signal?: AbortSignal`; `AnchorCCTPConfig.attestationTimeoutMs?: number`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('default budget outlasts a Standard attestation', () => {
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl: jest.fn() });
  expect((client as unknown as { timeoutMs: number }).timeoutMs).toBeGreaterThanOrEqual(20 * 60 * 1000);
});

test('stops polling once the deadline passes', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [] }) });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 5, timeoutMs: 20, maxRetries: 10_000 });
  await expect(client.pollAttestationByTx(6, '0x' + '78'.repeat(32))).rejects.toThrow(AttestationTimeoutError);
  expect(fetchImpl.mock.calls.length).toBeLessThan(10_000);
});

test('an aborted signal stops immediately', async () => {
  const controller = new AbortController();
  const fetchImpl = jest.fn().mockImplementation(async () => {
    controller.abort();
    return { ok: true, status: 200, json: async () => ({ messages: [] }) };
  });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 5, signal: controller.signal });
  await expect(client.pollAttestationByTx(6, '0x' + '9a'.repeat(32))).rejects.toThrow(AttestationTimeoutError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage -t "default budget|deadline passes|aborted signal"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the options and fields, replace `sleep` with an abortable variant that rejects on `abort`, and change both loop heads to:

```typescript
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (this.signal?.aborted || Date.now() - startTime >= this.timeoutMs) break;
      // ...
      const backoffInterval = Math.min(this.pollIntervalMs * Math.pow(1.5, attempt - 1), this.maxIntervalMs);
      try {
        await sleep(backoffInterval, this.signal);
      } catch {
        break;
      }
    }
```

In `config.ts`, add `attestationTimeoutMs?: number` to `AnchorCCTPConfig` and pass `timeoutMs: config.attestationTimeoutMs`.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/attestation.test.ts packages/core/test/config.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attestation/index.ts packages/core/src/config.ts packages/core/test/attestation.test.ts
git commit -m "fix(core): give attestation polling a route-aware deadline and abort support"
```

---

### Task C3: Bind the Iris host to the network and fail closed

**Files:**
- Modify: `packages/core/src/attestation/index.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/test/attestation.test.ts`, `packages/core/test/config.test.ts`

**Interfaces:**
- Produces: `IRIS_MAINNET`, `IRIS_SANDBOX`, `resolveAttestationBaseUrl(network?)`; `AttestationClient` throws `InvalidConfigError` when no host is resolvable.

- [ ] **Step 1: Write the failing tests**

```typescript
test('resolves sandbox for testnet and mainnet for mainnet', () => {
  expect(resolveAttestationBaseUrl('testnet')).toBe(IRIS_SANDBOX);
  expect(resolveAttestationBaseUrl('mainnet')).toBe(IRIS_MAINNET);
  expect(resolveAttestationBaseUrl(undefined)).toBeUndefined();
});

test('a testnet client pointed at the mainnet host is rejected', () => {
  expect(() => createAnchorCCTP({ network: 'testnet', attestationBaseUrl: IRIS_MAINNET })).toThrow(InvalidConfigError);
});

test('a client with no host is rejected instead of defaulting to mainnet', () => {
  expect(() => new AttestationClient({})).toThrow(InvalidConfigError);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/attestation.test.ts packages/core/test/config.test.ts --no-coverage -t "resolves sandbox|mainnet host is rejected|no host is rejected"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
export const IRIS_MAINNET = 'https://iris-api.circle.com';
export const IRIS_SANDBOX = 'https://iris-api-sandbox.circle.com';

export function resolveAttestationBaseUrl(network?: 'testnet' | 'mainnet'): string | undefined {
  if (network === 'testnet') return IRIS_SANDBOX;
  if (network === 'mainnet') return IRIS_MAINNET;
  return undefined;
}
```

Constructor resolution (note the explicit parenthesisation):

```typescript
    const explicit =
      options.baseUrl ||
      (options.network ? resolveAttestationBaseUrl(options.network) : undefined) ||
      (typeof process !== 'undefined' ? process.env?.CIRCLE_ATTESTATION_BASE_URL : undefined);
    if (!explicit) {
      throw new InvalidConfigError(
        'attestationBaseUrl is required (or CIRCLE_ATTESTATION_BASE_URL). There is no cross-network default: ' +
          'testnet uses https://iris-api-sandbox.circle.com, mainnet uses https://iris-api.circle.com.'
      );
    }
```

In `config.ts`, resolve and cross-check before constructing:

```typescript
  const attestationBaseUrl = config.attestationBaseUrl ?? resolveAttestationBaseUrl(config.network);
  if (config.network === 'testnet' && attestationBaseUrl === IRIS_MAINNET) {
    throw new InvalidConfigError('testnet must not poll the mainnet Iris host.');
  }
  if (config.network === 'mainnet' && attestationBaseUrl === IRIS_SANDBOX) {
    throw new InvalidConfigError('mainnet must not poll the sandbox Iris host.');
  }
```

- [ ] **Step 4: Repair fixtures across the suite**

Every `new AttestationClient({ ... })` without a host now throws, and every `createAnchorCCTP({})` without `network` or `attestationBaseUrl` now throws. Update fixtures in `attestation.test.ts`, `config.test.ts`, `receive.test.ts`, `security.test.ts`, `integration/` — prefer `network: 'testnet'` for production-shaped fixtures. Do **not** re-add a host default to the constructor.

Run: `npx jest packages/core/test --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attestation/index.ts packages/core/src/config.ts packages/core/test
git commit -m "fix(core): bind Iris host to network and fail closed without one"
```

---

### Task C4: Disambiguate multi-message transactions

**Files:**
- Modify: `packages/core/src/attestation/index.ts`
- Test: `packages/core/test/attestation.test.ts`

**Interfaces:**
- Produces: `pollAttestationByTx(sourceDomain, txHash, onPoll?, opts?: { expectedDestinationDomain?: number })`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('rejects a transaction with more than one complete message', async () => {
  const one = { message: '0x' + 'ab'.repeat(400), attestation: '0x' + 'cd'.repeat(65), status: 'complete' };
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [one, one] }) });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0 });
  await expect(client.pollAttestationByTx(6, '0x' + 'bc'.repeat(32))).rejects.toThrow(/ambiguous/i);
});

test('selects the message addressed to Stellar when several are present', async () => {
  const evm = {
    message: '0x' + 'aa'.repeat(400), attestation: '0x' + 'dd'.repeat(65), status: 'complete',
    decodedMessage: { destinationDomain: '6', finalityThresholdExecuted: '1000' },
  };
  const stellar = {
    message: '0x' + 'bb'.repeat(400), attestation: '0x' + 'ee'.repeat(65), status: 'complete',
    decodedMessage: { destinationDomain: '27', finalityThresholdExecuted: '2000' },
  };
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [evm, stellar] }) });
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET, fetchImpl, pollIntervalMs: 0 });
  const result = await client.pollAttestationByTx(6, '0x' + 'de'.repeat(32), undefined, { expectedDestinationDomain: 27 });
  expect(result.message).toBe(stellar.message);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage -t "more than one complete|addressed to Stellar"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `const msg = data.messages?.[0]`:

```typescript
        const complete = (data.messages ?? []).filter(
          (m) => m?.message && m.attestation && m.attestation !== 'PENDING' && m.status === 'complete'
        );
        const narrowed = opts?.expectedDestinationDomain === undefined
          ? complete
          : complete.filter((m) => Number(m.decodedMessage?.destinationDomain) === opts.expectedDestinationDomain);
        if (narrowed.length > 1) {
          throw new AttestationVerificationError(
            txHash,
            `ambiguous attestation: ${narrowed.length} complete messages match; pass expectedDestinationDomain`
          );
        }
        const msg = narrowed[0] ?? complete[0];
```

Add `destinationDomain?: number | string` to the inline `decodedMessage` type.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attestation/index.ts packages/core/test/attestation.test.ts
git commit -m "fix(core): disambiguate multi-message attestations"
```

---

### Task C5: Tighten the shape checks

**Files:**
- Modify: `packages/core/src/attestation/index.ts`
- Test: `packages/core/test/attestation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test('rejects a 32-byte message as not well formed', () => {
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET });
  expect(client.isWellFormedAttestation('0x' + 'ab'.repeat(32), '0x' + 'cd'.repeat(65))).toBe(false);
});

test('requires a signature length that is a multiple of 65 bytes', () => {
  const client = new AttestationClient({ baseUrl: IRIS_MAINNET });
  const message = '0x' + 'ab'.repeat(376);
  expect(client.isWellFormedAttestation(message, '0x' + 'cd'.repeat(66))).toBe(false);
  expect(client.isWellFormedAttestation(message, '0x' + 'cd'.repeat(130))).toBe(true);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage -t "32-byte message|multiple of 65"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
  isWellFormedAttestation(message: string, signature: string): boolean {
    if (!message || !signature || typeof message !== 'string' || typeof signature !== 'string') return false;
    const msg = message.trim();
    const sig = signature.trim();
    if (!/^0x[0-9a-fA-F]+$/.test(msg) || !/^0x[0-9a-fA-F]+$/.test(sig)) return false;
    if (msg.length % 2 !== 0 || sig.length % 2 !== 0) return false;
    const msgBytes = (msg.length - 2) / 2;
    const sigBytes = (sig.length - 2) / 2;
    if (msgBytes < 376) return false;
    return sigBytes > 0 && sigBytes % 65 === 0;
  }
```

Circles' attestation is concatenated 65-byte ECDSA components; a non-multiple means a truncated proof. State that in the JSDoc.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/attestation.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/attestation/index.ts packages/core/test/attestation.test.ts
git commit -m "fix(core): require canonical message and multi-sig attestation lengths"
```

---

## Exit criteria

- 400/429 terminal; 404 bounded at 3; 5xx retried (documented).
- `delayReason` read from the top-level row; empty complete attestation terminal.
- Default budget ≥ 20 min; deadline and abort both stop polling.
- No host defaults to mainnet; testnet/mainnet mismatch throws.
- Multi-message tx either narrows to one or throws.
- `npx jest packages/core/test/attestation.test.ts packages/core/test/config.test.ts --no-coverage` green; `npm run lint && npm run typecheck` clean.
