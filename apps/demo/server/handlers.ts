// apps/demo/server/handlers.ts
// Framework-free receive handlers (spec §4): plain (input, deps) → { status, body }.
// Both the local Node server (serve.ts / serve.cjs) and the Vercel wrappers (Task 9)
// call these; neither the request nor the response object leaks in here.
// ponytail: server-only module — never bundled for browser.

import { StrKey } from '@stellar/stellar-sdk';
import {
  assertSupportedDomain,
  fetchTransferFee,
  normalizeBurnTxHash,
  AttestationTimeoutError,
  FeeUnavailableError,
  InvalidAddressError,
  InvalidAmountError,
  InvalidBurnHashError,
  InvalidDomainError,
  MintFailedError,
  MintUnconfirmedError,
  ReplayTransferError,
} from '@anchor-cctp/core-sdk';
import type {
  IReplayStoreAdapter,
  ReceiveParams,
  ReceiveResult,
  SettlementRecord,
  SorobanTransport,
  TransferFee,
} from '@anchor-cctp/core-sdk';
import { parseAmountBase6, preNormalizeHash, validateEventParams } from './events.js';
import type {
  BucketStore,
  FeeCache,
  FeeCacheEntry,
  IntentStore,
  LockStore,
  StoredIntent,
} from './kv.js';
import { DEFAULT_FAST_WINDOW_MS, FEE_CACHE_TTL_MS, SETTLE_LOCK_TTL_MS } from './kv.js';

// ─── Public constants ────────────────────────────────────────────────────────

/** One Iris fetch per status call, hard-capped — a status poll must never hang a function. */
export const IRIS_TIMEOUT_MS = 10_000;

/** Host origins the deployment-specific CSP allows connections to (spec §6/§9). */
export interface CspOptions {
  /** Deployed API origin (Vercel) — the browser posts initiate/settle straight to it. */
  apiOrigin?: string;
  /** Circle Iris base URL (attestation + fee quotes). */
  irisBaseUrl?: string;
  horizonUrl?: string;
  sorobanRpcUrl?: string;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The single CSP definition, consumed by the handlers and by `serve.ts` — one place to
 * drift, not two. `connect-src` is extended to exactly the origins this deployment
 * talks to (deployed API origin + Iris + Horizon/RPC); `https://*.stellar.org` stays
 * for the wallet kit. Callers pass their own env-derived URLs; the no-argument form is
 * the local/dev default.
 */
export function buildCsp(opts: CspOptions = {}): string {
  const connect = new Set(["'self'", 'https://*.stellar.org']);
  for (const url of [opts.apiOrigin, opts.irisBaseUrl, opts.horizonUrl, opts.sorobanRpcUrl]) {
    const origin = originOf(url);
    if (origin) connect.add(origin);
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${[...connect].join(' ')}`,
  ].join('; ');
}

export const CSP = buildCsp();
export const NO_STORE = 'no-store, no-cache, must-revalidate';

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Cache-Control': NO_STORE,
  'X-Content-Type-Options': 'nosniff',
};

/** Origin allowlist for the browser XHR path (intent binding is the real auth). */
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'https://demo.anchorcctp.com',
];

/**
 * Only EVM domain 6 (Base) is reachable from the demo. Solana's domain 5 passes the
 * core registry but base58 signatures break the 0x-hex burn-hash contract, so the
 * allow-list lives at the edge.
 */
export const EVM_SOURCE_DOMAIN = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiInput {
  ip?: string;
  origin?: string;
  [key: string]: unknown;
}

export interface HandlerResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface SettleTransport {
  sponsorAccount: string;
  rpc: SorobanTransport;
  readSequence: () => Promise<string>;
  /** Deployment passphrase — threaded so a mainnet adapter never builds testnet XDR. */
  networkPassphrase?: string;
}

export interface HandlerDeps {
  intents: IntentStore;
  replay: IReplayStoreAdapter;
  locks: LockStore;
  buckets: BucketStore;
  feeCache: FeeCache;
  cctp: { receive(params: ReceiveParams, ctx?: unknown): Promise<ReceiveResult> };
  /** Server clock. `elapsedMs`/`degraded` derive from this, never from a client value. */
  now?: () => number;
  /** Iris base URL. Absent ⇒ no cross-network default: status stays attesting, fees 503. */
  attestationBaseUrl?: string;
  fetch?: typeof fetch;
  newIntentId?: () => string;
  maxMintBase6?: bigint;
  allowedOrigins?: string[];
  fastWindowMs?: number;
  /** Sponsor + Soroban transport + live sequence reader for the mint. */
  settleTransport?: SettleTransport;
}

interface AttestationProbe {
  /**
   * Iris requests actually issued by this invocation (0 = skipped). Not a poll
   * counter — the status frame's `attempt` mirrors this, and the UI's "attempt N"
   * count belongs to the client (spec §7/Task 10).
   */
  attempt: number;
  attestationReady: boolean;
  finalityThresholdExecuted?: number;
  delayReason?: string | null;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const SECRET_RE = /S[A-Z2-7]{55}/g;

/** No secret ever reaches a client body or a log line. Shared with serverless.ts. */
export function redact(raw: string): string {
  return raw.replace(SECRET_RE, '[redacted]').slice(0, 300);
}

function nowMs(deps: HandlerDeps): number {
  return deps.now ? deps.now() : Date.now();
}

/**
 * Client IP for rate buckets. Only Vercel's trusted `x-real-ip` is honoured —
 * `x-forwarded-for` is client-appendable and would let a caller pick bucket keys.
 */
export function trustedClientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback = 'unknown',
): string {
  const real = headers['x-real-ip'];
  const value = Array.isArray(real) ? real[0] : real;
  return value && value.length > 0 ? value : fallback;
}

function ok(status: number, body: unknown): HandlerResult {
  return { status, body, headers: SECURITY_HEADERS };
}

function fail(status: number, code: string, remediation: string, cause?: unknown): HandlerResult {
  const detail =
    cause === undefined ? undefined : redact(cause instanceof Error ? cause.message : String(cause));
  return {
    status,
    body: { error: { code, remediation, ...(detail ? { detail } : {}) } },
    headers: SECURITY_HEADERS,
  };
}

/** Maps a validator throw (`'400 <remediation>'`) to a 400 INVALID_PARAMS. */
function invalidParams(err: unknown): HandlerResult {
  if (err instanceof InvalidDomainError) {
    return fail(400, 'INVALID_PARAMS', `sourceDomain ${err.domainId} is not supported.`);
  }
  const raw = err instanceof Error ? err.message : 'bad request';
  return fail(400, 'INVALID_PARAMS', redact(raw.replace(/^400\s*/, '')));
}

function receiptOf(record: SettlementRecord): { stellarAmount: string; mintTxHash: string } {
  return { stellarAmount: String(record.amount ?? 0n), mintTxHash: record.txHash };
}

/**
 * Intent IDs are lookup keys, not secrets — but a guessable one would let a third
 * party settle a pending burn, so they come from the CSPRNG (this repo's security
 * tripwire forbids the weak float PRNG anywhere in the server path).
 */
function defaultIntentId(): string {
  return `int_${globalThis.crypto.randomUUID()}`;
}

interface StatusParams {
  address: string;
  burnTxHash: string;
  amount: bigint;
}

/**
 * Status query validation: `burnTxHash` + `address` + `amount` only. `sourceDomain`
 * is deliberately NOT a param — it is read from the KV intent so a caller cannot
 * steer the Iris lookup or probe arbitrary domains.
 */
function validateStatusParams(input: ApiInput): StatusParams {
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  const hashRaw = typeof input.burnTxHash === 'string' ? input.burnTxHash.trim() : '';
  const amountRaw = typeof input.amount === 'string' ? input.amount.trim() : '';

  if (!address) throw new Error('400 address is required');
  if (!hashRaw) throw new Error('400 burnTxHash is required');
  if (!amountRaw) throw new Error('400 amount is required');
  // Spec §4: the receive contract takes a `G…` account or a `C…` contract recipient.
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
    throw new Error('400 address must be a valid G... account or C... contract StrKey');
  }

  return {
    address,
    burnTxHash: normalizeBurnTxHash(preNormalizeHash(hashRaw)),
    amount: parseAmountBase6(amountRaw),
  };
}

// ─── Iris probe (single fetch, never mints) ──────────────────────────────────

/**
 * One Iris v2 message read for a burn. The base URL is server-side config — a
 * caller can never steer the host, and the domain comes from the KV intent.
 */
async function probeAttestation(
  deps: HandlerDeps,
  sourceDomain: number,
  burnTxHash: string,
): Promise<AttestationProbe> {
  const base = (deps.attestationBaseUrl ?? '').replace(/\/+$/, '');
  const doFetch = deps.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!base || !doFetch) return { attempt: 0, attestationReady: false };

  const url = `${base}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTxHash)}`;
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(IRIS_TIMEOUT_MS),
    });
    if (!res.ok) return { attempt: 1, attestationReady: false };
    const data = (await res.json()) as {
      messages?: Array<{
        status?: string;
        attestation?: string;
        decodedMessage?: {
          finalityThresholdExecuted?: number | string | null;
          delayReason?: string | null;
        };
      }>;
    };
    const message = data?.messages?.[0];
    if (!message) return { attempt: 1, attestationReady: false };
    const executed = message.decodedMessage?.finalityThresholdExecuted;
    const attestation = message.attestation;
    return {
      attempt: 1,
      attestationReady:
        message.status === 'complete' &&
        typeof attestation === 'string' &&
        attestation.length > 2 &&
        attestation !== 'PENDING',
      ...(executed === undefined || executed === null
        ? {}
        : { finalityThresholdExecuted: Number(executed) }),
      delayReason: message.decodedMessage?.delayReason ?? null,
    };
  } catch {
    // Timeout/down/protocol error: report "still attesting" — never mint on a guess.
    return { attempt: 1, attestationReady: false };
  }
}

// ─── POST /api/receive/initiate ──────────────────────────────────────────────

/**
 * Records a mint intent: hash bound to address + amount + mode (first write wins),
 * TTL 24h. Origin is checked only when an allowlist is configured (the browser path
 * — spoofable via curl, which is why the intent binding is the real authorization).
 */
export async function handleInitiate(input: ApiInput, deps: HandlerDeps): Promise<HandlerResult> {
  const ip = input.ip ?? 'unknown';
  if (!(await deps.buckets.consumeIp('initiate', ip))) {
    return fail(429, 'RATE_LIMITED', 'Too many initiate requests. Slow down.');
  }

  if (deps.allowedOrigins) {
    const origin = typeof input.origin === 'string' ? input.origin : '';
    if (!deps.allowedOrigins.includes(origin)) {
      return fail(403, 'FORBIDDEN', 'Request from disallowed origin.');
    }
  }

  let params;
  try {
    params = validateEventParams(input, { allowContractAddress: true });
  } catch (e) {
    return invalidParams(e);
  }

  if (params.sourceDomain !== EVM_SOURCE_DOMAIN) {
    return fail(400, 'INVALID_PARAMS', `sourceDomain must be ${EVM_SOURCE_DOMAIN} (Base).`);
  }

  const mode = input.transferMode;
  if (mode !== 'fast' && mode !== 'standard') {
    return fail(400, 'INVALID_PARAMS', 'transferMode must be "fast" or "standard".');
  }

  let maxFee: string | undefined;
  if (input.maxFee !== undefined && input.maxFee !== null && input.maxFee !== '') {
    let fee: bigint;
    try {
      fee = parseAmountBase6(String(input.maxFee));
    } catch (e) {
      return invalidParams(e);
    }
    if (fee > params.amount) {
      return fail(400, 'INVALID_PARAMS', 'maxFee must be less than or equal to amount.');
    }
    maxFee = String(fee);
  }

  const intent: StoredIntent = {
    intentId: deps.newIntentId ? deps.newIntentId() : defaultIntentId(),
    burnTxHash: params.burnTxHash,
    address: params.address,
    amount: String(params.amount),
    sourceDomain: params.sourceDomain,
    transferMode: mode,
    ...(maxFee === undefined ? {} : { maxFee }),
    createdAt: nowMs(deps),
  };
  // First-claimer wins (spec §9): `put` returns the already-bound intent when this
  // `(hash|address|amount)` tuple was claimed before, so a second initiate cannot
  // re-point the binding or reset `createdAt`.
  const stored = await deps.intents.put(intent);

  return ok(200, { ok: true, intentId: stored.intentId });
}

// ─── GET /api/receive/status ─────────────────────────────────────────────────

/**
 * Read-only status: replay lookup + **one** Iris read. It never mints — the mint
 * side effect lives exclusively behind `handleSettle`.
 */
export async function handleStatus(input: ApiInput, deps: HandlerDeps): Promise<HandlerResult> {
  const ip = input.ip ?? 'unknown';
  if (!(await deps.buckets.consumeIp('status', ip))) {
    return fail(429, 'RATE_LIMITED', 'Too many status requests. Slow down.');
  }

  let params;
  try {
    params = validateStatusParams(input);
  } catch (e) {
    return invalidParams(e);
  }

  // Permanent replay record first: a settled transfer stays answerable after the
  // 24h intent TTL drops the intent out of KV.
  const record = await deps.replay.getRecord(params.burnTxHash);
  if (record?.status === 'settled') {
    return ok(200, {
      status: 'settled',
      attempt: 0,
      elapsedMs: 0,
      degraded: false,
      attestationReady: true,
      receipt: receiptOf(record),
    });
  }

  const intent = await deps.intents.find(params.burnTxHash, params.address, String(params.amount));
  if (!intent) {
    return fail(403, 'NO_INTENT', 'POST /api/receive/initiate first.');
  }

  const elapsedMs = Math.max(0, nowMs(deps) - intent.createdAt);
  const fastWindowMs = deps.fastWindowMs ?? DEFAULT_FAST_WINDOW_MS;
  const probe = await probeAttestation(deps, intent.sourceDomain, params.burnTxHash);

  const executed = probe.finalityThresholdExecuted;
  const delayReason = probe.delayReason ?? null;
  const degraded =
    intent.transferMode === 'fast' &&
    (elapsedMs > fastWindowMs || executed === 2000 || delayReason === 'insufficient_fee');

  return ok(200, {
    status: probe.attestationReady ? 'ready' : 'attesting',
    // NOT a cumulative poll counter: this is the number of Iris fetches *this
    // invocation* made (0 or 1). Status is read-only — §4 forbids a KV poll counter,
    // and the client already counts its own polls, so §7's "attempt N" is the
    // client's number (Task 10 renders it). Kept in the frame for shape stability.
    attempt: probe.attempt,
    elapsedMs,
    degraded,
    ...(executed === undefined ? {} : { finalityThresholdExecuted: executed }),
    ...(delayReason === null ? {} : { delayReason }),
    attestationReady: probe.attestationReady,
  });
}

// ─── POST /api/receive/settle ────────────────────────────────────────────────

/**
 * Runs the mint for a previously recorded intent: bucket → replay → intent binding
 * (byte-for-byte) → server-side domain + cap re-check → single-flight lock → Iris
 * pre-flight → `receive()` (simulate → assemble → sign → send → confirm). The
 * permanent `settled` record is written by core **only** after a confirmed mint.
 */
export async function handleSettle(input: ApiInput, deps: HandlerDeps): Promise<HandlerResult> {
  const ip = input.ip ?? 'unknown';

  let params;
  try {
    params = validateEventParams(input, { allowContractAddress: true });
  } catch (e) {
    return invalidParams(e);
  }

  if (params.sourceDomain !== EVM_SOURCE_DOMAIN) {
    return fail(400, 'INVALID_PARAMS', `sourceDomain must be ${EVM_SOURCE_DOMAIN} (Base).`);
  }
  const mode = input.transferMode;
  if (mode !== 'fast' && mode !== 'standard') {
    return fail(400, 'INVALID_PARAMS', 'transferMode must be "fast" or "standard".');
  }
  const intentId = typeof input.intentId === 'string' ? input.intentId.trim() : '';
  if (!intentId) {
    return fail(400, 'INVALID_PARAMS', 'intentId is required.');
  }

  // Strict settle bucket (per IP + address) BEFORE any signing — sponsor-drain guard.
  if (!(await deps.buckets.consumeSubject('settle', ip, params.address))) {
    return fail(429, 'RATE_LIMITED', 'Too many settle attempts for this transfer. Slow down.');
  }

  // Permanent replay record: an intent expiring must never re-enable a mint, and a
  // double-submit returns the original receipt instead of minting again.
  const existing = await deps.replay.getRecord(params.burnTxHash);
  if (existing?.status === 'settled') {
    return ok(200, {
      code: 'ALREADY_PROCESSED',
      remediation: 'This transfer was already settled.',
      receipt: receiptOf(existing),
    });
  }
  if (existing) {
    // Broadcast but never confirmed. The transaction can still land *after* the
    // confirmation window closes — that is how a transfer which settled ends up
    // recorded as a failure, with `status` answering `ready` forever and the receipt
    // never written. `settleFailure` persisted this hash precisely so a later attempt
    // could reconcile against it; until now nothing asked the chain.
    const reconciled = await reconcileSubmitted(deps, existing);
    if (reconciled) return ok(200, { receipt: reconciled });
    return fail(
      502,
      'MINT_UNCONFIRMED',
      `A mint (${existing.txHash}) for this burn was broadcast but not confirmed. Check it on a Stellar explorer before retrying.`,
    );
  }

  // Intent binding is the real authorization (Origin headers are curl-spoofable).
  const intent = await deps.intents.get(intentId, params.burnTxHash);
  if (!intent) {
    return fail(403, 'NO_INTENT', 'POST /api/receive/initiate first.');
  }
  if (
    intent.address !== params.address ||
    intent.amount !== String(params.amount) ||
    intent.transferMode !== mode
  ) {
    return fail(403, 'ADDRESS_MISMATCH', 'Intent does not match this address, amount, and mode.');
  }

  // Re-run the domain allow-list and the cap server-side — never trust the client.
  try {
    assertSupportedDomain(intent.sourceDomain);
  } catch (e) {
    return invalidParams(e);
  }
  if (intent.sourceDomain !== EVM_SOURCE_DOMAIN) {
    return fail(400, 'INVALID_PARAMS', `sourceDomain must be ${EVM_SOURCE_DOMAIN} (Base).`);
  }
  if (deps.maxMintBase6 !== undefined && BigInt(intent.amount) > deps.maxMintBase6) {
    return fail(400, 'AMOUNT_TOO_LARGE', 'Amount exceeds MAX_MINT_AMOUNT_USDC.');
  }

  // Distributed single-flight: a crashed invocation's lock expires in 60s.
  const lockKey = `settle:${params.burnTxHash}`;
  const token = await deps.locks.acquire(lockKey, SETTLE_LOCK_TTL_MS);
  if (!token) {
    return fail(429, 'RATE_LIMITED', 'A settle is already in flight for this transfer.');
  }

  try {
    // Attestation pre-flight: one read. Not complete ⇒ NOT_READY without spending
    // the sponsor on a simulate/sign cycle; the client keeps polling.
    if (deps.attestationBaseUrl) {
      const probe = await probeAttestation(deps, intent.sourceDomain, params.burnTxHash);
      if (probe.attempt > 0 && !probe.attestationReady) {
        return fail(409, 'NOT_READY', 'Circle has not attested this burn yet. Keep polling status.');
      }
    }

    const transport = deps.settleTransport;
    const sourceSequence = transport ? await transport.readSequence() : undefined;

    let result: ReceiveResult;
    try {
      result = await deps.cctp.receive({
        sourceDomain: intent.sourceDomain,
        burnTxHash: params.burnTxHash,
        destinationAddress: intent.address,
        amount: BigInt(intent.amount),
        ...(transport
          ? {
              sponsorAccount: transport.sponsorAccount,
              rpc: transport.rpc,
              ...(sourceSequence === undefined ? {} : { sourceSequence }),
              ...(transport.networkPassphrase === undefined
                ? {}
                : { networkPassphrase: transport.networkPassphrase }),
            }
          : {}),
      } as ReceiveParams);
    } catch (e) {
      return await settleFailure(e, params.burnTxHash, deps, intent);
    }

    // The durable replay store belongs to the handler: core writes its own record into
    // the client's in-process store, which the next serverless invocation cannot see.
    // Persist the confirmed receipt here — the only place a `settled` record may be
    // written — so a double-submit returns the original instead of minting again.
    await persistSettled(deps, {
      burnTxHash: params.burnTxHash,
      txHash: result.txHash,
      amount: result.amount,
      dust: result.dust,
      sourceDomain: intent.sourceDomain,
      destinationAddress: intent.address,
    });

    return ok(200, {
      receipt: { stellarAmount: String(result.amount), mintTxHash: result.txHash },
    });
  } finally {
    await deps.locks.release(lockKey, token);
  }
}

/**
 * Writes the permanent `settled` receipt. Called only after a confirmed mint — a
 * failed or unconfirmed settle must never look settled on the next attempt.
 */
async function persistSettled(
  deps: HandlerDeps,
  record: {
    burnTxHash: string;
    txHash: string;
    amount: bigint;
    /** Absent when reconciling: a broadcast record carries no sweep figure. */
    dust?: bigint;
    sourceDomain?: number;
    destinationAddress?: string;
  },
): Promise<void> {
  await deps.replay.markProcessed(record.burnTxHash, {
    burnTxHash: record.burnTxHash,
    txHash: record.txHash,
    amount: record.amount,
    ...(record.dust === undefined ? {} : { dust: record.dust }),
    ...(record.sourceDomain === undefined ? {} : { sourceDomain: record.sourceDomain }),
    ...(record.destinationAddress === undefined ? {} : { destinationAddress: record.destinationAddress }),
    timestamp: new Date(nowMs(deps)).toISOString(),
    status: 'settled',
  });
}

/**
 * Resolves a `submitted` replay record against the chain.
 *
 * `submitMint` polls for a bounded window and reports `MINT_UNCONFIRMED` on exhaustion —
 * but "unconfirmed" is not "failed". A mint that lands after that window closes leaves a
 * transfer which settled recorded as a failure: no receipt written, and `status`
 * answering `ready` indefinitely. This asks the chain about the hash that was recorded,
 * and closes the record out when the mint did in fact succeed.
 *
 * Returns the receipt when the recorded hash is a confirmed mint, and `null` when it is
 * not — including when the chain is unreachable, because an unreachable chain is not
 * evidence that the mint failed.
 */
async function reconcileSubmitted(
  deps: HandlerDeps,
  existing: SettlementRecord,
): Promise<{ stellarAmount: string; mintTxHash: string } | null> {
  const rpc = deps.settleTransport?.rpc;
  if (!rpc || !existing.txHash) return null;

  let status: string;
  try {
    ({ status } = await rpc.getTransaction(existing.txHash));
  } catch {
    return null;
  }
  if (status !== 'SUCCESS') return null;

  await persistSettled(deps, {
    burnTxHash: existing.burnTxHash,
    txHash: existing.txHash,
    amount: existing.amount ?? 0n,
    ...(existing.dust === undefined ? {} : { dust: existing.dust }),
    ...(existing.sourceDomain === undefined ? {} : { sourceDomain: existing.sourceDomain }),
    ...(existing.destinationAddress === undefined ? {} : { destinationAddress: existing.destinationAddress }),
  });

  return { stellarAmount: String(existing.amount ?? 0n), mintTxHash: existing.txHash };
}

async function settleFailure(
  err: unknown,
  burnTxHash: string,
  deps: HandlerDeps,
  intent?: StoredIntent,
): Promise<HandlerResult> {
  if (err instanceof ReplayTransferError) {
    const record = await deps.replay.getRecord(burnTxHash);
    if (record?.status === 'settled') {
      return ok(200, {
        code: 'ALREADY_PROCESSED',
        remediation: 'This transfer was already settled.',
        receipt: receiptOf(record),
      });
    }
    return fail(409, 'NOT_READY', 'A mint for this burn is already recorded. Keep polling status.');
  }
  if (err instanceof AttestationTimeoutError) {
    return fail(409, 'NOT_READY', 'Circle has not attested this burn yet. Keep polling status.');
  }
  if (err instanceof MintUnconfirmedError) {
    // Persist the broadcast hash as `submitted` (never `settled`): the next attempt
    // reconciles against it instead of broadcasting a second mint.
    await deps.replay.markProcessed(burnTxHash, {
      burnTxHash,
      txHash: err.mintTxHash,
      ...(intent === undefined
        ? {}
        : {
            sourceDomain: intent.sourceDomain,
            destinationAddress: intent.address,
            amount: BigInt(intent.amount),
          }),
      timestamp: new Date(nowMs(deps)).toISOString(),
      status: 'submitted',
    });
    return fail(502, 'MINT_UNCONFIRMED', 'Mint broadcast but not confirmed. Retry to reconcile.');
  }
  if (err instanceof MintFailedError) {
    return fail(502, 'MINT_FAILED', 'Mint failed. Retry later.', err);
  }
  if (
    err instanceof InvalidDomainError ||
    err instanceof InvalidAmountError ||
    err instanceof InvalidBurnHashError ||
    err instanceof InvalidAddressError
  ) {
    return fail(400, 'INVALID_PARAMS', 'Check the burn hash, domain, and amount.', err);
  }
  return fail(502, 'RECEIVE_FAILED', 'Receive failed. Retry later.', err);
}

// ─── GET /api/fees ───────────────────────────────────────────────────────────

function toDomain(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

async function probeTier(
  deps: HandlerDeps,
  baseUrl: string,
  sourceDomain: number,
  destDomain: number,
  mode: 'fast' | 'standard',
): Promise<TransferFee | null> {
  try {
    return await fetchTransferFee(sourceDomain, destDomain, {
      baseUrl,
      mode,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  } catch (e) {
    // A missing tier is a fact about the route, not an error: report availability.
    if (e instanceof FeeUnavailableError) return null;
    throw e;
  }
}

/**
 * `GET /api/fees?sourceDomain=6&destDomain=27&mode=fast|standard`.
 * Both domains validate through `assertSupportedDomain` before the Iris URL is
 * built, the base URL is server-side config, and the route quote is cached 1h.
 * A missing Fast tier reports `fastTierAvailable: false` rather than mislabelling
 * the Standard fee as Fast.
 */
export async function handleFees(input: ApiInput, deps: HandlerDeps): Promise<HandlerResult> {
  const mode = input.mode;
  if (mode !== 'fast' && mode !== 'standard') {
    return fail(400, 'INVALID_PARAMS', 'mode must be "fast" or "standard".');
  }
  const sourceDomain = toDomain(input.sourceDomain);
  const destDomain = toDomain(input.destDomain);
  if (sourceDomain === null || destDomain === null) {
    return fail(400, 'INVALID_PARAMS', 'sourceDomain and destDomain must be integers.');
  }
  try {
    assertSupportedDomain(sourceDomain);
    assertSupportedDomain(destDomain);
  } catch (e) {
    if (e instanceof InvalidDomainError) {
      return fail(400, 'INVALID_DOMAIN', `Domain ${e.domainId} is not a supported CCTP domain.`);
    }
    return invalidParams(e);
  }

  const baseUrl = (deps.attestationBaseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    return fail(503, 'FEE_UNAVAILABLE', 'Fee quotes are unavailable. Retry later or use Standard.');
  }

  const key = `fees:${sourceDomain}:${destDomain}`;
  const now = nowMs(deps);
  let entry: FeeCacheEntry | null = await deps.feeCache.get(key);
  if (!entry || now - entry.cachedAtMs > FEE_CACHE_TTL_MS) {
    const [fast, standard] = await Promise.all([
      probeTier(deps, baseUrl, sourceDomain, destDomain, 'fast'),
      probeTier(deps, baseUrl, sourceDomain, destDomain, 'standard'),
    ]);
    entry = { fast, standard, cachedAtMs: now, cachedAt: new Date(now).toISOString() };
    await deps.feeCache.set(key, entry);
  }

  const fee = mode === 'fast' ? entry.fast : entry.standard;
  if (!fee) {
    return fail(
      503,
      'FEE_UNAVAILABLE',
      `No ${mode} tier available for ${sourceDomain}→${destDomain}.`,
    );
  }

  return ok(200, {
    minimumFee: String(fee.minimumFeeBps),
    finalityThreshold: fee.finalityThreshold,
    fastTierAvailable: entry.fast !== null,
    cachedAt: entry.cachedAt,
  });
}
