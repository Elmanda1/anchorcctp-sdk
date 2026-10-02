// apps/demo/server/handlers.test.ts
// Framework-free handler + KV store tests. Fake in-memory KV mirrors kv.ts.
import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  buildCsp,
  CSP,
  handleFees,
  handleInitiate,
  handleSettle,
  handleStatus,
  trustedClientIp,
  SECURITY_HEADERS,
  IRIS_TIMEOUT_MS,
  NO_STORE,
} from './handlers.js';
import type { HandlerDeps, HandlerResult } from './handlers.js';
import {
  MemoryBuckets,
  MemoryFeeCache,
  MemoryIntentStore,
  MemoryLock,
  MemoryReplayStore,
  KvIntentStore,
  RedisReplayStore,
  assertColdStartEnv,
  decodeSettlementRecord,
  depsFromEnv,
  encodeSettlementRecord,
  DEFAULT_FAST_WINDOW_MS,
  INTENT_TTL_MS,
  SETTLE_MAX_RETRIES,
} from './kv.js';
import type { BucketStore, StoredIntent } from './kv.js';
import { publicConfigBundle } from './events.js';
import {
  AttestationTimeoutError,
  FileReplayStore,
  MintFailedError,
  MintUnconfirmedError,
} from '@anchor-cctp/core-sdk';
import type { ReceiveResult, SettlementRecord } from '@anchor-cctp/core-sdk';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// Vercel entrypoints (repo-root `api/*`) — thin wrappers over the handlers above.
import configEntry, { createHandler as createConfigRoute } from '../../../api/config.js';
import feesEntry, { createHandler as createFeesRoute } from '../../../api/fees.js';
import initiateEntry, { createHandler as createInitiateRoute } from '../../../api/receive/initiate.js';
import settleEntry, { createHandler as createSettleRoute } from '../../../api/receive/settle.js';
import statusEntry, { createHandler as createStatusRoute } from '../../../api/receive/status.js';
import { serverlessDeps, serverlessHeaders } from './serverless.js';

/** Unique temp path for a real FileReplayStore (F1 tests). */
function tempReplayPath(): string {
  return path.join(os.tmpdir(), `demo-replay-${process.pid}-${Date.now()}-${Math.floor(process.hrtime()[1])}.json`);
}

function cleanupTempReplay(file: string): void {
  for (const p of [file, file + '.tmp']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
}

const HASH = '0x' + 'ab'.repeat(32);
const OTHER_HASH = '0x' + 'cd'.repeat(32);
const G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const G2 = 'GCX2EQXSPCHMBSEGYZRVTZWOIDRXWRWYEFRTCNVOZPYXE4QEFPKNUF3V';
/** Valid `C…` contract strkey: `StrKey.encodeContract(Buffer.alloc(32, 7))`. */
const CONTRACT = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const AMOUNT = '0.10'; // → 100000 base-6
const AMOUNT_BASE6 = '100000';
const BASE = 1_800_000_000_000; // fixed server clock origin (ms epoch)

// ─── Response double ─────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Iris v2 frame carrying the executed finality tier. */
function irisFrame(opts: { complete?: boolean; executed?: number | null; delayReason?: string | null } = {}) {
  const complete = opts.complete ?? true;
  return {
    messages: [
      complete
        ? {
            status: 'complete',
            attestation: '0x' + 'cd'.repeat(70),
            message: '0x' + 'ab'.repeat(180),
            decodedMessage: {
              finalityThresholdExecuted: opts.executed ?? 1000,
              delayReason: opts.delayReason ?? null,
            },
          }
        : { status: 'pending', attestation: 'PENDING' },
    ],
  };
}

// ─── In-memory KV fakes (mirror the kv.ts interfaces) ────────────────────────

interface FakeState {
  intents: Map<string, StoredIntent>;
  bind: Map<string, string>;
  replay: Map<string, SettlementRecord>;
  locks: Map<string, { token: string; expiresAt: number }>;
  counters: Map<string, { count: number; expiresAt: number }>;
  fees: Map<string, unknown>;
}

const DEFAULT_LIMITS = { status: 60, initiate: 20, settle: 5 };

function fakeBuckets(state: FakeState, now: () => number, limits = DEFAULT_LIMITS): BucketStore {
  const hit = (key: string, limit: number): boolean => {
    const t = now();
    const e = state.counters.get(key);
    if (!e || e.expiresAt <= t) {
      state.counters.set(key, { count: 1, expiresAt: t + 60_000 });
      return true;
    }
    e.count++;
    return e.count <= limit;
  };
  return {
    async consumeIp(bucket, ip) {
      return hit(`${bucket}:ip:${ip}`, limits[bucket]);
    },
    async consumeSubject(bucket, ip, subject) {
      return hit(`${bucket}:ip:${ip}:${subject}`, limits[bucket]);
    },
  };
}

/** Seed a full intent + legacy binding, as `handleInitiate` would. */
function seedIntent(
  state: FakeState,
  over: Partial<StoredIntent> = {},
  opts: { bind?: boolean } = {},
): StoredIntent {
  const intent: StoredIntent = {
    intentId: 'int_seed',
    burnTxHash: HASH,
    address: G,
    amount: AMOUNT_BASE6,
    sourceDomain: 6,
    transferMode: 'fast',
    createdAt: BASE,
    ...over,
  };
  state.intents.set(intent.intentId, intent);
  if (opts.bind !== false) {
    state.bind.set(`${intent.burnTxHash}|${intent.address}|${intent.amount}`, intent.intentId);
  }
  return intent;
}

type FakeDeps = HandlerDeps & { state: FakeState; advanceClock(ms: number): void };

/**
 * In-memory intent/replay/lock/bucket/feeCache fakes mirroring the `kv.ts`
 * interfaces. An intent for HASH/G/0.10 is pre-seeded so status has something
 * to read.
 */
function fakeDeps(
  overrides: Partial<HandlerDeps> = {},
  nowMs = BASE,
  seedOpts: { bind?: boolean } = {},
): FakeDeps {
  const state: FakeState = {
    intents: new Map(),
    bind: new Map(),
    replay: new Map(),
    locks: new Map(),
    counters: new Map(),
    fees: new Map(),
  };
  let clock = nowMs;
  const now = () => clock;
  const advanceClock = (ms: number) => {
    clock += ms;
  };

  seedIntent(state, {}, seedOpts);

  const intents = {
    // Mirrors both real stores: the `(hash|address|amount)` binding is first-claimer
    // wins, so a second initiate returns the winner instead of re-pointing the key.
    async put(intent: StoredIntent) {
      const key = `${intent.burnTxHash}|${intent.address}|${intent.amount}`;
      const claimedId = state.bind.get(key);
      if (claimedId) {
        const winner = state.intents.get(claimedId);
        if (winner) return winner;
      }
      state.intents.set(intent.intentId, intent);
      state.bind.set(key, intent.intentId);
      return intent;
    },
    async get(intentId: string, burnTxHash: string) {
      const i = state.intents.get(intentId);
      return i && i.burnTxHash === burnTxHash ? i : null;
    },
    async find(burnTxHash: string, address: string, amount: string) {
      const id = state.bind.get(`${burnTxHash}|${address}|${amount}`);
      return id ? state.intents.get(id) ?? null : null;
    },
    async record(burnTxHash: string, address: string, amount: string) {
      state.bind.set(`${burnTxHash}|${address}|${amount}`, 'int_legacy');
    },
    async has(burnTxHash: string, address: string, amount: string) {
      return state.bind.has(`${burnTxHash}|${address}|${amount}`);
    },
  };

  const replay = {
    async isProcessed(burnTxHash: string) {
      return state.replay.has(burnTxHash);
    },
    async markProcessed(burnTxHash: string, record: SettlementRecord) {
      state.replay.set(burnTxHash, { ...record, burnTxHash });
    },
    async getRecord(burnTxHash: string) {
      return state.replay.get(burnTxHash) ?? null;
    },
  };

  const locks = {
    async acquire(key: string, ttlMs: number) {
      const t = now();
      const held = state.locks.get(key);
      if (held && held.expiresAt > t) return null;
      const token = `tok_${state.locks.size + 1}`;
      state.locks.set(key, { token, expiresAt: t + ttlMs });
      return token;
    },
    async release(key: string, token: string) {
      const held = state.locks.get(key);
      if (held?.token === token) state.locks.delete(key);
    },
  };

  const feeCache = {
    async get(key: string) {
      return (state.fees.get(key) ?? null) as never;
    },
    async set(key: string, entry: unknown) {
      state.fees.set(key, entry);
    },
  };

  const cctp = {
    async receive(): Promise<ReceiveResult> {
      throw new Error('receive() must not be called on this path');
    },
  };

  const deps: FakeDeps = {
    intents: intents as never,
    replay: replay as never,
    locks: locks as never,
    buckets: fakeBuckets(state, now),
    feeCache: feeCache as never,
    cctp: cctp as never,
    now,
    ...overrides,
    state,
    advanceClock,
  };
  return deps;
}

/** A `receive()` double that mimics core: confirms, then writes the settled record. */
function mintingReceive(
  state: FakeState,
  opts: { txHash?: string; amount?: bigint; fail?: Error } = {},
) {
  const txHash = opts.txHash ?? 'MINT_TX_1';
  let calls = 0;
  return {
    calls: () => calls,
    receive: async (p: { burnTxHash: string }): Promise<ReceiveResult> => {
      calls++;
      if (opts.fail) throw opts.fail;
      const amount = opts.amount ?? 99_987n;
      await state.replay.set(p.burnTxHash, {
        burnTxHash: p.burnTxHash,
        txHash,
        amount,
        dust: 0n,
        status: 'settled',
        timestamp: new Date(BASE).toISOString(),
      });
      return { amount, dust: 0n, txHash, settled: true };
    },
  };
}

const settleBody = (over: Record<string, unknown> = {}) => ({
  burnTxHash: HASH,
  address: G,
  amount: AMOUNT,
  sourceDomain: 6,
  transferMode: 'fast',
  intentId: 'int_seed',
  ip: '9.9.9.9',
  ...over,
});

const bodyOf = (r: HandlerResult) => r.body as Record<string, never>;

// ─── status: read-only proof ─────────────────────────────────────────────────

describe('handleStatus', () => {
  it('status never mints: read-only proof', async () => {
    let minted = 0;
    const deps = fakeDeps({
      cctp: {
        receive: async () => {
          minted++;
          throw new Error('must not mint');
        },
      } as never,
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(minted).toBe(0);
    expect(['attesting', 'ready', 'settled']).toContain(bodyOf(r).status);
  });

  it('reports ready from a single Iris frame and never mints', async () => {
    const urls: string[] = [];
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async (url: string) => {
        urls.push(String(url));
        return jsonResponse(irisFrame());
      }) as never,
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(r.status).toBe(200);
    expect(bodyOf(r).status).toBe('ready');
    expect(bodyOf(r).attestationReady).toBe(true);
    expect(bodyOf(r).finalityThresholdExecuted).toBe(1000);
    expect(urls).toHaveLength(1); // exactly one Iris fetch per status call
    expect(urls[0]).toContain('/v2/messages/6?transactionHash=');
    expect(IRIS_TIMEOUT_MS).toBe(10_000);
  });

  it('degraded via the elapsed window past FAST_WINDOW_MS', async () => {
    const deps = fakeDeps() as FakeDeps & { advanceClock(ms: number): void };
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).degraded).toBe(false);

    deps.advanceClock(DEFAULT_FAST_WINDOW_MS + 1);
    const late = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(late).degraded).toBe(true);
    expect(bodyOf(late).elapsedMs).toBe(DEFAULT_FAST_WINDOW_MS + 1);
  });

  it('degraded via an Iris frame reporting finalityThresholdExecuted: 2000', async () => {
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse(irisFrame({ executed: 2000 }))) as never,
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).degraded).toBe(true);
    expect(bodyOf(r).finalityThresholdExecuted).toBe(2000);
  });

  it('degraded via delayReason: insufficient_fee', async () => {
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse(irisFrame({ delayReason: 'insufficient_fee' }))) as never,
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).degraded).toBe(true);
    expect(bodyOf(r).delayReason).toBe('insufficient_fee');
  });

  it('does not degrade a standard-mode intent on the elapsed window', async () => {
    const deps = fakeDeps() as FakeDeps & { advanceClock(ms: number): void };
    // Re-seeds the same (hash|address|amount) binding as standard, so `find` resolves here.
    seedIntent(deps.state, { transferMode: 'standard', intentId: 'int_std', createdAt: BASE });
    deps.advanceClock(DEFAULT_FAST_WINDOW_MS * 2);
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).degraded).toBe(false);
  });

  it('reads sourceDomain from the KV intent, never from a query param', async () => {
    const urls: string[] = [];
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async (url: string) => {
        urls.push(String(url));
        return jsonResponse(irisFrame());
      }) as never,
    });
    // A hostile caller tries to steer the Iris lookup at another domain.
    await handleStatus(
      { burnTxHash: HASH, address: G, amount: AMOUNT, sourceDomain: '999', ip: '9.9.9.9' } as never,
      deps,
    );
    expect(urls[0]).toContain('/v2/messages/6?');
  });

  it('stays attesting when Iris is unavailable or pending', async () => {
    const upstreamDown = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse({ error: 'boom' }, 500)) as never,
    });
    const r1 = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, upstreamDown);
    expect(bodyOf(r1).status).toBe('attesting');
    expect(bodyOf(r1).attestationReady).toBe(false);

    const pending = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse(irisFrame({ complete: false }))) as never,
    });
    const r2 = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, pending);
    expect(bodyOf(r2).status).toBe('attesting');
  });

  it('never calls Iris without an explicit base URL (no cross-network default)', async () => {
    let calls = 0;
    const deps = fakeDeps({
      fetch: (async () => {
        calls++;
        return jsonResponse(irisFrame());
      }) as never,
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(calls).toBe(0);
    expect(bodyOf(r).status).toBe('attesting');
  });

  it('returns the stored receipt once settled, without touching Iris', async () => {
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => {
        throw new Error('Iris must not be called for a settled transfer');
      }) as never,
    });
    await deps.replay.markProcessed(HASH, {
      burnTxHash: HASH,
      txHash: 'MINT_TX_1',
      amount: 99_987n,
      status: 'settled',
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).status).toBe('settled');
    expect(bodyOf(r).receipt).toEqual({ stellarAmount: '99987', mintTxHash: 'MINT_TX_1' });
  });

  it('never reports an unconfirmed (submitted) record as settled', async () => {
    const deps = fakeDeps();
    await deps.replay.markProcessed(HASH, {
      burnTxHash: HASH,
      txHash: 'MINT_TX_1',
      status: 'submitted',
    });
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT }, deps);
    expect(bodyOf(r).status).not.toBe('settled');
    expect(bodyOf(r).receipt).toBeUndefined();
  });

  it('403s without an intent and 400s on bad params', async () => {
    const deps = fakeDeps();
    expect((await handleStatus({ burnTxHash: OTHER_HASH, address: G, amount: AMOUNT }, deps)).status).toBe(403);
    expect((await handleStatus({ burnTxHash: 'nope', address: G, amount: AMOUNT }, deps)).status).toBe(400);
    expect((await handleStatus({ burnTxHash: HASH, address: 'not-a-key', amount: AMOUNT }, deps)).status).toBe(400);
    expect((await handleStatus({ burnTxHash: HASH, address: G, amount: '0' }, deps)).status).toBe(400);
  });

  // F3 / spec §4: `address` may be a `G…` account or a `C…` contract; anything else
  // (including a fabricated hex EVM address) is still refused at the edge.
  it('accepts a C... contract recipient and still rejects fabricated hex', async () => {
    const deps = fakeDeps();
    seedIntent(deps.state, {
      intentId: 'int_contract',
      burnTxHash: OTHER_HASH,
      address: CONTRACT,
    });
    expect(
      (await handleStatus({ burnTxHash: OTHER_HASH, address: CONTRACT, amount: AMOUNT, ip: '9.9.9.9' }, deps))
        .status,
    ).toBe(200);
    expect(
      (await handleStatus({ burnTxHash: OTHER_HASH, address: '0x' + '11'.repeat(20), amount: AMOUNT }, deps))
        .status,
    ).toBe(400);
  });

  it('429s once the shared per-IP status bucket is drained', async () => {
    const deps = fakeDeps({ buckets: undefined as never });
    const buckets = fakeBuckets(deps.state, deps.now!, { status: 2, initiate: 20, settle: 5 });
    deps.buckets = buckets;
    expect((await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT, ip: '1.1.1.1' }, deps)).status).toBe(200);
    expect((await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT, ip: '1.1.1.1' }, deps)).status).toBe(200);
    const r = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT, ip: '1.1.1.1' }, deps);
    expect(r.status).toBe(429);
    expect(bodyOf(r).error).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

// ─── initiate ────────────────────────────────────────────────────────────────

describe('handleInitiate', () => {
  const initiateBody = (over: Record<string, unknown> = {}) => ({
    burnTxHash: HASH,
    address: G,
    amount: AMOUNT,
    sourceDomain: 6,
    transferMode: 'fast',
    ip: '9.9.9.9',
    ...over,
  });

  it('records an intent and returns an intentId', async () => {
    // No pre-claimed binding: this is the first initiate for the tuple.
    const deps = fakeDeps({ newIntentId: () => 'int_fixed' }, BASE, { bind: false });
    const r = await handleInitiate(initiateBody(), deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, intentId: 'int_fixed' });

    const intent = await deps.intents.find(HASH, G, AMOUNT_BASE6);
    expect(intent).toMatchObject({
      intentId: 'int_fixed',
      sourceDomain: 6,
      transferMode: 'fast',
      address: G,
      amount: AMOUNT_BASE6,
      createdAt: BASE,
    });
  });

  it('rejects sourceDomain 5 (Solana) at the edge, and any non-{6} domain', async () => {
    const deps = fakeDeps();
    for (const sourceDomain of [5, 0, 27, 999]) {
      const r = await handleInitiate(initiateBody({ sourceDomain }), deps);
      expect(r.status, `domain ${sourceDomain}`).toBe(400);
      expect(bodyOf(r).error).toMatchObject({ code: 'INVALID_PARAMS' });
    }
  });

  it('accepts a numeric sourceDomain (JSON body)', async () => {
    const deps = fakeDeps({ newIntentId: () => 'int_num' });
    expect((await handleInitiate(initiateBody({ sourceDomain: 6 }), deps)).status).toBe(200);
  });

  it('rejects a fabricated EVM hex address (never translateToStellar)', async () => {
    const deps = fakeDeps();
    const r = await handleInitiate(initiateBody({ address: '0x' + '11'.repeat(20) }), deps);
    expect(r.status).toBe(400);
  });

  it('rejects a missing transferMode and a bad maxFee', async () => {
    const deps = fakeDeps({}, BASE, { bind: false });
    expect((await handleInitiate(initiateBody({ transferMode: undefined }), deps)).status).toBe(400);
    expect((await handleInitiate(initiateBody({ transferMode: 'turbo' }), deps)).status).toBe(400);
    // maxFee > amount
    expect((await handleInitiate(initiateBody({ maxFee: '1.00' }), deps)).status).toBe(400);
    expect((await handleInitiate(initiateBody({ maxFee: 'abc' }), deps)).status).toBe(400);
    // maxFee <= amount is fine
    const ok = await handleInitiate(initiateBody({ maxFee: '0.01' }), deps);
    expect(ok.status).toBe(200);
    expect(await deps.intents.find(HASH, G, AMOUNT_BASE6)).toMatchObject({ maxFee: '10000' });
  });

  it('429s on POST intent flood per IP', async () => {
    const deps = fakeDeps();
    deps.buckets = fakeBuckets(deps.state, deps.now!, { status: 60, initiate: 1, settle: 5 });
    expect((await handleInitiate(initiateBody(), deps)).status).toBe(200);
    expect((await handleInitiate(initiateBody(), deps)).status).toBe(429);
  });

  it('403s an explicitly disallowed Origin when an allowlist is configured', async () => {
    const deps = fakeDeps({ allowedOrigins: ['http://localhost:5173'] });
    expect((await handleInitiate(initiateBody(), deps)).status).toBe(403);
    expect((await handleInitiate(initiateBody({ origin: 'https://evil.example' }), deps)).status).toBe(403);
    expect((await handleInitiate(initiateBody({ origin: 'http://localhost:5173' }), deps)).status).toBe(200);
  });

  // F2 / spec §9 (first-claimer wins): a second initiate for the same tuple must not
  // re-point the binding. Otherwise a third party who knows the public burn hash +
  // address + amount can flip `transferMode` or reset `createdAt`, and so suppress or
  // fake the status frame's `elapsedMs`/`degraded`.
  it('does not rebind on a second initiate, and status keeps the first intent', async () => {
    let n = 0;
    const deps = fakeDeps({ newIntentId: () => `int_${++n}` });
    const first = await handleInitiate(
      initiateBody({ burnTxHash: OTHER_HASH, address: G2, transferMode: 'standard' }),
      deps,
    );
    expect(first.status).toBe(200);
    const firstId = bodyOf(first).intentId;

    // 120s later — past the 90s fast window — the second caller asks for `fast`.
    deps.advanceClock(120_000);
    const second = await handleInitiate(
      initiateBody({ burnTxHash: OTHER_HASH, address: G2, transferMode: 'fast' }),
      deps,
    );
    expect(second.status).toBe(200);
    expect(bodyOf(second).intentId).toBe(firstId);

    const found = await deps.intents.find(OTHER_HASH, G2, AMOUNT_BASE6);
    expect(found).toMatchObject({ intentId: firstId, transferMode: 'standard', createdAt: BASE });

    // Status still reports the FIRST intent's clock and mode: elapsedMs is measured
    // from the original createdAt, and `standard` is never degraded by the fast window.
    const st = await handleStatus(
      { burnTxHash: OTHER_HASH, address: G2, amount: AMOUNT, ip: '9.9.9.9' },
      deps,
    );
    expect(st.status).toBe(200);
    expect(bodyOf(st).elapsedMs).toBe(120_000);
    expect(bodyOf(st).degraded).toBe(false);
  });

  // F3 / spec §4: a contract (`C…`) recipient is a real Stellar strkey and must be
  // accepted by the receive contract (never routed through translateToStellar).
  it('accepts a contract (C...) recipient, and still rejects a fabricated hex address', async () => {
    const deps = fakeDeps({ newIntentId: () => 'int_c' });
    const ok = await handleInitiate(initiateBody({ address: CONTRACT }), deps);
    expect(ok.status).toBe(200);
    expect(await deps.intents.find(HASH, CONTRACT, AMOUNT_BASE6)).toMatchObject({
      address: CONTRACT,
    });
    expect((await handleInitiate(initiateBody({ address: '0x' + '11'.repeat(20) }), deps)).status).toBe(400);
    expect((await handleInitiate(initiateBody({ address: 'GNOTASTRKEY' }), deps)).status).toBe(400);
  });
});

// ─── settle ──────────────────────────────────────────────────────────────────

describe('handleSettle', () => {
  it('settles once and returns the receipt net of the Fast fee', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state, { amount: 99_987n });
    deps.cctp = { receive: mint.receive } as never;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ receipt: { stellarAmount: '99987', mintTxHash: 'MINT_TX_1' } });
    expect(mint.calls()).toBe(1);
  });

  it('double-submit returns the same receipt and never re-mints', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    const first = await handleSettle(settleBody(), deps);
    const second = await handleSettle(settleBody(), deps);

    expect(mint.calls()).toBe(1);
    expect(bodyOf(second).code).toBe('ALREADY_PROCESSED');
    expect(bodyOf(second).receipt).toEqual(bodyOf(first).receipt);
  });

  it('mismatched address/amount/mode → 403 without signing', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    for (const over of [
      { address: G2 },
      { amount: '0.20' },
      { transferMode: 'standard' },
    ]) {
      const r = await handleSettle(settleBody(over), deps);
      expect(r.status, JSON.stringify(over)).toBe(403);
      expect(bodyOf(r).error).toMatchObject({ code: 'ADDRESS_MISMATCH' });
    }
    expect(mint.calls()).toBe(0);
  });

  it('intent mismatch → 403 on an unknown intentId or a hash that does not bind', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    const unknown = await handleSettle(settleBody({ intentId: 'int_nope' }), deps);
    expect(unknown.status).toBe(403);
    expect(bodyOf(unknown).error).toMatchObject({ code: 'NO_INTENT' });

    const otherHash = await handleSettle(
      settleBody({ burnTxHash: OTHER_HASH, address: G, amount: AMOUNT }),
      deps,
    );
    expect(otherHash.status).toBe(403);
    expect(mint.calls()).toBe(0);
  });

  it('expired intent + live replay record → ALREADY_PROCESSED, never re-mints', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    // The intent expired out of KV (24h TTL)…
    deps.state.intents.clear();
    // …but the replay record is permanent and reflects a confirmed mint.
    await deps.replay.markProcessed(HASH, {
      burnTxHash: HASH,
      txHash: 'MINT_TX_ORIGINAL',
      amount: 99_987n,
      status: 'settled',
    });

    const r = await handleSettle(settleBody(), deps);
    expect(bodyOf(r).code).toBe('ALREADY_PROCESSED');
    expect(bodyOf(r).receipt).toEqual({
      stellarAmount: '99987',
      mintTxHash: 'MINT_TX_ORIGINAL',
    });
    expect(mint.calls()).toBe(0);
  });

  it('persists the settled receipt durably — core writes only to its in-process store', async () => {
    const deps = fakeDeps();
    let calls = 0;
    // Mirrors the real client: core confirms and writes its OWN store, not deps.replay.
    deps.cctp = {
      receive: async () => {
        calls++;
        return { amount: 99_987n, dust: 0n, txHash: 'MINT_TX_DURABLE', settled: true };
      },
    } as never;

    const first = await handleSettle(settleBody(), deps);
    expect(first.status).toBe(200);

    const record = await deps.replay.getRecord(HASH);
    expect(record).toMatchObject({
      status: 'settled',
      txHash: 'MINT_TX_DURABLE',
      amount: 99_987n,
      sourceDomain: 6,
      destinationAddress: G,
    });

    // Even after the 24h intent TTL drops the intent, the receipt still answers.
    deps.state.intents.clear();
    const again = await handleSettle(settleBody(), deps);
    expect(bodyOf(again).code).toBe('ALREADY_PROCESSED');
    expect(bodyOf(again).receipt).toEqual(bodyOf(first).receipt);
    expect(calls).toBe(1);
  });

  it('records a broadcast-but-unconfirmed mint as submitted, never settled', async () => {
    const deps = fakeDeps();
    deps.cctp = {
      receive: async () => {
        throw new MintUnconfirmedError(HASH, 'BROADCAST_TX');
      },
    } as never;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(502);
    expect(bodyOf(r).error).toMatchObject({ code: 'MINT_UNCONFIRMED' });
    expect(await deps.replay.getRecord(HASH)).toMatchObject({
      status: 'submitted',
      txHash: 'BROADCAST_TX',
    });

    // The next attempt reconciles against that hash instead of broadcasting again.
    const second = await handleSettle(settleBody(), deps);
    expect(second.status).toBe(502);
    expect(bodyOf(second).error).toMatchObject({ code: 'MINT_UNCONFIRMED' });
  });

  // F1: the local server wires `replay: FileReplayStore` (serve.ts). A bare
  // JSON.stringify throws on the bigint amount/dust, so a CONFIRMED mint would 500 and
  // leave no durable receipt → the next attempt would re-enter receive(). Exercises the
  // real store against a real file, not the Memory*/Redis doubles.
  it('persists the confirmed receipt through a real FileReplayStore', async () => {
    const file = tempReplayPath();
    try {
      const deps = fakeDeps();
      deps.replay = new FileReplayStore(file);
      const mint = mintingReceive(deps.state, { amount: 99_987n });
      deps.cctp = { receive: mint.receive } as never;

      const first = await handleSettle(settleBody(), deps);
      expect(first.status).toBe(200);
      expect(bodyOf(first).receipt).toEqual({ stellarAmount: '99987', mintTxHash: 'MINT_TX_1' });

      // On disk, with the bigints encoded — no TypeError, valid JSON.
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw).toContain('"99987n"');
      expect(JSON.parse(raw)).toBeTruthy();

      // A fresh store (next serverless invocation) reads the bigints back.
      const reread = new FileReplayStore(file).getRecord(HASH)!;
      expect(reread.status).toBe('settled');
      expect(reread.amount).toBe(99_987n);
      expect(typeof reread.amount).toBe('bigint');
      expect(reread.dust).toBe(0n);

      // Double-submit against the durable record returns the receipt, never re-mints.
      const second = await handleSettle(settleBody(), { ...deps, replay: new FileReplayStore(file) });
      expect(mint.calls()).toBe(1);
      expect(bodyOf(second).code).toBe('ALREADY_PROCESSED');
      expect(bodyOf(second).receipt).toEqual(bodyOf(first).receipt);
    } finally {
      cleanupTempReplay(file);
    }
  });

  it('records a broadcast-but-unconfirmed mint through a real FileReplayStore', async () => {
    const file = tempReplayPath();
    try {
      const deps = fakeDeps();
      deps.replay = new FileReplayStore(file);
      deps.cctp = {
        receive: async () => {
          throw new MintUnconfirmedError(HASH, 'BROADCAST_TX');
        },
      } as never;

      const r = await handleSettle(settleBody(), deps);
      expect(r.status).toBe(502);
      expect(bodyOf(r).error).toMatchObject({ code: 'MINT_UNCONFIRMED' });
      expect(new FileReplayStore(file).getRecord(HASH)).toMatchObject({
        status: 'submitted',
        txHash: 'BROADCAST_TX',
      });
    } finally {
      cleanupTempReplay(file);
    }
  });

  it('re-runs the MAX_MINT_AMOUNT_USDC cap server-side', async () => {
    const deps = fakeDeps({ maxMintBase6: 50_000n });
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    const r = await handleSettle(settleBody(), deps); // 100000 > 50000
    expect(r.status).toBe(400);
    expect(bodyOf(r).error).toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    expect(mint.calls()).toBe(0);
  });

  it('re-runs the sourceDomain allow-list server-side', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;
    for (const i of deps.state.intents.values()) i.sourceDomain = 5;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(400);
    expect(mint.calls()).toBe(0);
  });

  it('applies the strict settle bucket (per IP+address) before any signing', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;

    for (let i = 0; i < 5; i++) await handleSettle(settleBody(), deps);
    expect(mint.calls()).toBe(1); // replays 2..5 short-circuit on replay

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(429);
    expect(bodyOf(r).error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('single-flight lock refuses a concurrent settle for the same burn', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;
    await deps.locks.acquire(`settle:${HASH}`, 60_000);

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(429);
    expect(mint.calls()).toBe(0);
  });

  it('writes no settled record when the mint fails, and maps the error code', async () => {
    const deps = fakeDeps();
    deps.cctp = {
      receive: async () => {
        throw new MintFailedError(HASH, 'simulate: boom');
      },
    } as never;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(502);
    expect(bodyOf(r).error).toMatchObject({ code: 'MINT_FAILED' });
    expect(await deps.replay.getRecord(HASH)).toBeNull();
  });

  it('maps an exhausted attestation budget to NOT_READY for the client to keep polling', async () => {
    const deps = fakeDeps();
    deps.cctp = {
      receive: async () => {
        throw new AttestationTimeoutError(HASH, 60_000);
      },
    } as never;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(409);
    expect(bodyOf(r).error).toMatchObject({ code: 'NOT_READY' });
  });

  it('threads the sponsor, live sequence and network-passphrase transport into receive()', async () => {
    const deps = fakeDeps();
    let seen: Record<string, unknown> | null = null;
    deps.settleTransport = {
      sponsorAccount: G,
      rpc: { simulateTransaction: async () => ({}), assembleTransaction: () => '', sendTransaction: async () => ({ status: 'PENDING', hash: 'h' }), getTransaction: async () => ({ status: 'SUCCESS' }) },
      readSequence: async () => '424242',
    };
    deps.cctp = {
      receive: async (p: Record<string, unknown>) => {
        seen = p;
        return { amount: 99_987n, dust: 0n, txHash: 'MINT_TX_1', settled: true };
      },
    } as never;

    const r = await handleSettle(settleBody(), deps);
    expect(r.status).toBe(200);
    expect(seen).toMatchObject({
      sourceDomain: 6,
      burnTxHash: HASH,
      destinationAddress: G,
      amount: 100000n,
      sponsorAccount: G,
      sourceSequence: '424242',
    });
    expect(seen!.rpc).toBe(deps.settleTransport.rpc);
  });

  it('rejects a body whose sourceDomain disagrees with the stored intent', async () => {
    const deps = fakeDeps();
    const mint = mintingReceive(deps.state);
    deps.cctp = { receive: mint.receive } as never;
    const r = await handleSettle(settleBody({ sourceDomain: 0 }), deps);
    expect(r.status).toBe(400);
    expect(mint.calls()).toBe(0);
  });

  it('400s a missing intentId or bad base params', async () => {
    const deps = fakeDeps();
    expect((await handleSettle(settleBody({ intentId: undefined }), deps)).status).toBe(400);
    expect((await handleSettle(settleBody({ burnTxHash: 'nope' }), deps)).status).toBe(400);
  });
});

// ─── fees ────────────────────────────────────────────────────────────────────

describe('handleFees', () => {
  const TIERS = [
    { finalityThreshold: 1000, minimumFee: 1.3 },
    { finalityThreshold: 2000, minimumFee: 0 },
  ];

  it('quotes the requested tier and caches the route for 1h', async () => {
    let calls = 0;
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => {
        calls++;
        return jsonResponse(TIERS);
      }) as never,
    });

    const r = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'fast' }, deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      minimumFee: '1.3',
      finalityThreshold: 1000,
      fastTierAvailable: true,
    });
    expect(typeof (r.body as { cachedAt: string }).cachedAt).toBe('string');
    expect(calls).toBe(2); // fast + standard probed once on cold start

    const again = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'fast' }, deps);
    expect(again.body).toEqual(r.body);
    expect(calls).toBe(2); // served from cache
  });

  it('re-quotes once the 1h cache window has passed', async () => {
    let calls = 0;
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => {
        calls++;
        return jsonResponse(TIERS);
      }) as never,
    }) as FakeDeps & { advanceClock(ms: number): void };

    await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'standard' }, deps);
    expect(calls).toBe(2);
    deps.advanceClock(3_600_001);
    await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'standard' }, deps);
    expect(calls).toBe(4);
  });

  it('reports fastTierAvailable: false instead of mislabelling a Standard fee', async () => {
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse([{ finalityThreshold: 2000, minimumFee: 0 }])) as never,
    });
    const r = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'standard' }, deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ finalityThreshold: 2000, minimumFee: '0', fastTierAvailable: false });

    // …and a fast quote on that route fails closed.
    const fast = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'fast' }, deps);
    expect(fast.status).toBe(503);
    expect(bodyOf(fast).error).toMatchObject({ code: 'FEE_UNAVAILABLE' });
  });

  it('maps INVALID_DOMAIN separately from FEE_UNAVAILABLE', async () => {
    const deps = fakeDeps({
      attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
      fetch: (async () => jsonResponse(TIER_MISSING)) as never,
    });
    const bad = await handleFees({ sourceDomain: '999', destDomain: '27', mode: 'fast' }, deps);
    expect(bad.status).toBe(400);
    expect(bodyOf(bad).error).toMatchObject({ code: 'INVALID_DOMAIN' });

    const down = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'fast' }, deps);
    expect(down.status).toBe(503);
    expect(bodyOf(down).error).toMatchObject({ code: 'FEE_UNAVAILABLE' });
  });

  it('400s an unknown mode and non-numeric domains', async () => {
    const deps = fakeDeps({ attestationBaseUrl: 'https://iris-api-sandbox.circle.com' });
    expect((await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'turbo' }, deps)).status).toBe(400);
    expect((await handleFees({ sourceDomain: 'abc', destDomain: '27', mode: 'fast' }, deps)).status).toBe(400);
    expect((await handleFees({ sourceDomain: '6', mode: 'fast' }, deps)).status).toBe(400);
  });

  it('never quotes without an explicit attestation base URL', async () => {
    let calls = 0;
    const deps = fakeDeps({
      fetch: (async () => {
        calls++;
        return jsonResponse(TIERS);
      }) as never,
    });
    const r = await handleFees({ sourceDomain: '6', destDomain: '27', mode: 'fast' }, deps);
    expect(r.status).toBe(503);
    expect(calls).toBe(0);
  });
});

const TIER_MISSING = { error: 'nope' };

// ─── response hygiene ────────────────────────────────────────────────────────

describe('response hygiene', () => {
  it('keys rate buckets on x-real-ip, never x-forwarded-for', () => {
    expect(trustedClientIp({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' })).toBe('9.9.9.9');
    expect(trustedClientIp({ 'x-forwarded-for': '1.2.3.4' })).toBe('unknown');
    expect(trustedClientIp({})).toBe('unknown');
    expect(trustedClientIp({ 'x-real-ip': ['9.9.9.9', '8.8.8.8'] })).toBe('9.9.9.9');
  });

  it('exposes security-header parity with serve.ts', () => {
    expect(SECURITY_HEADERS['Cache-Control']).toMatch(/no-store/);
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("default-src 'self'");
  });

  // F4 / spec §6: one CSP definition, connect-src extended to the deployed API origin
  // + Iris + Horizon/RPC — not two drifting copies.
  it('builds the single CSP with the deployment connection sources', () => {
    const csp = buildCsp({
      apiOrigin: 'https://demo.example',
      irisBaseUrl: 'https://iris-api-sandbox.circle.com/v2/',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://*.stellar.org");
    expect(csp).toContain('https://demo.example');
    expect(csp).toContain('https://iris-api-sandbox.circle.com');
    expect(csp).toContain('https://horizon-testnet.stellar.org');
    expect(csp).toContain('https://soroban-testnet.stellar.org');
    // path-stripped origin, added once
    expect(csp.match(/iris-api-sandbox\.circle\.com/g)).toHaveLength(1);

    // The default constant (no env) stays local-only — no cross-network leakage.
    expect(CSP).toBe("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.stellar.org");
    // An unparseable URL is dropped instead of breaking the header.
    expect(buildCsp({ irisBaseUrl: 'not a url' })).toBe(CSP);
  });

  it('never leaks a secret seed in a handler body', async () => {
    const deps = fakeDeps();
    deps.cctp = {
      receive: async () => {
        throw new Error('boom SDNMRSIZWINOTESTFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234');
      },
    } as never;
    const r = await handleSettle(settleBody(), deps);
    expect(JSON.stringify(r.body)).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

// ─── KV stores ───────────────────────────────────────────────────────────────

describe('MemoryIntentStore', () => {
  const draft = (over: Partial<StoredIntent> = {}): StoredIntent => ({
    intentId: 'int_1',
    burnTxHash: HASH,
    address: G,
    amount: AMOUNT_BASE6,
    sourceDomain: 6,
    transferMode: 'fast',
    createdAt: BASE,
    ...over,
  });

  it('round-trips put/get/find and the legacy record/has binding', async () => {
    let t = BASE;
    const store = new MemoryIntentStore({ now: () => t });
    await store.put(draft());
    expect(await store.get('int_1', HASH)).toMatchObject({ intentId: 'int_1' });
    expect(await store.get('int_1', OTHER_HASH)).toBeNull();
    expect(await store.find(HASH, G, AMOUNT_BASE6)).toMatchObject({ intentId: 'int_1' });
    expect(await store.find(HASH, G2, AMOUNT_BASE6)).toBeNull();

    await store.record(OTHER_HASH, G, AMOUNT_BASE6);
    expect(await store.has(OTHER_HASH, G, AMOUNT_BASE6)).toBe(true);
    expect(await store.has(HASH, G, AMOUNT_BASE6)).toBe(true);
  });

  it('expires intents after the 24h TTL', async () => {
    let t = BASE;
    const store = new MemoryIntentStore({ now: () => t });
    await store.put(draft());
    t = BASE + INTENT_TTL_MS - 1;
    expect(await store.find(HASH, G, AMOUNT_BASE6)).not.toBeNull();
    t = BASE + INTENT_TTL_MS;
    expect(await store.find(HASH, G, AMOUNT_BASE6)).toBeNull();
    expect(await store.get('int_1', HASH)).toBeNull();
    expect(await store.has(HASH, G, AMOUNT_BASE6)).toBe(false);
    store[Symbol.dispose]();
  });

  // F2 / spec §9: first-claimer wins. A later initiate for the same tuple must not
  // re-point the binding — otherwise anyone who knows the public burn hash + address
  // + amount could flip the mode or reset `createdAt`.
  it('first-claimer wins: a second put for the same tuple does not rebind', async () => {
    let t = BASE;
    const store = new MemoryIntentStore({ now: () => t });
    const first = await store.put(draft());
    expect(first.intentId).toBe('int_1');

    t = BASE + 60_000;
    const second = await store.put(
      draft({ intentId: 'int_2', transferMode: 'standard', createdAt: t, maxFee: '1' }),
    );

    // Loser gets the winner back, and the binding still resolves to the winner.
    expect(second.intentId).toBe('int_1');
    expect(await store.find(HASH, G, AMOUNT_BASE6)).toMatchObject({
      intentId: 'int_1',
      transferMode: 'fast',
      createdAt: BASE,
    });
    expect((await store.find(HASH, G, AMOUNT_BASE6))?.maxFee).toBeUndefined();
    store[Symbol.dispose]();
  });

  it('re-claims a tuple once the first intent has expired', async () => {
    let t = BASE;
    const store = new MemoryIntentStore({ now: () => t });
    await store.put(draft());
    t = BASE + INTENT_TTL_MS;
    const reclaimed = await store.put(draft({ intentId: 'int_2', createdAt: t, transferMode: 'standard' }));
    expect(reclaimed.intentId).toBe('int_2');
    expect(await store.find(HASH, G, AMOUNT_BASE6)).toMatchObject({ intentId: 'int_2' });
    store[Symbol.dispose]();
  });
});

describe('replay records are permanent', () => {
  it('MemoryReplayStore survives any number of clock advances', async () => {
    let t = BASE;
    const store = new MemoryReplayStore({ now: () => t });
    await store.markProcessed(HASH, { burnTxHash: HASH, txHash: 'MINT_TX_1', amount: 99_987n, dust: 0n, status: 'settled' });
    t = BASE + 100 * 365 * 24 * 3_600_000;
    expect(await store.isProcessed(HASH)).toBe(true);
    expect(await store.getRecord(HASH)).toMatchObject({ amount: 99_987n, dust: 0n, status: 'settled' });
  });

  it('encodes and decodes bigint records without loss', () => {
    const record: SettlementRecord = {
      burnTxHash: HASH,
      txHash: 'MINT_TX_1',
      amount: 123_456_789_012_345_678_901n,
      dust: 0n,
      sourceDomain: 6,
      destinationAddress: G,
      timestamp: '2026-09-25T00:00:00.000Z',
      status: 'settled',
    };
    const round = decodeSettlementRecord(encodeSettlementRecord(record));
    expect(round).toEqual(record);
    expect(typeof round.amount).toBe('bigint');
  });

  it('KvIntentStore and RedisReplayStore build over an injected Upstash client', async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const redis = {
      get: async (k: string) => {
        calls.push({ op: 'get', args: [k] });
        return null;
      },
      set: async (...args: unknown[]) => {
        calls.push({ op: 'set', args });
        return 'OK';
      },
    };
    const intents = new KvIntentStore(redis as never, { now: () => BASE });
    await intents.put({
      intentId: 'int_kv',
      burnTxHash: HASH,
      address: G,
      amount: AMOUNT_BASE6,
      sourceDomain: 6,
      transferMode: 'fast',
      createdAt: BASE,
    });
    const intentWrites = calls.filter((c) => c.op === 'set');
    expect(intentWrites).toHaveLength(2); // full intent + legacy binding
    for (const w of intentWrites) {
      const opts = w.args[2] as { ex: number };
      expect(opts.ex).toBe(86_400); // 24h intent TTL
    }

    const replay = new RedisReplayStore(redis as never);
    await replay.markProcessed(HASH, { burnTxHash: HASH, txHash: 'MINT_TX_1', amount: 1n, status: 'settled' });
    const lastWrite = calls[calls.length - 1];
    expect(lastWrite.args).toHaveLength(2); // no TTL option → permanent
    expect(await replay.getRecord(HASH)).toBeNull();
  });

  // F2 / spec §9: the Redis binding write must be SET … NX, so two concurrent
  // initiates cannot both claim the same tuple.
  it('KvIntentStore claims the binding with SET NX and returns the first intent on a loss', async () => {
    const store = new Map<string, string>();
    const writes: Array<{ key: string; opts?: { ex?: number; nx?: boolean } }> = [];
    // Upstash `SET … NX` returns null when the key already exists.
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string, opts?: { ex?: number; nx?: boolean }) => {
        writes.push({ key: k, ...(opts === undefined ? {} : { opts }) });
        if (opts?.nx && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      },
    };
    const intents = new KvIntentStore(redis as never, { now: () => BASE });
    const first = await intents.put({
      intentId: 'int_kv_1',
      burnTxHash: HASH,
      address: G,
      amount: AMOUNT_BASE6,
      sourceDomain: 6,
      transferMode: 'fast',
      createdAt: BASE,
    });
    expect(first.intentId).toBe('int_kv_1');
    expect(writes[0].opts).toMatchObject({ nx: true, ex: 86_400 });

    const second = await intents.put({
      intentId: 'int_kv_2',
      burnTxHash: HASH,
      address: G,
      amount: AMOUNT_BASE6,
      sourceDomain: 6,
      transferMode: 'standard',
      createdAt: BASE + 60_000,
    });
    expect(second.intentId).toBe('int_kv_1');
    expect(second.transferMode).toBe('fast');
    expect(second.createdAt).toBe(BASE);
    // The loser never overwrote the binding.
    expect(await intents.find(HASH, G, AMOUNT_BASE6)).toMatchObject({ intentId: 'int_kv_1' });
  });
});

describe('MemoryLock / MemoryBuckets / MemoryFeeCache', () => {
  it('holds a lock until released or TTL-expired', async () => {
    let t = BASE;
    const lock = new MemoryLock({ now: () => t });
    const token = await lock.acquire('settle:' + HASH, 60_000);
    expect(token).toBeTruthy();
    expect(await lock.acquire('settle:' + HASH, 60_000)).toBeNull();
    await lock.release('settle:' + HASH, 'wrong-token');
    expect(await lock.acquire('settle:' + HASH, 60_000)).toBeNull();
    await lock.release('settle:' + HASH, token!);
    expect(await lock.acquire('settle:' + HASH, 60_000)).toBeTruthy();

    t = BASE + 60_001;
    const stale = await lock.acquire('settle:' + HASH, 60_000);
    expect(stale).toBeTruthy(); // TTL expiry: a crashed invocation cannot wedge a hash forever
    expect(await lock.acquire('settle:' + HASH, 60_000)).toBeNull();
  });

  it('enforces the default per-bucket windows', async () => {
    let t = BASE;
    const buckets = new MemoryBuckets({ now: () => t });
    for (let i = 0; i < 60; i++) expect(await buckets.consumeIp('status', '1.1.1.1')).toBe(true);
    expect(await buckets.consumeIp('status', '1.1.1.1')).toBe(false);
    for (let i = 0; i < 5; i++) expect(await buckets.consumeSubject('settle', '1.1.1.1', G)).toBe(true);
    expect(await buckets.consumeSubject('settle', '1.1.1.1', G)).toBe(false);
    // distinct subject has its own allowance, and the window resets on the clock
    expect(await buckets.consumeSubject('settle', '1.1.1.1', G2)).toBe(true);
    t = BASE + 60_001;
    expect(await buckets.consumeIp('status', '1.1.1.1')).toBe(true);
    buckets[Symbol.dispose]?.();
  });

  it('caches fee entries for the TTL window', async () => {
    let t = BASE;
    const cache = new MemoryFeeCache({ now: () => t, ttlMs: 3_600_000 });
    await cache.set('fees:6:27', { fastTierAvailable: true, cachedAt: BASE });
    expect(await cache.get('fees:6:27')).toMatchObject({ fastTierAvailable: true });
    t = BASE + 3_600_001;
    expect(await cache.get('fees:6:27')).toBeNull();
  });
});

// ─── cold-start env enforcement ──────────────────────────────────────────────

describe('assertColdStartEnv', () => {
  const base = {
    STELLAR_NETWORK: 'testnet',
    STELLAR_DESTINATION: G,
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api-sandbox.circle.com',
  };

  it('accepts a network-consistent testnet env', () => {
    expect(() => assertColdStartEnv(base)).not.toThrow();
    expect(() => assertColdStartEnv({ ...base, STELLAR_NETWORK: 'mainnet', HORIZON_URL: 'https://horizon.stellar.org', CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api.circle.com' })).not.toThrow();
  });

  it('requires CIRCLE_ATTESTATION_BASE_URL — never defaults across networks', () => {
    expect(() => assertColdStartEnv({ ...base, CIRCLE_ATTESTATION_BASE_URL: undefined }))
      .toThrow(/CIRCLE_ATTESTATION_BASE_URL/);
  });

  it('rejects a mainnet Iris host on a testnet run, and vice versa', () => {
    expect(() => assertColdStartEnv({ ...base, CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api.circle.com' }))
      .toThrow(/iris-api-sandbox/);
    expect(() =>
      assertColdStartEnv({
        ...base,
        STELLAR_NETWORK: 'mainnet',
        HORIZON_URL: 'https://horizon.stellar.org',
        CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api-sandbox.circle.com',
      })
    ).toThrow(/iris-api/);
  });

  it('requires https + the stellar.org host allowlist for RPC/Horizon', () => {
    expect(() => assertColdStartEnv({ ...base, SOROBAN_RPC_URL: 'http://soroban-testnet.stellar.org' }))
      .toThrow(/SOROBAN_RPC_URL/);
    expect(() => assertColdStartEnv({ ...base, SOROBAN_RPC_URL: 'https://evil.example' }))
      .toThrow(/SOROBAN_RPC_URL/);
    expect(() => assertColdStartEnv({ ...base, SOROBAN_RPC_URL: undefined })).toThrow(/SOROBAN_RPC_URL/);
    expect(() => assertColdStartEnv({ ...base, HORIZON_URL: 'https://evil.example' })).toThrow(/HORIZON_URL/);
    expect(() => assertColdStartEnv({ ...base, CIRCLE_ATTESTATION_BASE_URL: 'http://iris-api-sandbox.circle.com' }))
      .toThrow(/https/);
  });

  it('admits the documented public mainnet Soroban RPC by exact name', () => {
    // SDF publishes no mainnet Soroban RPC under *.stellar.org (soroban-mainnet.stellar.org
    // is NXDOMAIN), so without a pinned host this check could never pass on mainnet and
    // every cold start threw — taking the config, fees, initiate and settle routes down.
    const mainnet = {
      STELLAR_NETWORK: 'mainnet',
      STELLAR_DESTINATION: G,
      HORIZON_URL: 'https://horizon.stellar.org',
      CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api.circle.com',
    };

    expect(() => assertColdStartEnv({ ...mainnet, SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com' }))
      .not.toThrow();

    // Exact name only — neither a suffix nor a prefix lookalike may pass.
    expect(() => assertColdStartEnv({ ...mainnet, SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com.evil.example' }))
      .toThrow(/SOROBAN_RPC_URL/);
    expect(() => assertColdStartEnv({ ...mainnet, SOROBAN_RPC_URL: 'https://evil-mainnet.sorobanrpc.com' }))
      .toThrow(/SOROBAN_RPC_URL/);
  });

  it('depsFromEnv refuses to build serverless deps without KV credentials', () => {
    expect(() => depsFromEnv(base)).toThrow(/KV_REST_API_URL/);
  });

  it('allows the stable production origin, not only the per-deployment VERCEL_URL', () => {
    // Regression: an allowlist built from VERCEL_URL alone holds a hostname that
    // changes every deploy and is never where the site is served, so the production
    // browser 403s against its own API.
    const kp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
    const deps = depsFromEnv({
      STELLAR_NETWORK: 'mainnet',
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
      USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      FORWARDER_CONTRACT_ID: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
      HORIZON_URL: 'https://horizon.stellar.org',
      SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org',
      CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api.circle.com',
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'token',
      VERCEL_URL: 'anchorcctp-sdk-demo-21bjdrkau-elmandas-projects.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'www.anchorcctp.dev',
    });

    expect(deps.allowedOrigins).toContain('https://www.anchorcctp.dev');
    expect(deps.allowedOrigins).toContain('https://anchorcctp-sdk-demo-21bjdrkau-elmandas-projects.vercel.app');
  });

  it('pins the settle attestation budget well inside the Hobby 300s invocation', () => {
    expect(SETTLE_MAX_RETRIES).toBe(10);
  });
});

// ─── Vercel entrypoints (repo-root api/*) ────────────────────────────────────
// The deployed surface is a thin wrapper per route: method guard → handler →
// `{ status, body }` through as JSON. Each wrapper exposes `createHandler(deps,
// headers)` (the injection seam the tests use) plus the Web-standard `fetch`
// default export Vercel invokes, which builds deps + headers from the env.

describe('vercel entrypoints', () => {
  const DEPLOY_ENV = {
    API_ORIGIN: 'https://demo.anchorcctp.com',
    CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api-sandbox.circle.com',
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  };
  const HEADERS = serverlessHeaders(DEPLOY_ENV);
  const get = (path: string) =>
    new Request(`https://demo.anchorcctp.com${path}`, { headers: { 'x-real-ip': '9.9.9.9' } });
  const post = (path: string, body: unknown) =>
    new Request(`https://demo.anchorcctp.com${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '9.9.9.9',
        origin: 'http://localhost:5173',
      },
      body: JSON.stringify(body),
    });

  it('exposes a Web-standard fetch handler for every route', () => {
    for (const entry of [statusEntry, initiateEntry, settleEntry, feesEntry, configEntry]) {
      expect(typeof entry.fetch).toBe('function');
    }
  });

  it('405s a wrong method before touching the env, with the METHOD_NOT_ALLOWED shape', async () => {
    const wrong = async (entry: typeof statusEntry, method: string, allow: string) => {
      const res = await entry.fetch(
        new Request('https://demo.anchorcctp.com/api/receive/status', { method }),
      );
      expect(res.status).toBe(405);
      expect(await res.json()).toEqual({
        error: { code: 'METHOD_NOT_ALLOWED', remediation: `Use ${allow}.` },
      });
      // security headers on the error path too, and the allowed method is advertised
      expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'");
      expect(res.headers.get('cache-control')).toBe(NO_STORE);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('allow')).toBe(allow);
    };

    await wrong(statusEntry, 'POST', 'GET');
    await wrong(feesEntry, 'POST', 'GET');
    await wrong(configEntry, 'POST', 'GET');
    await wrong(initiateEntry, 'GET', 'POST');
    await wrong(settleEntry, 'GET', 'POST');
  });

  it('status: passes { status, body } through unchanged, headers added', async () => {
    const make = () =>
      fakeDeps({
        attestationBaseUrl: DEPLOY_ENV.CIRCLE_ATTESTATION_BASE_URL,
        fetch: (async () => jsonResponse(irisFrame())) as never,
      });
    const direct = await handleStatus({ burnTxHash: HASH, address: G, amount: AMOUNT, ip: '9.9.9.9' }, make());
    const res = await createStatusRoute(make(), HEADERS)(
      get(`/api/receive/status?burnTxHash=${HASH}&address=${G}&amount=${AMOUNT}`),
    );
    expect(res.status).toBe(direct.status);
    expect(await res.json()).toEqual(direct.body);
    expect(res.headers.get('cache-control')).toBe(HEADERS['Cache-Control']);
    expect(res.headers.get('content-security-policy')).toBe(HEADERS['Content-Security-Policy']);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('status: error bodies keep the handler shape and the headers', async () => {
    const res = await createStatusRoute(fakeDeps(), HEADERS)(get('/api/receive/status'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_PARAMS' } });
    expect(res.headers.get('content-security-policy')).toBe(HEADERS['Content-Security-Policy']);
  });

  it('initiate: POST body + Origin reach the handler unchanged', async () => {
    const body = {
      burnTxHash: HASH,
      address: G,
      amount: AMOUNT,
      sourceDomain: '6',
      transferMode: 'fast',
    };
    const make = () =>
      fakeDeps(
        { newIntentId: () => 'int_route', allowedOrigins: ['http://localhost:5173'] },
        BASE,
        { bind: false },
      );
    const direct = await handleInitiate(
      { ...body, origin: 'http://localhost:5173', ip: '9.9.9.9' },
      make(),
    );
    const res = await createInitiateRoute(make(), HEADERS)(post('/api/receive/initiate', body));
    expect(res.status).toBe(direct.status);
    expect(await res.json()).toEqual(direct.body);
    expect(direct.body).toEqual({ ok: true, intentId: 'int_route' });
    // a disallowed Origin is refused by the handler, not the wrapper
    const forbidden = await createInitiateRoute(make(), HEADERS)(
      new Request('https://demo.anchorcctp.com/api/receive/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify(body),
      }),
    );
    expect(forbidden.status).toBe(403);
  });

  it('initiate: a body that is not an object is refused by the handler, not the wrapper', async () => {
    const res = await createInitiateRoute(fakeDeps(), HEADERS)(
      new Request('https://demo.anchorcctp.com/api/receive/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '"not-an-object"',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_PARAMS' } });
  });

  it('settle: POST body reaches the handler and the receipt passes through', async () => {
    const settleInput = (extra: Record<string, unknown> = {}) => ({
      burnTxHash: HASH,
      address: G,
      amount: AMOUNT,
      sourceDomain: '6',
      transferMode: 'fast',
      intentId: 'int_seed',
      ...extra,
    });
    const settleDeps = () => {
      const d = fakeDeps();
      d.cctp = { receive: mintingReceive(d.state).receive } as never;
      return d;
    };
    const direct = await handleSettle(settleInput({ ip: '9.9.9.9' }), settleDeps());
    const res = await createSettleRoute(settleDeps(), HEADERS)(post('/api/receive/settle', settleInput()));
    expect(res.status).toBe(direct.status);
    expect(await res.json()).toEqual({ receipt: { stellarAmount: '99987', mintTxHash: 'MINT_TX_1' } });
    expect(direct.body).toEqual({ receipt: { stellarAmount: '99987', mintTxHash: 'MINT_TX_1' } });
  });

  it('fees: query params reach the handler and the quote passes through', async () => {
    const make = () => {
      const d = fakeDeps({ attestationBaseUrl: DEPLOY_ENV.CIRCLE_ATTESTATION_BASE_URL });
      d.fetch = (async () =>
        jsonResponse([
          { finalityThreshold: 1000, minimumFee: 1.3 },
          { finalityThreshold: 2000, minimumFee: 0 },
        ])) as never;
      return d;
    };
    const direct = await handleFees(
      { sourceDomain: '6', destDomain: '27', mode: 'fast', ip: '9.9.9.9' },
      make(),
    );
    const res = await createFeesRoute(make(), HEADERS)(
      get('/api/fees?sourceDomain=6&destDomain=27&mode=fast'),
    );
    expect(res.status).toBe(direct.status);
    expect(await res.json()).toEqual(direct.body);
  });

  it('config: serves publicConfigBundle with transferModes + fastWindowMs (R11)', async () => {
    const env = { ...DEPLOY_ENV, STELLAR_NETWORK: 'testnet', FAST_WINDOW_MS: '45000' };
    const res = await createConfigRoute(env, HEADERS)(get('/api/config'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.transferModes).toEqual(['fast', 'standard']);
    expect(body.fastWindowMs).toBe(45_000);
    // the deployed surface and the local server serve the same bundle
    expect(body).toEqual(publicConfigBundle(env));
    expect(res.headers.get('content-security-policy')).toBe(HEADERS['Content-Security-Policy']);

    // no secret in the env can reach the client
    const secret = 'S' + 'A'.repeat(55);
    const leaked = await createConfigRoute({ ...env, STELLAR_SECRET: secret }, HEADERS)(get('/api/config'));
    expect(JSON.stringify(await leaked.json())).not.toContain(secret);
  });

  it('a throwing handler still answers with headers + a structured code, not a bare 500', async () => {
    // A KV/RPC outage throws out of the handler (e.g. `deps.buckets.consumeIp`).
    // The wrapper must not let that become a header-less platform error.
    const secret = 'S' + 'A'.repeat(55);
    const boom = () => {
      throw new Error(`upstash unreachable: ${secret}`);
    };
    const throwingDeps = (over: Partial<HandlerDeps> = {}) =>
      fakeDeps({
        buckets: { consumeIp: boom, consumeSubject: boom } as never,
        feeCache: { get: boom, set: boom } as never,
        ...over,
      });

    const cases: Array<[string, Promise<Response>]> = [
      [
        'status',
        createStatusRoute(throwingDeps(), HEADERS)(
          get(`/api/receive/status?burnTxHash=${HASH}&address=${G}&amount=${AMOUNT}`),
        ),
      ],
      [
        'fees',
        // attestationBaseUrl set, so the call reaches the throwing fee cache
        createFeesRoute(
          throwingDeps({ attestationBaseUrl: DEPLOY_ENV.CIRCLE_ATTESTATION_BASE_URL }),
          HEADERS,
        )(get('/api/fees?sourceDomain=6&destDomain=27&mode=fast')),
      ],
      ['initiate', createInitiateRoute(throwingDeps(), HEADERS)(post('/api/receive/initiate', {}))],
      [
        'settle',
        createSettleRoute(throwingDeps(), HEADERS)(
          post('/api/receive/settle', {
            burnTxHash: HASH,
            address: G,
            amount: AMOUNT,
            sourceDomain: '6',
            transferMode: 'fast',
            intentId: 'int_seed',
          }),
        ),
      ],
    ];

    for (const [route, pending] of cases) {
      const res = await pending;
      expect(res.status, route).toBe(500);
      const body = JSON.stringify(await res.json());
      expect(body, route).toBe(
        JSON.stringify({
          error: {
            code: 'RECEIVE_FAILED',
            remediation: 'The API hit an unexpected error. Retry shortly.',
          },
        }),
      );
      expect(body, route).not.toContain(secret); // redacted upstream, never echoed
      expect(res.headers.get('content-security-policy'), route).toBe(
        HEADERS['Content-Security-Policy'],
      );
      expect(res.headers.get('cache-control'), route).toBe(NO_STORE);
      expect(res.headers.get('x-content-type-options'), route).toBe('nosniff');
    }
  });

  it('does not swallow a structured failure the handler already produced', async () => {
    // Same wrapper, no throw: the handler's 400 passes through byte-for-byte.
    const res = await createSettleRoute(fakeDeps(), HEADERS)(post('/api/receive/settle', {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_PARAMS' } });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('CSP connect-src carries the deployment origins, never the local-only default', () => {
    const csp = serverlessHeaders(DEPLOY_ENV)['Content-Security-Policy'];
    for (const origin of [
      'https://demo.anchorcctp.com',
      'https://iris-api-sandbox.circle.com',
      'https://horizon-testnet.stellar.org',
      'https://soroban-testnet.stellar.org',
    ]) {
      expect(csp).toContain(origin);
    }
    expect(csp).toContain('https://*.stellar.org');
    // …and the no-env default stays the local-only one, so a misconfigured deploy
    // is visibly restrictive rather than silently permissive.
    expect(serverlessHeaders({})['Content-Security-Policy']).not.toContain('https://demo.anchorcctp.com');
  });

  it('serverless deps fail fast on missing secrets in real mode — never a silent fallback', () => {
    const base = {
      STELLAR_NETWORK: 'testnet',
      STELLAR_DESTINATION: G,
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      CIRCLE_ATTESTATION_BASE_URL: 'https://iris-api-sandbox.circle.com',
    };
    expect(() => serverlessDeps({ ...base, SIM_MODE: 'true' })).toThrow(/SIM_MODE/);
    expect(() => serverlessDeps({ ...base, CIRCLE_ATTESTATION_BASE_URL: undefined })).toThrow(
      /CIRCLE_ATTESTATION_BASE_URL/,
    );
    expect(() => serverlessDeps(base)).toThrow(/KV_REST_API_URL/);
    expect(() =>
      serverlessDeps({ ...base, KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'tok' }),
    ).toThrow(/STELLAR_SECRET/);
  });
});
