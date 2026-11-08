# Track B — EVM Burn Bounds and Domain Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Make `planBurn`/`resolveMaxFee` emit only values `TokenMessengerV2` accepts, match the canonical ABI, and correct the domain registry to Circle's current table.

**Wave:** 1. Runs concurrently with tracks A, D, E.
**Files owned:** `packages/core/src/evm/burn.ts`, `packages/core/src/domains/index.ts`, `packages/core/src/evm/hook.ts` (comment only), plus their tests.
**Preconditions:** phase 0 merged (no changes needed from it in this track).

**Sources:** `circlefin/evm-cctp-contracts` `src/v2/TokenMessengerV2.sol`, `src/v2/BaseTokenMessenger.sol`, `docs/abis/cctp/v2/TokenMessengerV2.json`; `circlefin/cctp-go` `transfer.go`, `chains.go`; Circle supported-chains page.

---

### Task B1: Enforce the contract's `maxFee` bound and add the fee buffer

**Files:**
- Modify: `packages/core/src/evm/burn.ts`
- Test: `packages/core/test/evm-burn.test.ts`

**Interfaces:**
- Produces: `resolveMaxFee(amount, minimumFeeBps, opts?: { bufferBps?: number }): bigint`; `planBurn` rejects `maxFee >= amount`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('rejects maxFee equal to amount', () => {
  expect(() => planBurn({ amount: 1000n, stellarDestination: G_DEST, forwarderContractId: FWD, maxFee: 1000n }))
    .toThrow(/maxFee must be below amount/);
});

test('resolveMaxFee adds the upstream +1 bp buffer', () => {
  // 1,000,000 * (1.3 + 1) / 10,000 = 230, ceiling
  expect(resolveMaxFee(1_000_000n, 1.3)).toBe(230n);
});

test('resolveMaxFee floors a positive quote at one unit and keeps zero at zero', () => {
  expect(resolveMaxFee(1n, 0)).toBe(0n);
  expect(resolveMaxFee(1n, 0.0001)).toBe(1n);
});

test('resolveMaxFee rejects a fee that consumes the amount', () => {
  expect(() => resolveMaxFee(1000n, 10_000)).toThrow(BurnError);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/evm-burn.test.ts --no-coverage -t "maxFee equal|1 bp buffer|floors a positive|consumes the amount"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Plan bound:

```typescript
  if (maxFee >= params.amount) {
    throw new BurnError('INVALID_BURN_AMOUNT', `maxFee must be below amount: ${maxFee} >= ${params.amount}`);
  }
```

Resolver:

```typescript
export function resolveMaxFee(
  amount: bigint,
  minimumFeeBps: number,
  opts: { bufferBps?: number } = {}
): bigint {
  if (!Number.isFinite(minimumFeeBps) || minimumFeeBps < 0) {
    throw new BurnError('INVALID_BURN_AMOUNT', `minimumFeeBps must be a non-negative number, got ${minimumFeeBps}`);
  }
  const bufferBps = opts.bufferBps ?? 1; // cctp-go: feeWithBuffer := feeBps + 1
  const scaled = BigInt(Math.round((minimumFeeBps + bufferBps) * 10));
  if (scaled === 0n) return 0n;
  const result = (amount * scaled + 100_000n - 1n) / 100_000n;
  if (result >= amount) throw new BurnError('INVALID_BURN_AMOUNT', `maxFee must be below amount: ${result} >= ${amount}`);
  return result === 0n ? 1n : result;
}
```

Update the JSDoc to say the value includes Circle's recommended buffer and must satisfy `_maxFee < _amount`.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/evm-burn.test.ts --no-coverage`
Expected: PASS. Existing assertions pinned to the unbuffered quote change; update those numbers deliberately.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/evm/burn.ts packages/core/test/evm-burn.test.ts
git commit -m "fix(core): enforce strict maxFee bound and add the upstream fee buffer"
```

---

### Task B2: Drop the phantom ABI return value

**Files:**
- Modify: `packages/core/src/evm/burn.ts`
- Test: `packages/core/test/evm-burn.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('the messenger ABI has no outputs, matching TokenMessengerV2', () => {
  const entry = MESSENGER_ABI.find((i) => i.type === 'function' && i.name === 'depositForBurnWithHook');
  expect(entry && 'outputs' in entry ? entry.outputs : []).toEqual([]);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/evm-burn.test.ts --no-coverage -t "no outputs"`
Expected: FAIL — ABI declares `returns (uint64)`.

- [ ] **Step 3: Implement**

Remove ` returns (uint64)` from the `parseAbi` string. Keep the eight-parameter signature and order unchanged.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/evm-burn.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/evm/burn.ts packages/core/test/evm-burn.test.ts
git commit -m "fix(core): match the canonical depositForBurnWithHook ABI"
```

---

### Task B3: Complete the domain registry

**Files:**
- Modify: `packages/core/src/domains/index.ts`
- Test: `packages/core/test/domains.test.ts`

**Interfaces:**
- Produces: 31 entries; `DomainMeta.networkType` widened to `'EVM' | 'SVM' | 'Move' | 'Cairo' | 'Stellar'`; new `instantFinality: boolean` and `testnetOnly?: boolean`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('registry covers every CCTP v2 domain, including Sui', () => {
  expect(Object.keys(CCTP_DOMAINS)).toHaveLength(31);
  expect(CCTP_DOMAINS[8]).toMatchObject({ chain: 'sui', name: 'Sui' });
  expect(isSupportedDomain(8)).toBe(true);
});

test('Starknet is not classified as EVM', () => {
  expect(CCTP_DOMAINS[25].networkType).not.toBe('EVM');
});

test('finality metadata marks instant-finality sources', () => {
  for (const id of [1, 7, 13, 16, 18, 19]) expect(CCTP_DOMAINS[id].instantFinality).toBe(true);
  expect(CCTP_DOMAINS[0].instantFinality).toBe(false);
  expect(CCTP_DOMAINS[27].instantFinality).toBe(false);
});

test('Arc is testnet-only', () => {
  expect(CCTP_DOMAINS[26].testnetOnly).toBe(true);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/domains.test.ts --no-coverage`
Expected: FAIL — 30 entries, no Sui, Starknet is EVM, no metadata fields.

- [ ] **Step 3: Implement**

Add:

```typescript
  8: { domainId: 8, chain: 'sui', name: 'Sui', networkType: 'Move', instantFinality: true },
  25: { domainId: 25, chain: 'starknet', name: 'Starknet', networkType: 'Cairo', instantFinality: false },
  26: { domainId: 26, chain: 'arc', name: 'Arc', networkType: 'EVM', instantFinality: true, testnetOnly: true },
```

Set `instantFinality` on every existing row: `true` for 1, 7, 13, 16, 18, 19; `false` otherwise. Widen `DomainMeta.networkType` to include `'Cairo'`. Update the file's header comment from 30 to 31 chains.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/domains.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domains/index.ts packages/core/test/domains.test.ts
git commit -m "fix(core): add Sui, correct Starknet type, and carry finality metadata"
```

---

### Task B4: Derive the default transfer tier from source finality

**Files:**
- Modify: `packages/core/src/evm/burn.ts`
- Modify: `packages/core/src/evm/hook.ts` (comment only)
- Test: `packages/core/test/evm-burn.test.ts`

**Interfaces:**
- Produces: `resolveTransferMode(sourceDomain, requested?): 'fast' | 'standard'`; `PlanBurnParams.sourceChainDomain?: number`.

- [ ] **Step 1: Write the failing test**

```typescript
test('an instant-finality source defaults to standard, others to fast', () => {
  expect(resolveTransferMode(1, undefined)).toBe('standard');   // Avalanche: instant finality
  expect(resolveTransferMode(6, undefined)).toBe('fast');       // Base
  expect(resolveTransferMode(6, 'standard')).toBe('standard');
  expect(resolveTransferMode(0, undefined)).toBe('fast');
});
```

Before writing, reconcile with the live quote: `GET https://iris-api.circle.com/v2/burn/USDC/fees/6/27` returns both a 1000 and a 2000 tier, so Fast into Stellar is genuinely offered. This task changes only the *default*, never removes a tier.

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/evm-burn.test.ts --no-coverage -t "instant-finality source"`
Expected: FAIL — no such export.

- [ ] **Step 3: Implement**

```typescript
/**
 * Default transfer tier for a source domain. Instant-finality sources gain nothing
 * from Fast, matching cctp-go's auto-selection; every other source defaults to Fast.
 */
export function resolveTransferMode(
  sourceDomain: number,
  requested?: 'fast' | 'standard'
): 'fast' | 'standard' {
  if (requested) return requested;
  const meta = CCTP_DOMAINS[sourceDomain];
  return meta?.instantFinality ? 'standard' : 'fast';
}
```

In `planBurn`: `const mode = resolveTransferMode(params.sourceChainDomain ?? 6, params.transferMode);` and add `sourceChainDomain?: number` with a JSDoc naming the EVM domain of the source chain.

- [ ] **Step 4: Fix the hook comment**

In `evm/hook.ts`, state that bytes 0–23 are Circle-reserved and must be all zero per Circle's Stellar reference, and that the forwarder contract does not read them. No encoding change.

- [ ] **Step 5: Run, verify PASS**

Run: `npx jest packages/core/test/evm-burn.test.ts packages/core/test/evm-hook.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/evm/burn.ts packages/core/src/evm/hook.ts packages/core/test/evm-burn.test.ts
git commit -m "feat(core): select transfer tier from source-chain finality"
```

---

## Exit criteria

- `maxFee === amount` throws; buffered quote matches the cctp-go formula; positive quote never yields zero.
- ABI entry has zero outputs.
- Registry has 31 domains including Sui 8, Starknet is `Cairo`, Arc is `testnetOnly`, finality flags set.
- `npm run lint && npm run typecheck` clean; the two focused jest files green.
