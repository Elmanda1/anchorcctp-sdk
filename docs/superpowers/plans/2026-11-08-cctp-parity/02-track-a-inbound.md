# Track A — Inbound Frame Trust Boundary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Make `receive()` refuse any attested frame that does not address this chain, this forwarder, and the caller's destination — and stop forcing `C...`/`M...` destinations through a classic trustline.

**Wave:** 1. Runs concurrently with tracks B, D, E.
**Files owned:** `packages/core/src/cctp-message.ts`, `packages/core/src/receive.ts`, `packages/core/src/trustline/index.ts`, `packages/core/src/replay/index.ts`, plus `packages/core/test/cctp-message.test.ts`, `packages/core/test/receive.test.ts`, `packages/core/test/trustline.test.ts`, `packages/core/test/replay.test.ts`.
**Preconditions:** phase 0 merged. Read `00-overview.md` "Cross-track contracts" before starting.

**Why the trust boundary lives here:** the SDK never sees the private key, never verifies signatures, and cannot ask the chain whether a message is valid before broadcasting. The only guard it can offer is refusing frames whose declared contents contradict what the caller asked for. Today it checks one field (amount); this track checks all of them.

---

### Task A1: Decode the full V2 message

**Files:**
- Modify: `packages/core/src/cctp-message.ts`
- Test: `packages/core/test/cctp-message.test.ts`

**Interfaces:**
- Produces: `decodeCctpMessage`, `MIN_MESSAGE_BYTES = 376`, `HOOK_DATA_ABS = 376`, `DecodedCctpMessage`; `parseTransferAmounts` remains as a delegating alias.

- [ ] **Step 1: Write the failing tests**

```typescript
import { decodeCctpMessage, MIN_MESSAGE_BYTES } from '../src/cctp-message.js';

function buildFrame(overrides: {
  version?: number; sourceDomain?: number; destinationDomain?: number;
  minFinality?: number; executed?: number; burnVersion?: number;
  amount?: bigint; maxFee?: bigint; fee?: bigint; expirationBlock?: bigint;
  hookHex?: string;
} = {}): string {
  const hook = Buffer.from(overrides.hookHex ?? '', 'hex');
  const buf = Buffer.alloc(MIN_MESSAGE_BYTES + hook.length);
  buf.writeUInt32BE(overrides.version ?? 1, 0);
  buf.writeUInt32BE(overrides.sourceDomain ?? 6, 4);
  buf.writeUInt32BE(overrides.destinationDomain ?? 27, 8);
  Buffer.alloc(32, 0x11).copy(buf, 12);
  Buffer.alloc(32, 0x22).copy(buf, 44);
  Buffer.alloc(32, 0x33).copy(buf, 76);
  Buffer.alloc(32, 0x44).copy(buf, 108);
  buf.writeUInt32BE(overrides.minFinality ?? 1000, 140);
  buf.writeUInt32BE(overrides.executed ?? 1000, 144);
  buf.writeUInt32BE(overrides.burnVersion ?? 1, 148);
  Buffer.alloc(32, 0x55).copy(buf, 152);
  Buffer.alloc(32, 0x66).copy(buf, 184);
  const put = (abs: number, v: bigint) => buf.write(v.toString(16).padStart(64, '0'), abs, 'hex');
  put(216, overrides.amount ?? 1_000_000n);
  Buffer.alloc(32, 0x77).copy(buf, 248);
  put(280, overrides.maxFee ?? 13n);
  put(312, overrides.fee ?? 13n);
  put(344, overrides.expirationBlock ?? 0n);
  hook.copy(buf, 376);
  return '0x' + buf.toString('hex');
}

test('rejects a 375-byte frame the old 344-byte floor accepted', () => {
  expect(() => decodeCctpMessage(buildFrame().slice(0, 2 + 375 * 2))).toThrow(AttestationVerificationError);
});

test('rejects odd-length and non-hex payloads instead of truncating', () => {
  expect(() => decodeCctpMessage('0xabc')).toThrow(AttestationVerificationError);
  expect(() => decodeCctpMessage('0x' + 'zz'.repeat(400))).toThrow(AttestationVerificationError);
});

test('decodes every canonical field', () => {
  const f = decodeCctpMessage(buildFrame({ amount: 2_500_000n, maxFee: 13n, fee: 13n }));
  expect(f).toMatchObject({
    version: 1, sourceDomain: 6, destinationDomain: 27, burnVersion: 1,
    minFinalityThreshold: 1000, finalityThresholdExecuted: 1000,
    amount: 2_500_000n, maxFee: 13n, feeExecuted: 13n, expirationBlock: 0n,
  });
  expect(f.nonce).toHaveLength(66);
});

test('extracts the forwarded strkey from hook data', () => {
  const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const bytes = Buffer.from(recipient, 'utf8');
  const hook = Buffer.alloc(32 + bytes.length);
  hook.writeUInt32BE(0, 24);
  hook.writeUInt32BE(bytes.length, 28);
  bytes.copy(hook, 32);
  expect(decodeCctpMessage(buildFrame({ hookHex: hook.toString('hex') })).hookRecipient).toBe(recipient);
});

test('parseTransferAmounts still works', () => {
  expect(parseTransferAmounts(buildFrame({ amount: 7n, fee: 3n }))).toEqual({ amount: 7n, feeExecuted: 3n });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/cctp-message.test.ts --no-coverage`
Expected: FAIL — `decodeCctpMessage` and `MIN_MESSAGE_BYTES` missing; 375-byte frame accepted.

- [ ] **Step 3: Implement**

Replace the module body. Keep the file's existing imports. Structure:

```typescript
const MESSAGE_HEADER_BYTES = 148;   // MessageV2 header
const BURN_BODY_BYTES = 228;        // BurnMessageV2 through HOOK_DATA_INDEX
export const MIN_MESSAGE_BYTES = 376;
export const HOOK_DATA_ABS = 376;
const AMOUNT_ABS = 216;
const FEE_ABS = 312;
const HEX_RE = /^[0-9a-fA-F]+$/;

export interface DecodedCctpMessage {
  version: number; sourceDomain: number; destinationDomain: number; nonce: string;
  sender: string; recipient: string; destinationCaller: string;
  minFinalityThreshold: number; finalityThresholdExecuted: number;
  burnVersion: number; burnToken: string; mintRecipient: string;
  amount: bigint; messageSender: string; maxFee: bigint; feeExecuted: bigint;
  expirationBlock: bigint; hookData: string; hookRecipient?: string;
}

export function decodeCctpMessage(messageHex: string): DecodedCctpMessage {
  // strict hex: reject empty, odd length, non-hex; then length >= MIN_MESSAGE_BYTES
  // u32 at 0, 4, 8, 140, 144, 148
  // h32 (0x + 32 bytes) at 12, 44, 76, 108, 152, 184, 248
  // u256 at 216, 280, 312, 344
  // hookData = bytes.slice(376) as hex
  // hookRecipient: when length >= 408 and u32(376+24) === 0, read len at 376+28,
  //   bounds-check, decode utf8
}

/** @deprecated Prefer decodeCctpMessage. */
export function parseTransferAmounts(hex: string): { amount: bigint; feeExecuted: bigint } {
  const { amount, feeExecuted } = decodeCctpMessage(hex);
  return { amount, feeExecuted };
}
```

Every rejection throws `AttestationVerificationError` with a reason naming the field or length. Do not return partial data.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/cctp-message.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cctp-message.ts packages/core/test/cctp-message.test.ts
git commit -m "fix(core): decode full CCTP v2 message and require the 376-byte canonical length"
```

---

### Task A2: Bind the attested frame to the caller's parameters

**Files:**
- Modify: `packages/core/src/receive.ts`
- Test: `packages/core/test/receive.test.ts`

**Interfaces:**
- Consumes: `decodeCctpMessage` (A1), `contractStrkeyToBytes32` from `evm/hook.js`.
- Produces: `validateInboundFrame(frame, expected)` internal helper; `ReceiveParams.sourceChainBlockNumber?: number`.

- [ ] **Step 1: Write the failing tests**

```typescript
test('rejects a frame whose hookData names a different recipient', async () => {
  const rigged = makeAnchor({ frameRecipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' });
  await expect(rigged.receive({
    sourceDomain: 6, burnTxHash: '0x' + 'cd'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n,
  })).rejects.toThrow(/hookData recipient .* does not match destinationAddress/);
});

test('rejects a frame whose sourceDomain differs from the request', async () => {
  await expect(anchor.receive({
    sourceDomain: 5, burnTxHash: '0x' + 'ef'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n,
  })).rejects.toThrow(/sourceDomain 6 .* requested 5/);
});

test('rejects non-V2 header and body versions and a non-Stellar destination', async () => {
  for (const bad of [{ version: 2 }, { burnVersion: 0 }, { destinationDomain: 6 }]) {
    const rigged = makeAnchor({ frameOverrides: bad });
    await expect(rigged.receive({
      sourceDomain: 6, burnTxHash: '0x' + '11'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n,
    })).rejects.toThrow(AttestationVerificationError);
  }
});

test('rejects a mintRecipient that is not the configured forwarder', async () => {
  const rigged = makeAnchor({ frameOverrides: { mintRecipient: '0x' + '99'.repeat(32) } });
  await expect(rigged.receive({
    sourceDomain: 6, burnTxHash: '0x' + '22'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n,
  })).rejects.toThrow(/mintRecipient .* does not match forwarder/);
});

test('rejects feeExecuted >= amount', async () => {
  const rigged = makeAnchor({ frameOverrides: { amount: 100n, fee: 100n } });
  await expect(rigged.receive({
    sourceDomain: 6, burnTxHash: '0x' + '33'.repeat(32), destinationAddress: G_DEST, amount: 100n,
  })).rejects.toThrow(InvalidAmountError);
});
```

Wire `makeAnchor` in `receive.test.ts` to build full frames via the same builder as A1, exposing `frameRecipient` and `frameOverrides`.

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage -t "hookData names|sourceDomain differs|non-V2 header|not the configured forwarder|feeExecuted"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add above `receive()`:

```typescript
const STELLAR_DOMAIN_ID = 27;

function validateInboundFrame(
  frame: DecodedCctpMessage,
  expected: {
    sourceDomain: number;
    destinationAddress: string;
    forwarderContractId: string;
    amount: bigint;
    sourceChainBlockNumber?: number;
  }
): void {
  if (frame.version !== 1) throw new AttestationVerificationError('frame', `unsupported message version ${frame.version}`);
  if (frame.burnVersion !== 1) throw new AttestationVerificationError('frame', `unsupported burn version ${frame.burnVersion}`);
  if (frame.destinationDomain !== STELLAR_DOMAIN_ID) {
    throw new AttestationVerificationError('frame', `destinationDomain ${frame.destinationDomain} is not Stellar (27)`);
  }
  if (frame.sourceDomain !== expected.sourceDomain) {
    throw new AttestationVerificationError('frame', `sourceDomain ${frame.sourceDomain} does not match requested ${expected.sourceDomain}`);
  }
  if (frame.feeExecuted >= frame.amount) {
    throw new InvalidAmountError(`feeExecuted ${frame.feeExecuted} must be below amount ${frame.amount}`);
  }
  if (frame.amount !== expected.amount) {
    throw new InvalidAmountError(`attested amount ${frame.amount} does not match caller amount ${expected.amount}`);
  }
  const forwarded = contractStrkeyToBytes32(expected.forwarderContractId);
  if (frame.mintRecipient.toLowerCase() !== forwarded.toLowerCase()) {
    throw new AttestationVerificationError('frame', `mintRecipient ${frame.mintRecipient} does not match forwarder ${forwarded}`);
  }
  const declared = translateToStellar(expected.destinationAddress);
  if (frame.hookRecipient !== undefined && frame.hookRecipient !== declared) {
    throw new AttestationVerificationError('frame', `hookData recipient ${frame.hookRecipient} does not match destinationAddress ${declared}`);
  }
  if (expected.sourceChainBlockNumber !== undefined && frame.expirationBlock !== 0n
      && frame.expirationBlock < BigInt(expected.sourceChainBlockNumber)) {
    throw new AttestationVerificationError('frame', `message expired at block ${frame.expirationBlock}`);
  }
}
```

In `receive()`: resolve `forwarderContractId` **before** the trustline step (delete the later duplicate lookup), then:

```typescript
  const frame = decodeCctpMessage(attResult.message);
  validateInboundFrame(frame, {
    sourceDomain, destinationAddress, forwarderContractId, amount,
    ...(params.sourceChainBlockNumber === undefined ? {} : { sourceChainBlockNumber: params.sourceChainBlockNumber }),
  });
  const feeExecuted = frame.feeExecuted;
```

Delete the later `parseTransferAmounts` call.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage`
Expected: PASS. Existing tests using short `0x` fixtures must be upgraded to `buildFrame`; do not relax the new checks.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receive.ts packages/core/test/receive.test.ts
git commit -m "fix(core): bind attested message to destination, forwarder, and source domain"
```

---

### Task A3: Stop requiring classic trustlines for C/M destinations

**Files:**
- Modify: `packages/core/src/receive.ts`
- Modify: `packages/core/src/trustline/index.ts`
- Test: `packages/core/test/receive.test.ts`, `packages/core/test/trustline.test.ts`

**Interfaces:**
- Produces: `isClassicAccount(dest: string): boolean` from `trustline/index.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
const CONTRACT_DEST = 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP';

test('does not require a trustline provider for a contract destination', async () => {
  const noProvider = makeAnchor({ trustlineProvider: undefined, _testHasTrustline: undefined });
  await expect(noProvider.receive({
    sourceDomain: 6, burnTxHash: '0x' + '44'.repeat(32), destinationAddress: CONTRACT_DEST, amount: 1_000_000n,
  })).resolves.toMatchObject({ txHash: expect.any(String) });
});

test('does not require a G... dust collector when dust is zero', async () => {
  await expect(anchor.receive({
    sourceDomain: 6, burnTxHash: '0x' + '55'.repeat(32), destinationAddress: CONTRACT_DEST, amount: 1_000_000n,
  })).resolves.toMatchObject({ dust: 0n });
});

test('classifies G, M, and C StrKeys', () => {
  expect(isClassicAccount('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).toBe(true);
  expect(isClassicAccount(CONTRACT_DEST)).toBe(false);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/receive.test.ts packages/core/test/trustline.test.ts --no-coverage -t "contract destination|dust collector when dust|classifies"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`trustline/index.ts`:

```typescript
export function isClassicAccount(dest: string): boolean {
  return typeof dest === 'string' && StrKey.isValidEd25519PublicKey(dest);
}
```

`receive.ts`: wrap the whole trustline block (provider lookup, `ensureTrustline`) in `if (isClassicAccount(stellarDestination)) { ... }`, and guard dust-collector validation:

```typescript
  if (dust > 0n && !StrKey.isValidEd25519PublicKey(effectiveDustCollector)) {
    throw new InvalidConfigError(`dustCollectorAddress must be a valid G... StrKey, got: "${effectiveDustCollector}"`);
  }
```

Add a `resolveDustCollector` JSDoc line: inbound dust is structurally `0n`, so the collector is consulted only once outbound dust routing exists.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/receive.test.ts packages/core/test/trustline.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receive.ts packages/core/src/trustline/index.ts packages/core/test/receive.test.ts packages/core/test/trustline.test.ts
git commit -m "fix(core): support contract and muxed destinations without classic trustlines"
```

---

### Task A4: Split sponsor and owner signing roles

**Files:**
- Modify: `packages/core/src/receive.ts`
- Test: `packages/core/test/receive.test.ts`

**Interfaces:**
- Produces: `ReceiveParams.sponsorSigner?: SignerCallback`; `signer` now means the destination owner, used for change-trust only; `sponsorSigner` defaults to `signer` when absent.

- [ ] **Step 1: Write the failing test**

```typescript
test('signs change-trust with the owner and the mint with the sponsor', async () => {
  const ownerSigner = jest.fn(async (x: string) => x);
  const sponsorSigner = jest.fn(async (x: string) => x);
  const rigged = makeAnchor({ trustlineProvider: mixedRoleProvider(), sponsorAccount: G_SPONSOR });
  await rigged.receive({
    sourceDomain: 6, burnTxHash: '0x' + 'a1'.repeat(32), destinationAddress: G_DEST,
    amount: 1_000_000n, signer: ownerSigner, sponsorSigner,
  });
  expect(ownerSigner).toHaveBeenCalledTimes(1);
  expect(sponsorSigner).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage -t "owner and the mint with the sponsor"`
Expected: FAIL — `sponsorSigner` ignored; the mint uses the owner signer.

- [ ] **Step 3: Implement**

```typescript
  const ownerSigner = params.signer ?? ctx.defaultSigner;
  const sponsorSigner = params.sponsorSigner ?? ownerSigner;
```

Use `ownerSigner` for the `_test.createTrustline` fallback, pass `sponsorSigner` to `submitMint`. Keep the existing "no signer configured" error when `ownerSigner` is undefined.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receive.ts packages/core/test/receive.test.ts
git commit -m "fix(core): separate sponsor mint signer from destination trustline signer"
```

---

### Task A5: Record and enforce the executed finality tier

**Files:**
- Modify: `packages/core/src/receive.ts`
- Modify: `packages/core/src/replay/index.ts`
- Test: `packages/core/test/receive.test.ts`

**Interfaces:**
- Produces: `ReceiveParams.minFinalityThreshold?: number`; `SettlementRecord.minFinalityThresholdExecuted?: number` and `delayReason?: string | null`.

- [ ] **Step 1: Write the failing test**

```typescript
test('rejects an executed tier below the requested one and records the tier otherwise', async () => {
  await expect(makeAnchor({ executedTier: 1000 }).receive({
    sourceDomain: 6, burnTxHash: '0x' + 'f0'.repeat(32), destinationAddress: G_DEST,
    amount: 1_000_000n, minFinalityThreshold: 2000,
  })).rejects.toThrow(/executed finality 1000 is below requested 2000/);

  const ok = makeAnchor({ executedTier: 2000 });
  await ok.receive({ sourceDomain: 6, burnTxHash: '0x' + 'f1'.repeat(32), destinationAddress: G_DEST, amount: 1_000_000n });
  expect(ok.store.get('0x' + 'f1'.repeat(32))?.minFinalityThresholdExecuted).toBe(2000);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest packages/core/test/receive.test.ts --no-coverage -t "executed tier"`
Expected: FAIL.

- [ ] **Step 3: Implement**

After frame validation:

```typescript
  if (params.minFinalityThreshold !== undefined
      && attResult.finalityThresholdExecuted !== undefined
      && attResult.finalityThresholdExecuted < params.minFinalityThreshold) {
    throw new AttestationVerificationError(
      burnTxHash,
      `executed finality ${attResult.finalityThresholdExecuted} is below requested ${params.minFinalityThreshold}`
    );
  }
```

Add to the `SettlementRecord` built in `receive.ts`:

```typescript
    ...(attResult.finalityThresholdExecuted === undefined ? {} : { minFinalityThresholdExecuted: attResult.finalityThresholdExecuted }),
    ...(attResult.delayReason === undefined ? {} : { delayReason: attResult.delayReason }),
```

Declare both optional fields on `SettlementRecord` in `replay/index.ts`.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest packages/core/test/receive.test.ts packages/core/test/replay.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receive.ts packages/core/src/replay/index.ts packages/core/test/receive.test.ts
git commit -m "feat(core): enforce and record the executed finality tier"
```

---

## Exit criteria

- A 375-byte frame, a wrong-domain frame, a wrong-version frame, a wrong-recipient frame, and a `fee >= amount` frame all throw before any network call.
- A `C...` destination settles with no trustline provider.
- Owner and sponsor signers are distinct and each is called once in the mixed-role test.
- `npx jest packages/core/test/cctp-message.test.ts packages/core/test/receive.test.ts packages/core/test/trustline.test.ts packages/core/test/replay.test.ts --no-coverage` green.
- `npm run lint && npm run typecheck` clean.
