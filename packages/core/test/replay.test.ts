import {
  ReplayStore,
  SettlementRecord,
  encodeSettlementRecord,
  decodeSettlementRecord,
} from '../src/replay/index.js';
import { FileReplayStore } from '../src/replay/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TMP_DIR = path.join(os.tmpdir(), 'opencode');

describe('Replay Guard & Idempotency Store', () => {
  it('marks and checks processed transactions in memory', async () => {
    const s = new ReplayStore();
    expect(await s.isProcessed('0x1')).toBe(false);
    expect(await s.getRecord('0x1')).toBeNull();

    const record: SettlementRecord = {
      burnTxHash: '0x1',
      txHash: '0xm',
      amount: 10000000n,
      dust: 0n,
      timestamp: new Date().toISOString(),
    };

    await s.markProcessed('0x1', record);
    expect(await s.isProcessed('0x1')).toBe(true);
    const retrieved = await s.getRecord('0x1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.txHash).toBe('0xm');
    expect(retrieved!.amount).toBe(10000000n);
  });

  it('supports custom pluggable store adapter', async () => {
    const customMap = new Map<string, SettlementRecord>();
    const customAdapter = {
      isProcessed: async (h: string) => customMap.has(h),
      markProcessed: async (h: string, r: SettlementRecord) => {
        customMap.set(h, r);
      },
      getRecord: async (h: string) => customMap.get(h) || null,
    };

    const s = new ReplayStore(customAdapter);
    expect(await s.isProcessed('0x2')).toBe(false);

    await s.markProcessed('0x2', { burnTxHash: '0x2', txHash: '0xcustom' });
    expect(await s.isProcessed('0x2')).toBe(true);
    expect(customMap.get('0x2')?.txHash).toBe('0xcustom');
  });
});

describe('ReplayStore key normalization (in-memory)', () => {
  it('normalizes case: 0xABC and 0xabc resolve to same key', async () => {
    const s = new ReplayStore();
    const hash = '0x' + 'ab'.repeat(32);
    await s.markProcessed(hash, { burnTxHash: hash, txHash: 'T1' });

    const upper = '0x' + 'AB'.repeat(32);
    expect(await s.isProcessed(upper)).toBe(true);
    const record = await s.getRecord(upper);
    expect(record).not.toBeNull();
    expect(record!.txHash).toBe('T1');
  });

  it('in-memory store works without adapter', async () => {
    const s = new ReplayStore();
    expect(s).toBeDefined();
    await expect(s.isProcessed('NOT NORMALIZED')).resolves.toBe(false);
  });
});

describe('FileReplayStore', () => {
  const storePath = path.join(TMP_DIR, 'replay-test.json');

  beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    try { fs.unlinkSync(storePath); } catch { /* ok */ }
    try { fs.unlinkSync(storePath + '.tmp'); } catch { /* ok */ }
  });

  afterEach(() => {
    try { fs.unlinkSync(storePath); } catch { /* ok */ }
    try { fs.unlinkSync(storePath + '.tmp'); } catch { /* ok */ }
  });

  it('same adapter across clients rejects replay (restart-simulated)', async () => {
    const adapter = new FileReplayStore(storePath);
    const a = new ReplayStore(adapter);
    const b = new ReplayStore(adapter);
    const h = '0x' + 'dd'.repeat(32);
    await a.markProcessed(h, { burnTxHash: h, txHash: 'T1' });
    await expect(b.isProcessed(h)).resolves.toBe(true);
  });

  it('normalizes case across file reads', async () => {
    const adapter = new FileReplayStore(storePath);
    const s = new ReplayStore(adapter);
    const lower = '0x' + 'aa'.repeat(32);
    const upper = '0x' + 'AA'.repeat(32);
    await s.markProcessed(lower, { burnTxHash: lower, txHash: 'T1' });
    expect(await s.isProcessed(upper)).toBe(true);
    expect(await s.getRecord(upper)).not.toBeNull();
  });

  // Windows ignores POSIX file modes, so this assertion only holds on POSIX hosts.
  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('writes file with restricted permissions', async () => {
    const adapter = new FileReplayStore(storePath);
    const s = new ReplayStore(adapter);
    await s.markProcessed('0x' + 'bb'.repeat(32), { burnTxHash: '0x' + 'bb'.repeat(32), txHash: 'T2' });
    const stat = fs.statSync(storePath);
    const mode = (stat.mode & 0o777).toString(8);
    expect(mode).toBe('600');
  });

  it('returns null/empty for missing keys', async () => {
    const adapter = new FileReplayStore(storePath);
    const s = new ReplayStore(adapter);
    expect(await s.isProcessed('0x' + 'cc'.repeat(32))).toBe(false);
    expect(await s.getRecord('0x' + 'cc'.repeat(32))).toBeNull();
  });

  it('atomic write survives partial read (file always valid JSON)', async () => {
    const adapter = new FileReplayStore(storePath);
    const s = new ReplayStore(adapter);
    await s.markProcessed('0x' + 'ee'.repeat(32), { burnTxHash: '0x' + 'ee'.repeat(32), txHash: 'T3' });
    await s.markProcessed('0x' + 'ff'.repeat(32), { burnTxHash: '0x' + 'ff'.repeat(32), txHash: 'T4' });
    const raw = fs.readFileSync(storePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // F1: a confirmed mint's receipt carries bigint amount/dust. A bare JSON.stringify
  // throws on those, so the durable record would never be written and a retry would
  // re-enter receive(). The round-trip must return bigints.
  it('round-trips bigint amount/dust through a real file (no TypeError)', async () => {
    const hash = '0x' + 'ab'.repeat(32);
    const adapter = new FileReplayStore(storePath);
    expect(() =>
      adapter.markProcessed(hash, {
        burnTxHash: hash,
        txHash: 'MINT1',
        amount: 10000000n,
        dust: 0n,
        sourceDomain: 6,
        destinationAddress: 'GDEST',
        timestamp: '2026-09-25T00:00:00.000Z',
        status: 'settled',
      }),
    ).not.toThrow();

    // Fresh adapter = fresh read from disk, no shared in-memory state.
    const reread = new FileReplayStore(storePath).getRecord(hash)!;
    expect(reread.amount).toBe(10000000n);
    expect(typeof reread.amount).toBe('bigint');
    expect(reread.dust).toBe(0n);
    expect(typeof reread.dust).toBe('bigint');
    expect(reread.status).toBe('settled');
    expect(reread.sourceDomain).toBe(6);
    expect(reread.txHash).toBe('MINT1');

    // The file stays valid JSON and stores the bigints as "…n" strings.
    const raw = fs.readFileSync(storePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('"10000000n"');
  });

  it('round-trips a record without amount/dust (submitted, pre-conversion)', async () => {
    const hash = '0x' + 'ac'.repeat(32);
    const adapter = new FileReplayStore(storePath);
    adapter.markProcessed(hash, {
      burnTxHash: hash,
      txHash: 'MINT2',
      status: 'submitted',
      timestamp: '2026-09-25T00:00:00.000Z',
    });
    const reread = new FileReplayStore(storePath).getRecord(hash)!;
    expect(reread.status).toBe('submitted');
    expect(reread.amount).toBeUndefined();
    expect(reread.dust).toBeUndefined();
  });
});

describe('settlement record JSON (bigint-safe)', () => {
  it('encodes bigints as "…n" strings and decodes them back to bigints', () => {
    const encoded = encodeSettlementRecord({
      burnTxHash: '0xabc',
      txHash: 'M1',
      amount: 123n,
      dust: 0n,
      sourceDomain: 6,
      destinationAddress: 'GDEST',
      timestamp: 't',
      status: 'settled',
    });
    expect(encoded).toContain('"123n"');
    expect(encoded).toContain('"0n"');
    const decoded = decodeSettlementRecord(encoded);
    expect(decoded.amount).toBe(123n);
    expect(decoded.dust).toBe(0n);
    expect(decoded.status).toBe('settled');
    expect(decoded.sourceDomain).toBe(6);
  });

  it('tolerates records written without bigint fields or with legacy numeric values', () => {
    const bare = decodeSettlementRecord('{"burnTxHash":"0xabc","txHash":"M1","status":"submitted"}');
    expect(bare.amount).toBeUndefined();
    expect(bare.dust).toBeUndefined();
    expect(bare.status).toBe('submitted');

    // Legacy value (written before the bigint encoding existed) must not crash.
    const legacy = decodeSettlementRecord('{"burnTxHash":"0xabc","txHash":"M1","amount":5}');
    expect(legacy.txHash).toBe('M1');
  });

  it('handles negative and zero bigints, and leaves look-alike strings alone', () => {
    const encoded = encodeSettlementRecord({
      burnTxHash: '0xabc',
      txHash: 'M1',
      amount: 0n,
      dust: -7n,
      destinationAddress: 'Gn0tAbigint',
    });
    const decoded = decodeSettlementRecord(encoded);
    expect(decoded.amount).toBe(0n);
    expect(decoded.dust).toBe(-7n);
    expect(decoded.destinationAddress).toBe('Gn0tAbigint');
  });
});
