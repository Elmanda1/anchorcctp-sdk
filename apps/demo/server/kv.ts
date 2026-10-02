// apps/demo/server/kv.ts
// KV-backed stores for the serverless receive handlers, plus their in-memory twins.
// Framework-free: the handlers depend only on these interfaces, so serve.ts (local,
// in-memory + FileReplayStore) and Vercel (Upstash Redis) swap implementations.
// ponytail: server-only module — never bundled for browser.

import { Horizon, Networks } from '@stellar/stellar-sdk';
import { Redis } from '@upstash/redis';
import type {
  AnchorCCTP,
  IReplayStoreAdapter,
  SettlementRecord,
  SorobanTransport,
  TransferFee,
} from '@anchor-cctp/core-sdk';
import {
  createAnchorCCTPFromEnv,
  encodeSettlementRecord,
  decodeSettlementRecord,
} from '@anchor-cctp/core-sdk';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Intent lifetime. An expired intent must never re-enable a mint — the replay record outlives it. */
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Single-flight lock TTL: a crashed invocation cannot wedge a hash forever. */
export const SETTLE_LOCK_TTL_MS = 60_000;
/** Server-side "did we get Fast?" window; the client renders it, never computes it. */
export const DEFAULT_FAST_WINDOW_MS = 90_000;
/** Iris fee-route cache window. */
export const FEE_CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * Attestation poll budget for the settle path. Attestation is hot by the time the
 * client calls settle, so a tight budget (10 attempts, ~60s worst case) keeps one
 * Hobby invocation far inside its 300s ceiling; beyond it the client keeps polling.
 */
export const SETTLE_MAX_RETRIES = 10;

const BUCKET_WINDOW_MS = 60_000;
const BUCKET_LIMITS = { status: 60, initiate: 20, settle: 5 } as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TransferModeName = 'fast' | 'standard';
export type BucketName = keyof typeof BUCKET_LIMITS;

/** KV intent: hash bound to address + amount + mode at first write (first-claimer wins). */
export interface StoredIntent {
  intentId: string;
  burnTxHash: string;
  address: string;
  /** Base-6 USDC amount as a string (bigint-safe in KV). */
  amount: string;
  sourceDomain: number;
  transferMode: TransferModeName;
  /** Base-6 max fee the user approved, as a string. */
  maxFee?: string;
  /** Server clock (ms epoch). `elapsedMs`/`degraded` derive from this, never a client value. */
  createdAt: number;
}

export interface IntentStore {
  put(intent: StoredIntent): Promise<StoredIntent>;
  get(intentId: string, burnTxHash: string): Promise<StoredIntent | null>;
  find(burnTxHash: string, address: string, amount: string): Promise<StoredIntent | null>;
  /** Legacy `createIntentStore` binding: hash+address+amount → intent, without a full record. */
  record(burnTxHash: string, address: string, amount: string): Promise<void>;
  has(burnTxHash: string, address: string, amount: string): Promise<boolean>;
}

export interface LockStore {
  /** Returns an opaque token, or null when the lock is already held. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

export interface BucketStore {
  /** true = allowed (and consumed). Buckets key on the Vercel-trusted client IP only. */
  consumeIp(bucket: BucketName, ip: string): Promise<boolean>;
  consumeSubject(bucket: BucketName, ip: string, subject: string): Promise<boolean>;
}

export interface FeeCacheEntry {
  fast: TransferFee | null;
  standard: TransferFee | null;
  cachedAtMs: number;
  cachedAt: string;
}

export interface FeeCache {
  get(key: string): Promise<FeeCacheEntry | null>;
  set(key: string, entry: FeeCacheEntry): Promise<void>;
}

/** Minimal Upstash surface the stores need — structural, so tests inject plain doubles. */
export interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  incr?(key: string): Promise<number>;
  expire?(key: string, seconds: number): Promise<unknown>;
  del?(key: string): Promise<unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeReplayKey(burnTxHash: string): string {
  return '0x' + burnTxHash.trim().slice(2).toLowerCase();
}

function bindKey(burnTxHash: string, address: string, amount: string): string {
  return `${normalizeReplayKey(burnTxHash)}|${address}|${amount}`;
}

function intentKey(intentId: string): string {
  return `intent:${intentId}`;
}

function legacyBindKey(burnTxHash: string, address: string, amount: string): string {
  return `intent:bind:${bindKey(burnTxHash, address, amount)}`;
}

/**
 * Bigint-safe settlement JSON — the **same** encoder `FileReplayStore` uses in core,
 * re-exported so the Redis and file stores cannot drift apart on how a `settled`
 * receipt is written.
 */
export { encodeSettlementRecord, decodeSettlementRecord };

// ─── In-memory stores (tests + local serve.ts) ───────────────────────────────

export class MemoryIntentStore implements IntentStore {
  private readonly intents = new Map<string, { intent: StoredIntent; expiresAt: number }>();
  private readonly bindings = new Map<string, { intentId: string; expiresAt: number }>();
  private readonly clock: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.clock = opts.now ?? (() => Date.now());
  }

  private live<T extends { expiresAt: number }>(entry: T | undefined): T | null {
    if (!entry || entry.expiresAt <= this.clock()) return null;
    return entry;
  }

  /**
   * First-claimer wins (spec §9): the `(hash|address|amount)` binding is claimed once.
   * A later initiate for the same tuple must not re-point the binding — otherwise a
   * third party knowing the public burn hash + address + amount could flip
   * `transferMode` or reset `createdAt` and so suppress or fake the status frame's
   * `elapsedMs`/`degraded`.
   */
  async put(intent: StoredIntent): Promise<StoredIntent> {
    const key = bindKey(intent.burnTxHash, intent.address, intent.amount);
    const claimed = this.live(this.bindings.get(key));
    if (claimed) {
      const winner = this.live(this.intents.get(claimed.intentId));
      if (winner) return winner.intent;
    }
    const expiresAt = this.clock() + INTENT_TTL_MS;
    this.intents.set(intent.intentId, { intent, expiresAt });
    this.bindings.set(key, { intentId: intent.intentId, expiresAt });
    return intent;
  }

  async get(intentId: string, burnTxHash: string): Promise<StoredIntent | null> {
    const entry = this.live(this.intents.get(intentId));
    if (!entry) return null;
    const wanted = normalizeReplayKey(burnTxHash);
    return normalizeReplayKey(entry.intent.burnTxHash) === wanted ? entry.intent : null;
  }

  async find(burnTxHash: string, address: string, amount: string): Promise<StoredIntent | null> {
    const binding = this.live(this.bindings.get(bindKey(burnTxHash, address, amount)));
    if (!binding) return null;
    return this.get(binding.intentId, burnTxHash);
  }

  async record(burnTxHash: string, address: string, amount: string): Promise<void> {
    this.bindings.set(bindKey(burnTxHash, address, amount), {
      intentId: 'int_legacy',
      expiresAt: this.clock() + INTENT_TTL_MS,
    });
  }

  async has(burnTxHash: string, address: string, amount: string): Promise<boolean> {
    return this.live(this.bindings.get(bindKey(burnTxHash, address, amount))) !== null;
  }

  [Symbol.dispose](): void {
    this.intents.clear();
    this.bindings.clear();
  }
}

/** In-memory replay store. Records are permanent — no TTL, ever. */
export class MemoryReplayStore implements IReplayStoreAdapter {
  private readonly records = new Map<string, SettlementRecord>();

  constructor(_opts: { now?: () => number } = {}) {
    void _opts;
  }

  async isProcessed(burnTxHash: string): Promise<boolean> {
    return this.records.has(normalizeReplayKey(burnTxHash));
  }

  async markProcessed(burnTxHash: string, record: SettlementRecord): Promise<void> {
    const key = normalizeReplayKey(burnTxHash);
    this.records.set(key, { ...record, burnTxHash: key });
  }

  async getRecord(burnTxHash: string): Promise<SettlementRecord | null> {
    return this.records.get(normalizeReplayKey(burnTxHash)) ?? null;
  }
}

export class MemoryLock implements LockStore {
  private readonly held = new Map<string, { token: string; expiresAt: number }>();
  private readonly clock: () => number;
  private counter = 0;

  constructor(opts: { now?: () => number } = {}) {
    this.clock = opts.now ?? (() => Date.now());
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const now = this.clock();
    const existing = this.held.get(key);
    if (existing && existing.expiresAt > now) return null;
    const token = `lock_${++this.counter}`;
    this.held.set(key, { token, expiresAt: now + ttlMs });
    return token;
  }

  async release(key: string, token: string): Promise<void> {
    const existing = this.held.get(key);
    if (existing && existing.token === token) this.held.delete(key);
  }
}

export class MemoryBuckets implements BucketStore {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();
  private readonly clock: () => number;
  private readonly limits: Record<BucketName, number>;
  private readonly windowMs: number;

  constructor(
    opts: { now?: () => number; windowMs?: number; limits?: Partial<Record<BucketName, number>> } = {},
  ) {
    this.clock = opts.now ?? (() => Date.now());
    this.windowMs = opts.windowMs ?? BUCKET_WINDOW_MS;
    this.limits = { ...BUCKET_LIMITS, ...(opts.limits ?? {}) };
  }

  private hit(key: string, limit: number): boolean {
    const now = this.clock();
    const window = this.windows.get(key);
    if (!window || window.expiresAt <= now) {
      this.windows.set(key, { count: 1, expiresAt: now + this.windowMs });
      return limit >= 1;
    }
    window.count++;
    return window.count <= limit;
  }

  async consumeIp(bucket: BucketName, ip: string): Promise<boolean> {
    return this.hit(`rl:${bucket}:ip:${ip}`, this.limits[bucket]);
  }

  async consumeSubject(bucket: BucketName, ip: string, subject: string): Promise<boolean> {
    return this.hit(`rl:${bucket}:ip:${ip}:${subject}`, this.limits[bucket]);
  }

  [Symbol.dispose](): void {
    this.windows.clear();
  }
}

export class MemoryFeeCache implements FeeCache {
  private readonly entries = new Map<string, { entry: FeeCacheEntry; expiresAt: number }>();
  private readonly clock: () => number;
  private readonly ttlMs: number;

  constructor(opts: { now?: () => number; ttlMs?: number } = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.ttlMs = opts.ttlMs ?? FEE_CACHE_TTL_MS;
  }

  async get(key: string): Promise<FeeCacheEntry | null> {
    const stored = this.entries.get(key);
    if (!stored || stored.expiresAt <= this.clock()) return null;
    return stored.entry;
  }

  async set(key: string, entry: FeeCacheEntry): Promise<void> {
    this.entries.set(key, { entry, expiresAt: this.clock() + this.ttlMs });
  }

  [Symbol.dispose](): void {
    this.entries.clear();
  }
}

// ─── Upstash-backed stores ───────────────────────────────────────────────────

/** KV intent store over Upstash REST. Intents (and their bindings) carry a 24h TTL. */
export class KvIntentStore implements IntentStore {
  private readonly clock: () => number;

  constructor(
    private readonly redis: RedisLike,
    opts: { now?: () => number } = {},
  ) {
    this.clock = opts.now ?? (() => Date.now());
  }

  private ttlSeconds(): number {
    return Math.ceil(INTENT_TTL_MS / 1000);
  }

  private parse(raw: unknown): StoredIntent | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
      const obj = JSON.parse(raw) as StoredIntent;
      if (typeof obj?.intentId !== 'string' || typeof obj?.burnTxHash !== 'string') return null;
      if (obj.createdAt + INTENT_TTL_MS <= this.clock()) return null;
      return obj;
    } catch {
      return null;
    }
  }

  /**
   * First-claimer wins (spec §9). The binding is written with `SET … NX` so two
   * concurrent initiates for the same `(hash|address|amount)` cannot both claim it;
   * the loser returns the winner's intent instead of re-pointing the key. Without NX
   * a second initiate could flip `transferMode` / reset `createdAt` and thereby
   * suppress or fake the status frame's `elapsedMs`/`degraded`.
   */
  async put(intent: StoredIntent): Promise<StoredIntent> {
    const ex = this.ttlSeconds();
    const bound = await this.redis.set(
      legacyBindKey(intent.burnTxHash, intent.address, intent.amount),
      intent.intentId,
      { ex, nx: true },
    );
    if (bound === null) {
      const winner = await this.find(intent.burnTxHash, intent.address, intent.amount);
      if (winner) return winner;
    }
    await this.redis.set(intentKey(intent.intentId), JSON.stringify(intent), { ex });
    return intent;
  }

  async get(intentId: string, burnTxHash: string): Promise<StoredIntent | null> {
    const intent = this.parse(await this.redis.get(intentKey(intentId)));
    if (!intent) return null;
    return normalizeReplayKey(intent.burnTxHash) === normalizeReplayKey(burnTxHash) ? intent : null;
  }

  async find(burnTxHash: string, address: string, amount: string): Promise<StoredIntent | null> {
    const raw = await this.redis.get(legacyBindKey(burnTxHash, address, amount));
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return this.get(raw, burnTxHash);
  }

  async record(burnTxHash: string, address: string, amount: string): Promise<void> {
    await this.redis.set(legacyBindKey(burnTxHash, address, amount), 'int_legacy', {
      ex: this.ttlSeconds(),
    });
  }

  async has(burnTxHash: string, address: string, amount: string): Promise<boolean> {
    const raw = await this.redis.get(legacyBindKey(burnTxHash, address, amount));
    return typeof raw === 'string' && raw.length > 0;
  }
}

/**
 * Replay store over Upstash REST. Records are written **without** a TTL: an intent
 * expiring at 24h must never re-enable a mint for a hash that already settled.
 */
export class RedisReplayStore implements IReplayStoreAdapter {
  constructor(private readonly redis: RedisLike) {}

  private key(burnTxHash: string): string {
    return `replay:${normalizeReplayKey(burnTxHash)}`;
  }

  async isProcessed(burnTxHash: string): Promise<boolean> {
    return (await this.redis.get(this.key(burnTxHash))) !== null;
  }

  async markProcessed(burnTxHash: string, record: SettlementRecord): Promise<void> {
    // No TTL option on purpose — permanent.
    await this.redis.set(
      this.key(burnTxHash),
      encodeSettlementRecord({ ...record, burnTxHash: normalizeReplayKey(burnTxHash) }),
    );
  }

  async getRecord(burnTxHash: string): Promise<SettlementRecord | null> {
    const raw = await this.redis.get(this.key(burnTxHash));
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
      return decodeSettlementRecord(raw);
    } catch {
      return null;
    }
  }
}

/** Single-flight settle lock over Upstash REST (SET NX EX). 60s TTL by default. */
export class RedisLock implements LockStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds = Math.ceil(SETTLE_LOCK_TTL_MS / 1000),
  ) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    // CSPRNG only: a guessable token would let a caller release someone else's lock.
    const token = globalThis.crypto.randomUUID();
    const res = await this.redis.set(`lock:${key}`, token, {
      nx: true,
      ex: Math.max(1, Math.ceil(ttlMs / 1000)),
    });
    return res === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    const held = await this.redis.get(`lock:${key}`);
    if (held === token && this.redis.del) await this.redis.del(`lock:${key}`);
  }
}

/** Distributed rate buckets over Upstash REST (INCR + EXPIRE on first hit). */
export class RedisBuckets implements BucketStore {
  private readonly limits: Record<BucketName, number>;
  private readonly windowSeconds: number;

  constructor(
    private readonly redis: RedisLike,
    opts: { windowMs?: number; limits?: Partial<Record<BucketName, number>> } = {},
  ) {
    this.windowSeconds = Math.ceil((opts.windowMs ?? BUCKET_WINDOW_MS) / 1000);
    this.limits = { ...BUCKET_LIMITS, ...(opts.limits ?? {}) };
  }

  private async hit(key: string, limit: number): Promise<boolean> {
    if (!this.redis.incr) throw new Error('RedisBuckets requires an INCR-capable client');
    const count = await this.redis.incr(key);
    if (count === 1 && this.redis.expire) await this.redis.expire(key, this.windowSeconds);
    return count <= limit;
  }

  async consumeIp(bucket: BucketName, ip: string): Promise<boolean> {
    return this.hit(`rl:${bucket}:ip:${ip}`, this.limits[bucket]);
  }

  async consumeSubject(bucket: BucketName, ip: string, subject: string): Promise<boolean> {
    return this.hit(`rl:${bucket}:ip:${ip}:${subject}`, this.limits[bucket]);
  }
}

export class RedisFeeCache implements FeeCache {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds = Math.ceil(FEE_CACHE_TTL_MS / 1000),
  ) {}

  async get(key: string): Promise<FeeCacheEntry | null> {
    const raw = await this.redis.get(`fee:${key}`);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
      const parsed = JSON.parse(raw) as FeeCacheEntry;
      if (typeof parsed?.cachedAtMs !== 'number' || typeof parsed?.cachedAt !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async set(key: string, entry: FeeCacheEntry): Promise<void> {
    await this.redis.set(`fee:${key}`, JSON.stringify(entry), { ex: this.ttlSeconds });
  }
}

// ─── Cold-start env enforcement ──────────────────────────────────────────────

const STELLAR_HOST_OK = (host: string): boolean =>
  host.endsWith('.stellar.org') || host === 'localhost';

function requireHttpsUrl(
  name: string,
  value: string | undefined,
  allowlist: (host: string) => boolean,
): string {
  if (!value) throw new Error(`${name} is required. Set it to an https URL.`);
  if (!/^https:\/\//.test(value)) throw new Error(`${name} must be https, got "${value}".`);
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}".`);
  }
  if (!allowlist(host)) {
    throw new Error(`${name} host "${host}" is not in the allowlist (*.stellar.org or localhost).`);
  }
  return value;
}

/**
 * Iris base URL must be explicit **and** network-consistent. A missing
 * `CIRCLE_ATTESTATION_BASE_URL` used to fall back to mainnet Iris and 404 testnet
 * hashes through all 60 poll retries (~14 min burn) — never default across networks.
 */
function requireAttestationUrl(value: string | undefined, network: 'testnet' | 'mainnet'): string {
  if (!value) {
    throw new Error(
      'CIRCLE_ATTESTATION_BASE_URL is required — there is no cross-network default. ' +
        'testnet → https://iris-api-sandbox.circle.com, mainnet → https://iris-api.circle.com.',
    );
  }
  if (!/^https:\/\//.test(value)) {
    throw new Error(`CIRCLE_ATTESTATION_BASE_URL must be https, got "${value}".`);
  }
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`CIRCLE_ATTESTATION_BASE_URL is not a valid URL: "${value}".`);
  }
  if (network === 'mainnet') {
    if (!host.startsWith('iris-api.')) {
      throw new Error(
        `CIRCLE_ATTESTATION_BASE_URL host "${host}" is not a mainnet iris-api host for STELLAR_NETWORK=mainnet.`,
      );
    }
  } else if (!host.startsWith('iris-api-sandbox.')) {
    throw new Error(
      `CIRCLE_ATTESTATION_BASE_URL host "${host}" must be an iris-api-sandbox host when STELLAR_NETWORK=testnet.`,
    );
  }
  return value;
}

export interface ColdStartEnv {
  network: 'testnet' | 'mainnet';
  horizonUrl: string;
  sorobanRpcUrl: string;
  attestationBaseUrl: string;
}

/**
 * Validates the real-mode env at cold start: network, https + host allowlist for
 * RPC/Horizon, and an explicit network-consistent Iris base. Throws before serving.
 */
export function assertColdStartEnv(env: Record<string, string | undefined>): ColdStartEnv {
  const raw = env.STELLAR_NETWORK ?? 'testnet';
  if (raw !== 'testnet' && raw !== 'mainnet') {
    throw new Error('STELLAR_NETWORK must be "testnet" or "mainnet".');
  }
  const network: 'testnet' | 'mainnet' = raw;
  return {
    network,
    horizonUrl: requireHttpsUrl('HORIZON_URL', env.HORIZON_URL, STELLAR_HOST_OK),
    sorobanRpcUrl: requireHttpsUrl('SOROBAN_RPC_URL', env.SOROBAN_RPC_URL, STELLAR_HOST_OK),
    attestationBaseUrl: requireAttestationUrl(env.CIRCLE_ATTESTATION_BASE_URL, network),
  };
}

// ─── Composition root ────────────────────────────────────────────────────────

// The `rpc.Server` → `SorobanTransport` adapter lives in core (`createSorobanTransport`,
// passphrase-threaded, no testnet default) — R9 wires it into `createAnchorCCTPFromEnv`
// together with the Horizon trustline provider, so the settle path reuses that instance.

/** Everything the serverless handlers need, built from the real-mode env. */
export interface EnvDeps {
  intents: IntentStore;
  replay: IReplayStoreAdapter;
  locks: LockStore;
  buckets: BucketStore;
  feeCache: FeeCache;
  cctp: AnchorCCTP;
  attestationBaseUrl: string;
  settleTransport: {
    sponsorAccount: string;
    rpc: SorobanTransport;
    readSequence: () => Promise<string>;
    networkPassphrase: string;
  };
  maxMintBase6?: bigint;
  allowedOrigins?: string[];
  fastWindowMs?: number;
}

/**
 * Builds the serverless deps from env. Refuses to build without KV credentials
 * (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, Upstash via the Vercel Marketplace) or
 * without a sponsor secret — both are cold-start requirements in real mode.
 */
export function depsFromEnv(env: Record<string, string | undefined>): EnvDeps {
  const cold = assertColdStartEnv(env);

  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      'KV_REST_API_URL and KV_REST_API_TOKEN are required (Upstash Redis via the Vercel Marketplace).',
    );
  }

  // ATTESTATION budget: a settle must not outlive the function cap, so the
  // attestation poll is capped at SETTLE_MAX_RETRIES (exhaustion → NOT_READY).
  const { client, destinationAddress, keypair, sorobanTransport } = createAnchorCCTPFromEnv(env, {
    maxRetries: SETTLE_MAX_RETRIES,
  });
  if (!keypair) {
    throw new Error('STELLAR_SECRET is required in real mode (SIM_MODE=false).');
  }
  // R9: the same passphrase-threaded transport the client mints with — no testnet default.
  if (!sorobanTransport) {
    throw new Error('SOROBAN_RPC_URL is required in real mode (no Soroban transport to mint with).');
  }

  const redis = new Redis({ url, token }) as unknown as RedisLike;
  const horizon = new Horizon.Server(cold.horizonUrl);
  const networkPassphrase =
    cold.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  // R9: the client carries the trustline provider, the Soroban transport and the
  // sponsor; `readSequence` is the one thing core cannot know — the sponsor's real
  // account sequence must come from chain at settle time (never "0").
  const sponsor = destinationAddress;

  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // VERCEL_URL is the per-deployment hostname — it changes on every deploy and is
  // never the domain the site is served from, so an allowlist built from it alone
  // 403s the production browser. VERCEL_PROJECT_PRODUCTION_URL is the stable one.
  if (env.VERCEL_URL) origins.push(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  return {
    intents: new KvIntentStore(redis),
    replay: new RedisReplayStore(redis),
    locks: new RedisLock(redis),
    buckets: new RedisBuckets(redis),
    feeCache: new RedisFeeCache(redis),
    cctp: client,
    attestationBaseUrl: cold.attestationBaseUrl,
    settleTransport: {
      sponsorAccount: sponsor,
      rpc: sorobanTransport,
      readSequence: async () => {
        const account = await horizon.loadAccount(sponsor);
        return account.sequence;
      },
      networkPassphrase,
    },
    ...(env.MAX_MINT_AMOUNT_USDC ? { maxMintBase6: BigInt(env.MAX_MINT_AMOUNT_USDC) } : {}),
    ...(origins.length > 0 ? { allowedOrigins: origins } : {}),
    ...(env.FAST_WINDOW_MS ? { fastWindowMs: Number(env.FAST_WINDOW_MS) } : {}),
  };
}
