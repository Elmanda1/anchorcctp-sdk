// apps/demo/server/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEventParams, publicConfigBundle, SimTimeline, postInitiate, fileStoreAt, collectSse, createSseHandler, parseAmountBase6, collectSseReal, gateRealStream, createIntentStore, createRealGate, RateLimitBuckets, readBodyCapped } from './events.js';
import { DEFAULT_FAST_WINDOW_MS } from './kv.js';
const tmpPath = () => join(mkdtempSync(join(tmpdir(), 'replay-')), 'replay.json');

const G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('validateEventParams', () => {
  it('normalizes uppercase burn hash', () => {
    const p = validateEventParams({ address: G, burnTxHash: '0X' + 'AB'.repeat(32), sourceDomain: '0', amount: '1.00' });
    expect(p.burnTxHash).toBe('0x' + 'ab'.repeat(32));
  });
  it('400s unknown domain', () => {
    expect(() => validateEventParams({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '999', amount: '1.00' }))
      .toThrow(/domain/i);
  });
  it('400s bad address', () => {
    expect(() => validateEventParams({ address: 'NOPE', burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '1.00' }))
      .toThrow(/address/i);
  });

  // F3 / spec §4: the receive contract opts in to `C…` recipients; the SSE and legacy
  // initiate paths (no option) keep their G-only contract, unchanged.
  it('accepts a C... contract only when the caller opts in', () => {
    const contract = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
    const q = { address: contract, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '1.00' };
    expect(() => validateEventParams(q)).toThrow(/valid G\.\.\./);
    expect(validateEventParams(q, { allowContractAddress: true }).address).toBe(contract);
    // A fabricated hex EVM address is still refused in both modes.
    const hex = { ...q, address: '0x' + '11'.repeat(20) };
    expect(() => validateEventParams(hex, { allowContractAddress: true })).toThrow(/address/i);
  });
});

describe('publicConfigBundle', () => {
  it('advertises both transfer modes and the server-side fast window (spec §4/R11)', () => {
    const bundle = publicConfigBundle({} as never);
    expect(bundle.transferModes).toEqual(['fast', 'standard']);
    expect(bundle.fastWindowMs).toBe(DEFAULT_FAST_WINDOW_MS);
    // FAST_WINDOW_MS is the one knob; the advertised window is the one the status
    // frame measures `elapsedMs` against, so they must move together.
    expect(publicConfigBundle({ FAST_WINDOW_MS: '45000' } as never).fastWindowMs).toBe(45_000);
  });
  it('leaks no secrets', () => {
    const bundle = publicConfigBundle({ SECRET: 'SDNMRSIZWINOTESTFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234', STELLAR_SECRET: 'SDNMRSIZWINOTESTFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234', VITE_NETWORK: 'testnet' } as never);
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/secret|private|seed|mnemonic|password|token/i);
    expect(text).not.toMatch(/S[A-Z2-7]{55}/);
  });
  it('denies POST without Origin', async () => {
    const res = await postInitiate({ headers: {} } as never);
    expect(res.status).toBe(403);
  });
  it('400 matrix: missing, non-numeric domain, array address', () => {
    for (const q of [
      { burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0' },
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 'abc' },
      { address: [G, G], burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0' },
      { address: ' ' + G + ' ', burnTxHash: '0X' + 'AB'.repeat(32), sourceDomain: '' },
    ]) expect(() => validateEventParams(q as never)).toThrow(/400|address|domain|burn/i);
  });
  it('429 on stream flood', async () => {
    const h = createSseHandler({ now: () => 0 } as never);
    for (let i = 0; i < 11; i++) h.mockRequest({ ip: '1.2.3.4', query: { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '1.00' } } as never);
    expect(h.lastStatus()).toBe(429);
  });
  it('replay served from persisted FileReplayStore', async () => {
    const store = fileStoreAt(tmpPath());
    await store.markProcessed('0x' + 'ab'.repeat(32));
    const events = await collectSse({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0' }, { store });
    expect(events.at(-1)).toMatchObject({ type: 'settled' });
  });
});

describe('SimTimeline', () => {
  it('flags simulated and emits 3 attempts then settled', () => {
    const steps = SimTimeline('0x' + 'ab'.repeat(32), 0);
    expect(steps.filter(s => s.type === 'receiving')).toHaveLength(3);
    expect(steps.at(-1)).toMatchObject({ type: 'settled', simulated: true });
    expect((steps.at(-1) as { mintTxHash: string }).mintTxHash).toMatch(/^SIM-/);
    expect((steps.at(-1) as { mintTxHash: string }).mintTxHash).not.toMatch(/^0x/);
  });
  it('enforces global concurrent cap', async () => {
    const h = createSseHandler({ now: () => 0, maxConcurrent: 2 } as never);
    h.mockRequest({ ip: '10.0.0.1', query: { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '1.00' } } as never);
    h.mockRequest({ ip: '10.0.0.2', query: { address: G, burnTxHash: '0x' + 'cd'.repeat(32), sourceDomain: '0', amount: '1.00' } } as never);
    h.mockRequest({ ip: '10.0.0.3', query: { address: G, burnTxHash: '0x' + 'ef'.repeat(32), sourceDomain: '0', amount: '1.00' } } as never);
    expect(h.lastStatus()).toBe(429);
  });
  it('single-flights same burnTxHash', async () => {
    let polls = 0;
    const sdkFactory = () => ({ poll: () => { polls++; return { onReceiving() {}, onSettled() {}, onError() {} }; } });
    const deps = { store: { isProcessed: async () => false }, sdkFactory, now: () => 0 } as never;
    await collectSse({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0' }, deps);
    await collectSse({ address: G, burnTxHash: '0X' + 'AB'.repeat(32), sourceDomain: '0' }, deps);
    expect(polls).toBe(1);
  });
});

describe('parseAmountBase6', () => {
  it('parses 100.00 to 100000000n', () => {
    expect(parseAmountBase6('100.00')).toBe(100000000n);
  });
  it('rejects 7-decimal precision', () => {
    expect(() => parseAmountBase6('100.0000001')).toThrow(/precision/i);
  });
  it('rejects negative, zero, empty, overflow', () => {
    expect(() => parseAmountBase6('-1')).toThrow();
    expect(() => parseAmountBase6('0')).toThrow();
    expect(() => parseAmountBase6('')).toThrow();
    expect(() => parseAmountBase6('18446744073709551616')).toThrow(/overflow|too large/i);
  });
});

describe('validateEventParams amount', () => {
  it('400s missing amount', () => {
    expect(() => validateEventParams({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0' } as never))
      .toThrow(/400.*amount/i);
  });
  it('400s 7-decimal amount', () => {
    expect(() => validateEventParams({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '100.0000001' } as never))
      .toThrow(/precision/i);
  });
  it('accepts valid amount', () => {
    const p = validateEventParams({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: ' 100.00 ' });
    expect(p.amount).toBe(100000000n);
  });
  it('accepts numeric sourceDomain (JSON body)', () => {
    const p = validateEventParams({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 6, amount: '0.10' } as never);
    expect(p.sourceDomain).toBe(6);
  });
});

describe('collectSseReal', () => {
  it('streams receiving then settled with server amounts', async () => {
    const store = fileStoreAt(tmpPath());
    const events = await collectSseReal(
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1000000n },
      {
        store,
        clientFactory: () => ({
          receive: async (params: unknown, ctx: {
            emitter: { on(e: string, cb: (d: never) => void): void };
          }) => {
            ctx.emitter.on('onReceiving', (d) => (d as { attempt: number }));
            return { amount: 1000000n, dust: 0n, txHash: 'SIM-REAL-1', settled: true };
          },
        }),
      },
    );
    const last = events.at(-1) as { type: string; txHash: string; simulated?: boolean };
    expect(last.type).toBe('settled');
    expect(last.txHash).toBe('SIM-REAL-1');
    expect(last.simulated).not.toBe(true);
  });
  it('persists the settled receipt into the durable store so settle never re-mints', async () => {
    const store = fileStoreAt(tmpPath());
    const hash = '0x' + 'cd'.repeat(32);
    await collectSseReal(
      { address: G, burnTxHash: hash, sourceDomain: 0, amount: 1000000n },
      {
        store,
        clientFactory: () => ({
          receive: async () => ({ amount: 1000000n, dust: 0n, txHash: 'SIM-REAL-1', settled: true }),
        }),
      },
    );
    expect(await store.isProcessed(hash)).toBe(true);
    expect((await store.getRecord(hash))?.status).toBe('settled');
  });
  it('evicts single-flight on rejection so retry re-polls', async () => {
    let calls = 0;
    const deps = {
      store: { isProcessed: async () => false },
      clientFactory: () => ({
        receive: async () => { calls++; throw new Error('iris timeout'); },
      }),
    } as never;
    await expect(collectSseReal({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n }, deps)).rejects.toThrow(/iris timeout/);
    await expect(collectSseReal({ address: G, burnTxHash: '0x' + 'AB'.repeat(32), sourceDomain: 0, amount: 1n }, deps)).rejects.toThrow(/iris timeout/);
    expect(calls).toBe(2);
  });
  it('does NOT share flight across different addresses', async () => {
    let calls = 0;
    const deps = {
      store: { isProcessed: async () => false },
      clientFactory: () => ({
        receive: async () => { calls++; return { amount: 1n, dust: 0n, txHash: 'TX', settled: true }; },
      }),
    } as never;
    const G2 = 'G' + 'C'.repeat(55);
    await collectSseReal({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n }, deps);
    await collectSseReal({ address: G2, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n }, deps);
    expect(calls).toBe(2);
  });
  it('maps ReplayTransferError to ALREADY_PROCESSED error event, not settled', async () => {
    const { ReplayTransferError } = await import('@anchor-cctp/core-sdk');
    const events = await collectSseReal(
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n },
      {
        store: { isProcessed: async () => false },
        clientFactory: () => ({
          receive: async () => { throw new ReplayTransferError('0x' + 'ab'.repeat(32)); },
        }),
      } as never,
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'ALREADY_PROCESSED' });
  });
  it('403s without POST intent', async () => {
    const res = await gateRealStream(
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n },
      { intents: { has: async () => false } } as never,
    );
    expect(res.status).toBe(403);
  });
  it('intent key normalizes amount formatting', async () => {
    const store = createIntentStore();
    store.record('0x' + 'ab'.repeat(32), G, '100.00');
    expect(await store.has('0x' + 'ab'.repeat(32), G, '100')).toBe(true);
  });
  it('429s POST intent flood per IP', async () => {
    const buckets = new RateLimitBuckets(() => 0, 60_000, 1, 10, 50, 1);
    const req = { headers: { origin: 'http://localhost:5173' }, body: { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: '0', amount: '1.00' }, ip: '9.9.9.9', buckets } as never;
    expect((await postInitiate(req)).status).toBe(200);
    expect((await postInitiate(req)).status).toBe(429);
  });
  it('400s amount above MAX_MINT_AMOUNT_USDC', async () => {
    const res = await gateRealStream(
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1000000000000n },
      { intents: { has: async () => true }, maxMintBase6: 1000000n } as never,
    );
    expect(res.status).toBe(400);
  });
  it('429s past concurrent real-mode cap', async () => {
    const gate = createRealGate({ maxConcurrentReceives: 1, active: () => 1 });
    expect(gate.tryAcquire()).toBe(false);
  });
  it('replay short-circuits before receive', async () => {
    const store = fileStoreAt(tmpPath());
    await store.markProcessed('0x' + 'ab'.repeat(32));
    let called = false;
    const events = await collectSseReal(
      { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n },
      { store, clientFactory: () => ({ receive: async () => { called = true; } }) } as never,
    );
    expect(called).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'settled' });
  });
  it('never logs secrets', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
    try {
      await expect(collectSseReal(
        { address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: 1n },
        { store: { isProcessed: async () => false }, clientFactory: () => ({ receive: async () => { throw new Error('boom SDNMRSIZWINOTESTFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234'); } }) } as never,
      )).rejects.toThrow();
    } finally { spy.mockRestore(); }
    expect(logged.join('\n')).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

describe('readBodyCapped', () => {
  function mockReq(chunks: string[]) {
    return { [Symbol.asyncIterator]: function* () { for (const c of chunks) yield c; } } as never;
  }
  function mockRes() {
    const state: { status?: number; body?: string } = {};
    return {
      writeHead: (s: number) => { state.status = s; },
      end: (b: string) => { state.body = b; },
      _state: state,
    } as never;
  }
  it('reads normal body', async () => {
    const res = mockRes();
    const r = await readBodyCapped(mockReq(['hello']), res);
    expect(r).toEqual({ body: 'hello' });
  });
  it('rejects body exceeding 4096 chars with 413', async () => {
    const res = mockRes();
    const big = 'x'.repeat(4097);
    const r = await readBodyCapped(mockReq([big]), res);
    expect(r).toEqual({ error: true });
    expect(res._state.status).toBe(413);
    expect(JSON.parse(res._state.body!)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
  it('accepts body exactly at 4096 chars', async () => {
    const res = mockRes();
    const exact = 'y'.repeat(4096);
    const r = await readBodyCapped(mockReq([exact]), res);
    expect(r).toEqual({ body: exact });
  });
});
