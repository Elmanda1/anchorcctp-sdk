# Track D — Soroban Submission Robustness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Make `submitMint` explain contract rejections instead of collapsing them into `MINT_FAILED`, survive an archived forwarder instance, handle every Soroban send status, and refuse to build a transaction the network is guaranteed to reject.

**Wave:** 1. Runs concurrently with tracks A, B, E.
**Files owned:** `packages/core/src/forwarder/index.ts`, `packages/core/test/forwarder.test.ts`.
**Preconditions:** phase 0 merged (`MintFailedError.contractCode` exists).

**Sources:** `circlefin/stellar-cctp` `contracts/cctp-forwarder/src/lib.rs` (7300–7318), `contracts/message-transmitter-v2/src/contract.rs` (6905/6906/6908), `contracts/token-messenger-minter-v2/src/contract.rs` (7116/7117/7119/7120), `stellar-cctp` forwarder `contract.rs` (`extend_instance_ttl`); Stellar RPC `sendTransaction` status enum.

---

### Task D1: Map contract errors from simulation

**Files:**
- Modify: `packages/core/src/forwarder/index.ts`
- Test: `packages/core/test/forwarder.test.ts`

**Interfaces:**
- Consumes: `MintFailedError(burnTxHash, reason, contractCode?)`.
- Produces: `CONTRACT_ERROR_NAMES` map; simulation `{ error }` handling.

- [ ] **Step 1: Write the failing test**

```typescript
test('maps a simulation contract error to a named typed failure', async () => {
  const rpc = makeRpc({
    simulateTransaction: async () => ({ error: 'HostError: Error(Contract, #7301)' }),
    assembleTransaction: () => 'assembled',
  });
  await expect(submitMint(makeParams(), async (x) => x, rpc, { maxAttempts: 1, pollIntervalMs: 0 }))
    .rejects.toMatchObject({
      contractCode: 7301,
      message: expect.stringContaining('InvalidMintRecipient'),
    });
});

test('an unrecognised contract code still carries the numeric code', async () => {
  const rpc = makeRpc({
    simulateTransaction: async () => ({ error: 'HostError: Error(Contract, #9999)' }),
    assembleTransaction: () => 'assembled',
  });
  await expect(submitMint(makeParams(), async (x) => x, rpc, { maxAttempts: 1, pollIntervalMs: 0 }))
    .rejects.toMatchObject({ contractCode: 9999 });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage -t "simulation contract error|unrecognised contract code"`
Expected: FAIL — the error response is passed to `assembleTransaction`.

- [ ] **Step 3: Implement**

```typescript
const CONTRACT_ERROR_NAMES: Record<number, string> = {
  6905: 'InvalidDestinationDomain', 6906: 'InvalidDestinationCaller', 6908: 'NonceAlreadyUsed',
  7116: 'UnsupportedFinalityThreshold', 7117: 'MessageExpired', 7119: 'InvalidLocalDecimals', 7120: 'DecimalConversion',
  7300: 'HookDataTooShort', 7301: 'InvalidMintRecipient', 7302: 'InvalidRecipient',
  7303: 'InvalidMessageVersion', 7305: 'InvalidBurnMessageFormat', 7313: 'InvalidHookVersion',
  7314: 'NoTokensMinted',
};

function contractCodeFrom(simError: string): number | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(simError);
  return m ? Number(m[1]) : undefined;
}
```

In `submitMint`, after the simulate call:

```typescript
    const simError = (sim as { error?: string } | undefined)?.error;
    if (simError) {
      const code = contractCodeFrom(simError);
      const name = code === undefined ? undefined : CONTRACT_ERROR_NAMES[code];
      throw new MintFailedError(params.message, `simulate: ${simError}${name ? ` (${name})` : ''}`, code);
    }
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/forwarder/index.ts packages/core/test/forwarder.test.ts
git commit -m "fix(core): surface Soroban contract error codes from simulation"
```

---

### Task D2: Restore archived entries and handle every send status

**Files:**
- Modify: `packages/core/src/forwarder/index.ts`
- Test: `packages/core/test/forwarder.test.ts`

**Interfaces:**
- Produces: `SorobanTransport.restoreFootprint?(xdr: string): Promise<string>`; `DUPLICATE` treated as sent; `TRY_AGAIN_LATER` retried once.

- [ ] **Step 1: Write the failing tests**

```typescript
test('restores an archived entry and re-simulates once', async () => {
  const calls: string[] = [];
  const rpc = makeRpc({
    simulateTransaction: async () => {
      calls.push('sim');
      return calls.length === 1 ? { restorePreamble: { transactionData: { readOnly: [] } } } : {};
    },
    restoreFootprint: async () => { calls.push('restore'); return 'restored-xdr'; },
    assembleTransaction: () => 'assembled',
  });
  await expect(submitMint(makeParams(), async (x) => x, rpc, { maxAttempts: 1, pollIntervalMs: 0 }))
    .resolves.toMatchObject({ txHash: expect.any(String) });
  expect(calls).toEqual(['sim', 'restore', 'sim']);
});

test('treats DUPLICATE as already sent and polls it', async () => {
  let polls = 0;
  const rpc = makeRpc({
    sendTransaction: async () => ({ status: 'DUPLICATE', hash: 'deadbeef' }),
    getTransaction: async () => ({ status: ++polls >= 2 ? 'SUCCESS' : 'NOT_FOUND' }),
    assembleTransaction: () => 'assembled',
  });
  await expect(submitMint(makeParams(), async (x) => x, rpc, { maxAttempts: 3, pollIntervalMs: 0 }))
    .resolves.toEqual({ txHash: 'deadbeef' });
});

test('retries TRY_AGAIN_LATER then succeeds', async () => {
  let sends = 0;
  const rpc = makeRpc({
    sendTransaction: async () => (++sends === 1 ? { status: 'TRY_AGAIN_LATER' } : { status: 'PENDING', hash: 'feed' }),
    assembleTransaction: () => 'assembled',
  });
  await expect(submitMint(makeParams(), async (x) => x, rpc, { maxAttempts: 2, pollIntervalMs: 0 }))
    .resolves.toEqual({ txHash: 'feed' });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage -t "archived entry|DUPLICATE|TRY_AGAIN_LATER"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
    const preamble = (sim as { restorePreamble?: unknown } | undefined)?.restorePreamble;
    if (preamble && rpc.restoreFootprint) {
      const restored = await rpc.restoreFootprint(xdr);
      sim = await rpc.simulateTransaction(restored)
        .catch((e) => { throw new MintFailedError(params.message, `simulate after restore: ${reason(e)}`); });
    }
```

```typescript
    let sent = await rpc.sendTransaction(signed);
    if (sent.status === 'TRY_AGAIN_LATER') {
      await sleep(1000);
      sent = await rpc.sendTransaction(signed);
    }
    if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
      throw new MintFailedError(params.message, `send status=${sent.status}`);
    }
    if (!sent.hash) {
      throw new MintFailedError(params.message, `send status=${sent.status} without a hash`);
    }
```

Add `restoreFootprint?(xdr: string): Promise<string>;` to the `SorobanTransport` interface with a JSDoc explaining it must return the restored envelope XDR.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/forwarder/index.ts packages/core/test/forwarder.test.ts
git commit -m "fix(core): restore archived entries and handle all Soroban send statuses"
```

---

### Task D3: Refuse guaranteed-invalid transactions

**Files:**
- Modify: `packages/core/src/forwarder/index.ts`
- Test: `packages/core/test/forwarder.test.ts`

**Interfaces:**
- Produces: `SorobanTransport.getAccountSequence?(address: string): Promise<string>`; `buildMintAndForwardXdr` throws `InvalidConfigError` for a missing forwarder, passphrase, or sequence.

- [ ] **Step 1: Write the failing tests**

```typescript
test('refuses an implicit testnet sequence of 0', () => {
  expect(() => buildMintAndForwardXdr({
    message: '00', signature: '00', sourceAccount: G_DEST,
    forwarderContractId: FWD, networkPassphrase: Networks.TESTNET,
  })).toThrow(InvalidConfigError);
});

test('refuses to build without an explicit forwarder', () => {
  expect(() => buildMintAndForwardXdr({
    message: '00', signature: '00', sourceAccount: G_DEST,
    sourceSequence: '42', networkPassphrase: Networks.TESTNET,
  })).toThrow(InvalidConfigError);
});

test('uses the transport-provided sequence when the caller omits one', async () => {
  const rpc = makeRpc({ getAccountSequence: async () => '99', assembleTransaction: () => 'assembled' });
  await expect(submitMint(makeParams({ sourceSequence: undefined }), async (x) => x, rpc, { maxAttempts: 1, pollIntervalMs: 0 }))
    .resolves.toMatchObject({ txHash: expect.any(String) });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage -t "implicit testnet sequence|explicit forwarder|transport-provided sequence"`
Expected: FAIL — `sourceSequence ?? '0'` and `DEFAULT_FORWARDER` still apply.

- [ ] **Step 3: Implement**

At the top of `buildMintAndForwardXdr`:

```typescript
  if (!params.forwarderContractId) {
    throw new InvalidConfigError('forwarderContractId is required — there is no implicit network default.');
  }
  if (!params.networkPassphrase) {
    throw new InvalidConfigError('networkPassphrase is required — pass Networks.TESTNET or Networks.PUBLIC.');
  }
  if (!params.sourceSequence || !/^\d+$/.test(params.sourceSequence)) {
    throw new InvalidConfigError('sourceSequence is required when the transport cannot supply one.');
  }
```

Resolve the sequence in `submitMint` before building:

```typescript
    const sourceSequence = params.sourceSequence
      ?? (rpc.getAccountSequence ? await rpc.getAccountSequence(params.sourceAccount) : undefined);
    if (!sourceSequence) {
      throw new InvalidConfigError(
        'sourceSequence is required: pass it explicitly or provide SorobanTransport.getAccountSequence(address). ' +
          'Using "0" builds a transaction the network rejects with txBAD_SEQ.'
      );
    }
    const xdr = buildMintAndForwardXdr({ ...params, sourceSequence });
```

Deprecate `DEFAULT_FORWARDER` (keep the export for compatibility, mark `@deprecated`, stop using it internally). Update call sites under `scripts/`, `packages/cli/`, and `apps/demo/` to pass `networkPassphrase` and a forwarder id.

- [ ] **Step 4: Fix the hookData comment**

In the same file, replace the "88-byte hookData" comment with: variable length, `32 + strkey length` — 88 bytes for `G...`/`C...`, 133 for `M...`.

- [ ] **Step 5: Run, verify PASS**

Run: `npx jest packages/core/test/forwarder.test.ts --no-coverage`
Expected: PASS. Update fixtures that relied on the defaults; do not restore them.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/forwarder/index.ts packages/core/test/forwarder.test.ts
git commit -m "fix(core): refuse transactions with implicit sequence, forwarder, or network"
```

---

## Exit criteria

- Simulation errors surface with `contractCode` and a contract name when known.
- Archived instance restores and re-simulates once; `DUPLICATE` polls; `TRY_AGAIN_LATER` retries.
- No implicit `sourceSequence: '0'`, no `DEFAULT_FORWARDER`, no default passphrase in the builder.
- `npx jest packages/core/test/forwarder.test.ts --no-coverage` green; `npm run lint && npm run typecheck` clean.
