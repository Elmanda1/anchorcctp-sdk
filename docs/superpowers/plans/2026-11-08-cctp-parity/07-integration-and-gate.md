# Wave 3 — Integration and Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Wire the seams the parallel tracks deliberately left alone, reconcile cross-track test fixtures, prove the five Review Focus behaviors, and run the full program gate.

**Wave:** 3. Requires phase 0 and both waves 1 and 2 merged.
**Files owned:** `packages/core/src/receive.ts` (one call site), test fixture files across `packages/core/test/`, no other source.
**Preconditions:** `git log --oneline` shows the phase 0 commit and every track's commits; `npm run typecheck` currently fails only where tracks disagree about fixtures, not about types.

---

### Task I1: Pass the expected destination domain into Iris polling

**Files:**
- Modify: `packages/core/src/receive.ts`
- Test: `packages/core/test/receive.test.ts`

**Why this was deferred:** track C added the `expectedDestinationDomain` option but track A owned the call site. Wiring it in wave 1 would have created a compile dependency between two parallel tracks.

- [ ] **Step 1: Write the failing test**

```typescript
test('receive asks Iris for the Stellar-addressed message only', async () => {
  const spy = jest.spyOn(AttestationClient.prototype, 'pollAttestationByTx');
  await anchor.receive({
    sourceDomain: 6, burnTxHash: '0x' + 'a2'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n,
  });
  expect(spy).toHaveBeenCalledWith(
    6,
    '0x' + 'a2'.repeat(32),
    expect.any(Function),
    expect.objectContaining({ expectedDestinationDomain: 27 })
  );
  spy.mockRestore();
});
```

Guard the spy on whichever client the fixture actually constructs; if the fixture injects `_test.attestation`, assert on the injected call instead.

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage -t "Stellar-addressed"`
Expected: FAIL — called with three arguments.

- [ ] **Step 3: Implement**

```typescript
  attResult = await ctx.attestationClient.pollAttestationByTx(
    sourceDomain,
    burnTxHash,
    onPollCallback,
    { expectedDestinationDomain: STELLAR_DOMAIN_ID }
  );
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receive.ts packages/core/test/receive.test.ts
git commit -m "fix(core): request only Stellar-addressed messages from Iris"
```

---

### Task I2: Reconcile cross-track test fixtures

**Files:**
- Modify as needed: `packages/core/test/receive.test.ts`, `packages/core/test/security.test.ts`, `packages/core/test/integration/**`, `packages/core/test/config.test.ts`

**Why:** track C removed the implicit Iris host, so any fixture that built a client through `createAnchorCCTP({})` without `network` or `attestationBaseUrl` now throws. Tracks A and D wrote their fixtures before C landed.

- [ ] **Step 1: Find every failing fixture**

Run: `npm run typecheck && npx jest packages/core/test --no-coverage`
Expected: failures naming `attestationBaseUrl is required` or `network required`.

- [ ] **Step 2: Apply one consistent fix**

For every fixture that represents a testnet deployment, pass `network: 'testnet'`. For fixtures that inject a fake fetch, pass `attestationBaseUrl: IRIS_SANDBOX` explicitly. Do not add a default back into `AttestationClient` or `createAnchorCCTP`.

- [ ] **Step 3: Run, verify PASS**

Run: `npx jest packages/core/test --no-coverage`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test
git commit -m "test(core): align fixtures with fail-closed network configuration"
```

---

### Task I3: Prove the five Review Focus behaviors

Each behavior must have a named, passing test. Run them by name so the proof is visible.

- [ ] **Step 1: Run the five named tests**

```bash
npx jest packages/core/test --no-coverage -t "375-byte"
npx jest packages/core/test --no-coverage -t "hookData names a different recipient"
npx jest packages/core/test --no-coverage -t "no host is rejected"
npx jest packages/core/test --no-coverage -t "contract destination"
npx jest packages/core/test --no-coverage -t "maxFee equal to amount"
```

Expected: one passing test per command.

- [ ] **Step 2: If any command matches nothing, stop**

A missing match means the owning track did not deliver the behavior or renamed the test. Fix the behavior in the owning file; do not rename the test to make the command pass.

- [ ] **Step 3: Record the evidence**

Append to `docs/evidence/completion-summary.md` (create the entry if the file exists for a larger report; otherwise skip and note the run in the final commit body):

```
CCTP parity gate 2026-11-08:
- 375-byte frame rejected before network I/O
- hookData recipient bound to destinationAddress
- no implicit Iris host
- C.../M... destination settles without a classic trustline
- maxFee == amount rejected pre-broadcast
```

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/completion-summary.md
git commit -m "test(core): record parity gate evidence"
```

---

### Task I4: Full gate

- [ ] **Step 1: Run lint, typecheck, tests with coverage**

```bash
npm run lint && npm run typecheck && npm run test -- --coverage
```

Expected: lint clean, typecheck clean, every suite passes.

- [ ] **Step 2: Compute coverage**

```bash
node -e "
const c=require('./coverage/coverage-final.json');let st=[0,0],br=[0,0],fn=[0,0];
for(const v of Object.values(c)){
 for(const n of Object.values(v.s)){st[0]++;if(n>0)st[1]++}
 for(const a of Object.values(v.b)){for(const n of a){br[0]++;if(n>0)br[1]++}}
 for(const n of Object.values(v.f)){fn[0]++;if(n>0)fn[1]++}
}
const p=(a)=>((a[1]/a[0]*100).toFixed(1)+'% ('+a[1]+'/'+a[0]+')');
console.log('stmts',p(st));console.log('branches',p(br));console.log('functions',p(fn));
"
```

Expected: statements ≥ 90%. Baseline 92.9% / 88.5% / 94.1%.

- [ ] **Step 3: Re-run the parity spot checks**

```bash
npx jest packages/core/test/cctp-message.test.ts packages/core/test/receive.test.ts \
  packages/core/test/attestation.test.ts packages/core/test/evm-burn.test.ts \
  packages/core/test/domains.test.ts packages/core/test/forwarder.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 4: Audit for weakened assertions**

```bash
git log --oneline main..HEAD
git diff main -- packages/core/test | grep -E "^-.*expect\(" | head -50
```

Every removed assertion must be justified in its commit body by a behavior change, never by "test was failing". If a removal is unjustified, restore it and fix the code.

- [ ] **Step 5: Confirm the spec's citations resolve**

```bash
grep -oE 'https://developers\.circle\.com[^ )]*' docs/superpowers/specs/2026-11-05-circle-cctp-parity-design.md
```

Spot-check that none of them is `/cctp/supported-domains`, `/cctp/v2`, or `/cctp/quickstart` — all three 404.

- [ ] **Step 6: Final commit for any gate fixes**

```bash
git add -A packages/core packages/cli docs apps
git commit -m "test: close the parity gate"
```

---

## Program self-review checklist

- [ ] Every audit finding maps to a merged task. Use `00-overview.md` "Coverage Map" as the index; sweep it once against `git log --oneline main..HEAD`.
- [ ] No track changed a cross-track contract unilaterally; `grep` the signatures listed in `00-overview.md` and confirm they match.
- [ ] Deliberate divergences are commented at the code site: 5xx retry (track C), zero-magic hook data (track B comment), forced `destinationCaller` (track A).
- [ ] Out-of-scope items are untouched: no `stellar/burn` module, no V1 paths, no re-attestation automation, no fee-stats integration.
- [ ] The ignored `graphify-out/graph.json` remains absent; no task depends on it.
