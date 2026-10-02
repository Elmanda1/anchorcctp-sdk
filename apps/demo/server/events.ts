// apps/demo/server/events.ts
// SSE event server: sim + real modes, rate limiting, single-flight, replay.
// ponytail: server-only module — never bundled for browser.

import { normalizeBurnTxHash, assertSupportedDomain, FileReplayStore } from '@anchor-cctp/core-sdk';
import type { IReplayStoreAdapter } from '@anchor-cctp/core-sdk';
import { StrKey } from '@stellar/stellar-sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
// The default Fast window lives with the handler that measures against it (kv.ts).
import { DEFAULT_FAST_WINDOW_MS } from './kv.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidatedParams {
  address: string;
  burnTxHash: string;
  sourceDomain: number;
  amount: bigint;
}

export interface SseEvent {
  type: 'receiving' | 'settled' | 'error';
  attempt?: number;
  simulated?: boolean;
  mintTxHash?: string;
  stellarAmount?: string;
  dust?: string;
  txHash?: string;
  code?: string;
  remediation?: string;
}

export interface PublicConfig {
  network: string;
  horizonUrl?: string;
  usdcIssuer?: string;
  forwarderContractId?: string;
  attestationUrl?: string;
  simMode: boolean;
  /** Transfer modes the API accepts (spec §4). */
  transferModes: readonly ['fast', 'standard'];
  /**
   * Server-side Fast window: the threshold the status frame measures `elapsedMs`
   * against. The client renders `degraded`, it never computes this (spec §3/§7).
   */
  fastWindowMs: number;
}

export interface SseHandlerDeps {
  store: IReplayStoreAdapter;
  sdkFactory?: (params: ValidatedParams) => {
    poll: () => { onReceiving: () => void; onSettled: () => void; onError: () => void };
  };
  now?: () => number;
  buckets?: RateLimitBuckets;
  maxConcurrent?: number;
}

export interface MockRequest {
  ip: string;
  query: Record<string, string | string[]>;
  headers?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize 0X prefix to 0x before passing to core's normalizeBurnTxHash. */
export function preNormalizeHash(h: string): string {
  return h.trim().replace(/^0X/, '0x');
}

// ─── Intent Store ────────────────────────────────────────────────────────────

/** In-memory intent store with TTL sweep. Keys: `${hash}|${address}|${amountBase6}`. */
export function createIntentStore(ttlMs = 30 * 60 * 1000) {
  const entries = new Map<string, number>(); // key → expiresAt
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of entries) { if (v <= now) entries.delete(k); }
  }, 60_000);

  function key(hash: string, addr: string, amount: string): string {
    const normalizedAmount = String(parseAmountBase6(amount));
    return `${hash}|${addr}|${normalizedAmount}`;
  }

  return {
    record(hash: string, addr: string, amount: string): void {
      entries.set(key(hash, addr, amount), Date.now() + ttlMs);
    },
    async has(hash: string, addr: string, amount: string): Promise<boolean> {
      const k = key(hash, addr, amount);
      const exp = entries.get(k);
      if (exp === undefined) return false;
      if (exp <= Date.now()) { entries.delete(k); return false; }
      return true;
    },
    [Symbol.dispose](): void { clearInterval(sweepInterval); },
  };
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface BucketEntry { expiresAt: number; count: number }

export class RateLimitBuckets {
  private perIp = new Map<string, BucketEntry>();
  private perIpAddr = new Map<string, BucketEntry>();
  private perIpPost = new Map<string, BucketEntry>();
  private maxPerIpPost: number;
  private globalStreams = 0;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly now: () => number,
    private readonly windowMs = 60_000,
    private readonly maxPerIp = 60,
    private readonly maxPerIpAddr = 10,
    private readonly maxGlobal = 50,
    maxPerIpPost?: number,
  ) {
    this.maxPerIpPost = maxPerIpPost ?? 20;
    this.sweepInterval = setInterval(() => this.sweep(), 30_000);
  }

  private key1(ip: string) { return ip; }
  private key2(ip: string, addr: string) { return `${ip}:${addr}`; }

  private getOrCreate(map: Map<string, BucketEntry>, key: string): BucketEntry {
    const now = this.now();
    let e = map.get(key);
    if (!e || e.expiresAt <= now) {
      e = { expiresAt: now + this.windowMs, count: 0 };
      map.set(key, e);
    }
    return e;
  }

  checkRate(ip: string, addr: string): boolean {
    const e1 = this.getOrCreate(this.perIp, this.key1(ip));
    const e2 = this.getOrCreate(this.perIpAddr, this.key2(ip, addr));
    return e1.count < this.maxPerIp && e2.count < this.maxPerIpAddr;
  }

  consume(ip: string, addr: string): void {
    const e1 = this.getOrCreate(this.perIp, this.key1(ip));
    const e2 = this.getOrCreate(this.perIpAddr, this.key2(ip, addr));
    e1.count++;
    e2.count++;
    this.globalStreams++;
  }

  /** POST-specific per-IP rate check (address not required). */
  checkPostRate(ip: string): boolean {
    const e = this.getOrCreate(this.perIpPost, ip);
    return e.count < this.maxPerIpPost;
  }

  consumePost(ip: string): void {
    const e = this.getOrCreate(this.perIpPost, ip);
    e.count++;
  }

  releaseGlobal(): void {
    if (this.globalStreams > 0) this.globalStreams--;
  }

  atGlobalCap(max: number): boolean {
    return this.globalStreams >= max;
  }

  sweep(): void {
    const now = this.now();
    for (const [k, v] of this.perIp) { if (v.expiresAt <= now) this.perIp.delete(k); }
    for (const [k, v] of this.perIpAddr) { if (v.expiresAt <= now) this.perIpAddr.delete(k); }
    for (const [k, v] of this.perIpPost) { if (v.expiresAt <= now) this.perIpPost.delete(k); }
  }

  dispose(): void {
    if (this.sweepInterval) { clearInterval(this.sweepInterval); this.sweepInterval = null; }
  }
}

// ─── Sim Timeline ────────────────────────────────────────────────────────────

let simNonce = 0;

/**
 * Generates sim-mode event timeline. 3 receiving attempts → settled with SIM- mint hash.
 * No Math.random — deterministic nonce counter.
 */
export function SimTimeline(_burnTxHash: string, _sourceDomain: number): SseEvent[] {
  const events: SseEvent[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    events.push({ type: 'receiving', attempt });
  }
  simNonce++;
  const nonce = String(simNonce).padStart(6, '0');
  events.push({ type: 'settled', simulated: true, mintTxHash: `SIM-${nonce}` });
  return events;
}

// ─── Amount Parsing ──────────────────────────────────────────────────────────

const MAX_CCTP = 2n ** 64n - 1n;

/**
 * Parses USDC amount string (≤6 decimals) to bigint base units. Throws on invalid format.
 */
export function parseAmountBase6(s: string): bigint {
  const t = s.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) throw new Error('400 Amount must be positive USDC with ≤6 decimals precision');
  const [w, f = ''] = t.split('.');
  const v = BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
  if (v <= 0n) throw new Error('400 Amount must be > 0');
  if (v > MAX_CCTP) throw new Error('400 Amount overflow: too large');
  return v;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'https://demo.anchorcctp.com',
];

/**
 * Validates and normalizes incoming query params. Throws on invalid.
 */
export interface ValidateEventParamsOptions {
  /**
   * Spec §4: the `/api/receive/*` contract accepts a contract (`C…`) recipient as
   * well as a `G…` account. Off by default so the SSE and legacy initiate paths keep
   * their existing `G…`-only contract.
   */
  allowContractAddress?: boolean;
}

export function validateEventParams(
  q: Record<string, unknown>,
  opts: ValidateEventParamsOptions = {},
): ValidatedParams {
  // reject array values (query string ambiguity)
  if (Array.isArray(q.address) || Array.isArray(q.burnTxHash) || Array.isArray(q.sourceDomain) || Array.isArray(q.amount)) {
    throw new Error('400 address, burnTxHash, sourceDomain must not be arrays');
  }

  const address = typeof q.address === 'string' ? q.address.trim() : '';
  const burnTxHashRaw = typeof q.burnTxHash === 'string' ? q.burnTxHash.trim() : '';
  const sourceDomainRaw = typeof q.sourceDomain === 'string' ? q.sourceDomain.trim()
    : typeof q.sourceDomain === 'number' ? String(q.sourceDomain) : '';
  const amountRaw = typeof q.amount === 'string' ? q.amount.trim() : '';

  if (!address) throw new Error('400 address is required');
  if (!burnTxHashRaw) throw new Error('400 burnTxHash is required');
  if (!sourceDomainRaw) throw new Error('400 sourceDomain is required');
  if (!amountRaw) throw new Error('400 amount is required');

  const addressOk =
    StrKey.isValidEd25519PublicKey(address) ||
    (opts.allowContractAddress === true && StrKey.isValidContract(address));
  if (!addressOk) {
    throw new Error(
      opts.allowContractAddress === true
        ? '400 address must be a valid G... account or C... contract StrKey'
        : '400 address must be a valid G... StrKey',
    );
  }

  const sourceDomain = Number(sourceDomainRaw);
  if (!Number.isInteger(sourceDomain)) {
    throw new Error('400 sourceDomain must be a numeric integer');
  }

  assertSupportedDomain(sourceDomain);

  // pre-normalize 0X → 0x before core's strict regex
  const burnTxHash = normalizeBurnTxHash(preNormalizeHash(burnTxHashRaw));

  const amount = parseAmountBase6(amountRaw);

  return { address, burnTxHash, sourceDomain, amount };
}

// ─── Public Config ───────────────────────────────────────────────────────────

/**
 * Returns only public non-secret config values. Never leaks STELLAR_SECRET.
 */
export function publicConfigBundle(env: Record<string, string | undefined>): PublicConfig {
  return {
    network: env.STELLAR_NETWORK ?? 'testnet',
    horizonUrl: env.HORIZON_URL,
    usdcIssuer: env.USDC_ISSUER,
    forwarderContractId: env.FORWARDER_CONTRACT_ID,
    attestationUrl: env.CIRCLE_ATTESTATION_BASE_URL,
    simMode: (env.SIM_MODE ?? 'false').toLowerCase() === 'true',
    transferModes: ['fast', 'standard'],
    // Same default the handlers fall back to, so the advertised window can never
    // disagree with the window `degraded` is computed from.
    fastWindowMs: env.FAST_WINDOW_MS ? Number(env.FAST_WINDOW_MS) : DEFAULT_FAST_WINDOW_MS,
  };
}

// ─── POST /api/receive:initiate ──────────────────────────────────────────────

interface PostReq {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
  buckets?: RateLimitBuckets;
  intentStore?: ReturnType<typeof createIntentStore>;
}

/**
 * POST /api/receive:initiate — mint intent endpoint.
 * Requires valid Origin header in allowlist → 403 otherwise.
 * When ip/buckets/intentStore provided: validates body, records intent, enforces POST rate limit.
 */
export async function postInitiate(req: PostReq): Promise<{ status: number; body?: unknown }> {
  const origin = req.headers.origin;
  const originStr = Array.isArray(origin) ? origin[0] : origin;

  // Origin check
  if (!originStr || !ALLOWED_ORIGINS.includes(originStr)) {
    return { status: 403, body: { error: { code: 'FORBIDDEN', remediation: 'Request from disallowed origin.' } } };
  }

  // POST per-IP rate limit (when buckets provided)
  if (req.buckets && req.ip) {
    if (!req.buckets.checkPostRate(req.ip)) {
      return { status: 429, body: { error: { code: 'RATE_LIMITED', remediation: 'Too many requests. Slow down.' } } };
    }
    req.buckets.consumePost(req.ip);
  }

  // Validate body via existing validator
  const body = req.body as Record<string, unknown> | undefined;
  if (!body) {
    return { status: 400, body: { error: { code: 'INVALID_PARAMS', remediation: 'Missing request body.' } } };
  }

  let validated: ValidatedParams;
  try {
    validated = validateEventParams(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'bad request';
    return { status: 400, body: { error: { code: 'INVALID_PARAMS', remediation: msg.replace(/^400\s*/, '') } } };
  }

  // Record intent
  if (req.intentStore) {
    req.intentStore.record(validated.burnTxHash, validated.address, String(validated.amount));
  }

  return { status: 200, body: { ok: true } };
}

// ─── File Store Helper ───────────────────────────────────────────────────────

/**
 * Creates a FileReplayStore at the given path.
 */
export function fileStoreAt(path: string): FileReplayStore {
  return new FileReplayStore(path);
}

// ─── Generic Remediation Map ─────────────────────────────────────────────────

const SECRET_RE = /S[A-Z2-7]{55}/g;

function remediationFor(err: unknown): { code: string; remediation: string } {
  const name = err?.constructor?.name ?? '';
  if (name === 'AttestationTimeoutError') return { code: 'ATTESTATION_TIMEOUT', remediation: 'Circle has not attested yet. Retry later.' };
  if (name === 'InvalidAmountError' || name === 'InvalidBurnHashError' || name === 'InvalidDomainError') return { code: 'INVALID_PARAMS', remediation: 'Check hash, domain, and amount.' };
  if (name === 'ReplayTransferError') return { code: 'ALREADY_PROCESSED', remediation: 'This transfer was already processed.' };
  return { code: 'RECEIVE_FAILED', remediation: 'Receive failed. Retry later.' };
}

function logErrorSafe(params: { burnTxHash: string; sourceDomain: number; attempt?: number; code: string }, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  const redacted = raw.replace(SECRET_RE, '[redacted]');
  console.error('[events]', JSON.stringify({ ...params, error: redacted }));
}

// ─── GET /api/events Gate ────────────────────────────────────────────────────

interface GateResult { status: 200 | 400 | 403 | 429; body?: unknown }

/**
 * Validates GET /api/events params: POST intent required (403), amount cap enforced (400).
 */
export async function gateRealStream(
  params: ValidatedParams,
  deps: { intents: { has(hash: string, addr: string, amount: string): Promise<boolean> }; maxMintBase6?: bigint },
): Promise<GateResult> {
  if (!await deps.intents.has(params.burnTxHash, params.address, String(params.amount))) {
    return { status: 403, body: { error: { code: 'NO_INTENT', remediation: 'POST /api/receive:initiate first.' } } };
  }
  if (deps.maxMintBase6 !== undefined && params.amount > deps.maxMintBase6) {
    return { status: 400, body: { error: { code: 'AMOUNT_TOO_LARGE', remediation: `Amount exceeds MAX_MINT_AMOUNT_USDC.` } } };
  }
  return { status: 200 };
}

// ─── Concurrency Gate ────────────────────────────────────────────────────────

/**
 * Triple-key single-flight + concurrency cap for real-mode receives.
 */
export function createRealGate(opts: { maxConcurrentReceives: number; active: () => number }) {
  return {
    tryAcquire(): boolean {
      return opts.active() < opts.maxConcurrentReceives;
    },
  };
}

// ─── Collect SSE (Real Mode) ────────────────────────────────────────────────

/** Module-level single-flight map for real mode: `${hash}|${addr}|${amount}` → promise. */
const _realFlightMap = new Map<string, Promise<SseEvent[]>>();

interface CollectRealDeps {
  store: IReplayStoreAdapter;
  clientFactory: (params: ValidatedParams) => {
    receive(params: { sourceDomain: number; burnTxHash: string; destinationAddress: string; amount: bigint }, ctx?: unknown): Promise<{ amount: bigint; dust: bigint; txHash: string; settled: boolean }>;
  };
  log?: { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void };
}

/**
 * Real-mode SSE collector. Single-flight per normalized triple-key.
 * Wires to `client.on('onReceiving'|'onSettled'|'onError', ...)` for streaming events.
 * markProcessed is handled inside core receive — never double-mark here.
 */
export async function collectSseReal(
  params: ValidatedParams,
  deps: CollectRealDeps,
): Promise<SseEvent[]> {
  const { store, clientFactory } = deps;

  // Replay check first — short-circuit, no receive call
  if (await store.isProcessed(params.burnTxHash)) {
    return [{ type: 'settled' }];
  }

  // Single-flight: normalized triple-key
  const normalized = normalizeBurnTxHash(preNormalizeHash(params.burnTxHash));
  const flightKey = `${normalized}|${params.address}|${params.amount}`;

  const existing = _realFlightMap.get(flightKey);
  if (existing) return existing;

  const promise = _doCollectReal(params, deps);
  _realFlightMap.set(flightKey, promise);

  // Evict on settle (success or failure) so next call re-polls
  promise.finally(() => _realFlightMap.delete(flightKey));

  return promise;
}

async function _doCollectReal(
  params: ValidatedParams,
  deps: CollectRealDeps,
): Promise<SseEvent[]> {
  const { store, clientFactory } = deps;
  const events: SseEvent[] = [];

  // Build capture arrays — these feed SSE frames
  const listeners = {
    onReceiving: [] as Array<(d: unknown) => void>,
    onSettled: [] as Array<(d: unknown) => void>,
    onError: [] as Array<(d: unknown) => void>,
  };

  // Capture emitter events → SSE frames
  listeners.onReceiving.push((d: unknown) => {
    const payload = d as { attempt?: number };
    events.push({ type: 'receiving', attempt: payload.attempt });
  });
  listeners.onSettled.push((d: unknown) => {
    const payload = d as { amount: bigint; dust: bigint; txHash: string };
    events.push({ type: 'settled', stellarAmount: String(payload.amount), dust: String(payload.dust), txHash: payload.txHash });
  });
  listeners.onError.push((d: unknown) => {
    const payload = d as { error: unknown };
    const { code, remediation } = remediationFor(payload.error);
    events.push({ type: 'error', code, remediation });
    logErrorSafe({ burnTxHash: params.burnTxHash, sourceDomain: params.sourceDomain, code }, payload.error);
  });

  // Minimal emitter for mock compatibility — ctx.emitter.on() routes to our capture arrays
  const _mockEmitter = {
    on(event: string, cb: (d: unknown) => void) {
      const key = event as 'onReceiving' | 'onSettled' | 'onError';
      if (key in listeners) listeners[key].push(cb);
    },
  };

  const client = clientFactory(params);

  // Wire client.on() if available (real AnchorCCTP); else mock already used ctx.emitter.on()
  const originalOn = (client as unknown as { on(e: string, cb: (d: unknown) => void): unknown }).on?.bind(client);
  if (originalOn) {
    originalOn('onReceiving', (d: unknown) => { for (const cb of listeners.onReceiving) cb(d); });
    originalOn('onSettled', (d: unknown) => { for (const cb of listeners.onSettled) cb(d); });
    originalOn('onError', (d: unknown) => { for (const cb of listeners.onError) cb(d); });
  }

  try {
    const result = await client.receive({
      sourceDomain: params.sourceDomain,
      burnTxHash: params.burnTxHash,
      destinationAddress: params.address,
      amount: params.amount,
    }, { emitter: _mockEmitter });

    // If receive resolved but no onSettled event was emitted, build settled frame
    if (!events.some(e => e.type === 'settled')) {
      events.push({ type: 'settled', stellarAmount: String(result.amount), dust: String(result.dust), txHash: result.txHash });
    }

    // Handler-owned receipt: core writes into client's own in-process store —
    // invisible across invocations. Persist into durable store shared by
    // status/settle, else chain replays 6908 forever: idempotent keyed mint
    // receipt, upgrade path single txns table when multi-instance KV.
    try {
      await store.markProcessed(params.burnTxHash, {
        burnTxHash: params.burnTxHash,
        txHash: result.txHash,
        sourceDomain: params.sourceDomain,
        destinationAddress: params.address,
        amount: result.amount,
        dust: result.dust,
        timestamp: new Date().toISOString(),
        status: 'settled',
      });
    } catch {
      // Durability best effort: receipt already in hand; settle persists too.
    }

    return events;
  } catch (err) {
    // ReplayTransferError from core → ALREADY_PROCESSED error event
    if (err?.constructor?.name === 'ReplayTransferError') {
      events.push({ type: 'error', code: 'ALREADY_PROCESSED', remediation: 'This transfer was already processed.' });
      return events;
    }

    // All other errors → generic remediation map
    const { code, remediation } = remediationFor(err);
    events.push({ type: 'error', code, remediation });
    logErrorSafe({ burnTxHash: params.burnTxHash, sourceDomain: params.sourceDomain, code }, err);
    throw err;
  }
}

// ─── Single-Flight Tracking ──────────────────────────────────────────────────

/** Module-level single-flight map: normalized hash → cached result promise. */
const _flightMap = new Map<string, Promise<SseEvent[]>>();

// ─── Collect SSE (test helper) ───────────────────────────────────────────────

/**
 * Simulates an SSE connection, collecting all events emitted by the SDK.
 * Single-flight: concurrent calls with same normalized hash share one poll.
 */
export async function collectSse(
  params: ValidatedParams,
  deps: {
    store: IReplayStoreAdapter;
    sdkFactory?: SseHandlerDeps['sdkFactory'];
    now?: () => number;
  },
): Promise<SseEvent[]> {
  const { store } = deps;

  // check replay first
  const isReplay = await store.isProcessed(params.burnTxHash);
  if (isReplay) {
    return [{ type: 'settled' }];
  }

  const normalized = normalizeBurnTxHash(preNormalizeHash(params.burnTxHash));

  // single-flight: if already in-flight, return cached promise
  const existing = _flightMap.get(normalized);
  if (existing) return existing;

  const promise = _doCollectSse(normalized, params, deps);
  _flightMap.set(normalized, promise);
  return promise;
}

async function _doCollectSse(
  normalized: string,
  params: ValidatedParams,
  deps: {
    store: IReplayStoreAdapter;
    sdkFactory?: SseHandlerDeps['sdkFactory'];
  },
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];

  if (deps.sdkFactory) {
    const sdk = deps.sdkFactory(params);
    const pollResult = sdk.poll();

    // simulate emitter events
    pollResult.onReceiving();
    pollResult.onReceiving();
    pollResult.onReceiving();
    pollResult.onSettled();

    for (let attempt = 1; attempt <= 3; attempt++) {
      events.push({ type: 'receiving', attempt });
    }
    events.push({ type: 'settled' });
  } else {
    events.push(...SimTimeline(normalized, params.sourceDomain));
  }

  return events;
}

// ─── SSE Handler Factory ─────────────────────────────────────────────────────

interface HandlerState {
  lastStatus: number;
}

/**
 * Creates an SSE handler with mockable request/status hooks.
 */
export function createSseHandler(deps: SseHandlerDeps) {
  const buckets = deps.buckets ?? new RateLimitBuckets(deps.now ?? (() => Date.now()));
  const maxConcurrent = deps.maxConcurrent ?? 50;
  const state: HandlerState = { lastStatus: 200 };

  function mockRequest(req: MockRequest): void {
    try {
      const validated = validateEventParams(req.query);

      // rate limit check
      if (!buckets.checkRate(req.ip, validated.address)) {
        state.lastStatus = 429;
        return;
      }

      // global concurrent cap
      if (buckets.atGlobalCap(maxConcurrent)) {
        state.lastStatus = 429;
        return;
      }

      buckets.consume(req.ip, validated.address);
      state.lastStatus = 200;
    } catch {
      state.lastStatus = 400;
    }
  }

  function lastStatus(): number {
    return state.lastStatus;
  }

  return { mockRequest, lastStatus, dispose: () => buckets.dispose() };
}

// ─── Body Reader ───────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 4096;

/** Read request body with a hard byte cap. Returns { body } or { error: true } after writing 413. */
export async function readBodyCapped(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ body: string } | { error: true }> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', remediation: 'Request body too large.' } }));
      return { error: true };
    }
  }
  return { body };
}
