import { MAX_CCTP_AMOUNT } from '@anchor-cctp/core-sdk';

/** CCTP transfer mode. Fast = `minFinalityThreshold` 1000, Standard = 2000. */
export type TransferMode = 'fast' | 'standard';

/**
 * Spec §7 steps. `attesting` is the Standard-timeline wait: the initial Standard
 * mode, and the post-cancel resume — both wait for the Standard attestation.
 */
export type DepositStep =
  | 'idle'
  | 'quoting'
  | 'burning'
  | 'fast-wait'
  | 'degraded-standard'
  | 'settling'
  | 'settled'
  | 'cancelled'
  | 'error'
  | 'attesting';

/** A `GET /api/fees` quote (spec §4) plus the client clock reading it arrived at. */
export interface FeeQuote {
  /** Circle's basis-point ratio for the tier — a ratio (e.g. "1.3"), never an amount. */
  minimumFee: string;
  finalityThreshold: number;
  fastTierAvailable: boolean;
  cachedAt: string;
  mode: TransferMode;
  /** Client clock at receipt. The 5-minute rule measures from here. */
  fetchedAt: number;
}

/** The `GET /api/receive/status` frame (spec §4) the client polls. */
export interface StatusFrame {
  status: 'attesting' | 'ready' | 'settled' | 'failed';
  /**
   * Iris fetches the *server* made this invocation (0 or 1) — not a poll counter.
   * The UI's "attempt N" is the client's own count (controller ruling R12).
   */
  attempt: number;
  elapsedMs: number;
  degraded: boolean;
  finalityThresholdExecuted?: number;
  delayReason?: string;
  attestationReady: boolean;
  receipt?: { stellarAmount: string; mintTxHash: string };
  error?: { code?: string; remediation?: string };
}

export interface DepositState {
  step: DepositStep;
  /** The client's own poll count — never the status frame's `attempt` (R12). */
  attempts: number;
  /** The mode this transfer is bound to (intent mode once burned). */
  mode: TransferMode;
  /** Human USDC amount being transferred. */
  amount?: string;
  /** User's fee cap, base-6 USDC string. Absent = no cap. */
  maxFee?: string;
  quote?: FeeQuote;
  /** Preserved through `cancelled` so the retry button can resume the same burn. */
  burnTxHash?: string;
  receipt?: {
    stellarAmount: string;
    dust: string;
    txHash: string;
    simulated: boolean;
  };
  errorDetails?: string;
}

export const initialDeposit: DepositState = { step: 'idle', attempts: 0, mode: 'fast' };

/** Spec §7: a quote older than this at Execute must re-quote, never degrade silently. */
export const QUOTE_MAX_AGE_MS = 5 * 60 * 1000;
/** Spec §7 poller: 5s while Fast is plausible… */
export const POLL_BASE_MS = 5_000;
/** …backing off to 15s once the transfer is past the 2-minute mark. */
export const POLL_BACKOFF_MS = 15_000;
export const POLL_BACKOFF_AFTER_MS = 120_000;
/** ±20% jitter so N clients do not poll in lockstep. */
const POLL_JITTER_RATIO = 0.2;

const POLLING_STEPS: readonly DepositStep[] = ['fast-wait', 'degraded-standard', 'attesting'];
const TERMINAL_STEPS: readonly DepositStep[] = ['settled', 'cancelled', 'error'];
/** Steps in which the mode toggle still means something (before the burn binds it). */
const PRE_BURN_STEPS: readonly DepositStep[] = ['idle', 'quoting', 'error'];

/** Parse human USDC string (≤6 decimals) to bigint base-6 units. */
export function parseUsdcBase6(raw: string): bigint {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Amount must be positive USDC with ≤6 decimals');
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error('Amount must be positive USDC with ≤6 decimals precision');
  const [whole, frac = ''] = trimmed.split('.');
  const padded = frac.padEnd(6, '0');
  const val = BigInt(whole) * 1_000_000n + BigInt(padded);
  if (val <= 0n) throw new Error('Amount must be positive USDC with ≤6 decimals');
  if (val > MAX_CCTP_AMOUNT) throw new Error('Amount overflows u64 (too large)');
  return val;
}

export type DepositEvent =
  // Legacy SSE frames (kept for the deprecated local stream; spec §11.3).
  | { type: 'receiving'; attempt: number }
  | { type: 'submitting' }
  | { type: 'settled'; simulated: boolean; txHash: string; stellarAmount: string; dust?: string }
  | { type: 'error'; message: string }
  // Spec §7 fast-transfer flow.
  | { type: 'mode-change'; mode: TransferMode }
  | { type: 'amount'; amount: string }
  | { type: 'max-fee'; maxFee: string }
  | { type: 'quote-received'; quote: FeeQuote }
  | { type: 'execute'; nowMs?: number }
  | { type: 'burn-submitted'; burnTxHash: string; mode: TransferMode }
  | { type: 'status'; frame: StatusFrame }
  | { type: 'fast-window-expired' }
  | { type: 'settle-ready' }
  | { type: 'cancel' }
  | { type: 'retry-standard' };

export function isPollingStep(step: DepositStep): boolean {
  return POLLING_STEPS.includes(step);
}

export function isTerminalStep(step: DepositStep): boolean {
  return TERMINAL_STEPS.includes(step);
}

/** Land the receipt. `dust` is optional on the wire (spec §4). */
function settleFrom(state: DepositState, event: Extract<DepositEvent, { type: 'settled' }>): DepositState {
  return {
    ...state,
    step: 'settled',
    receipt: {
      stellarAmount: event.stellarAmount,
      // Spec §4 drops `dust` from the receipt — absent means zero, never undefined in the UI.
      dust: event.dust ?? '0',
      txHash: event.txHash,
      simulated: event.simulated,
    },
  };
}

/**
 * Spec §7: degrade is driven by the status frame's Iris fields **first** — they
 * arrive within seconds, so "continuing as Standard" must not wait out the window.
 */
function irisSaysDegraded(frame: StatusFrame): boolean {
  return frame.finalityThresholdExecuted === 2000 || frame.delayReason === 'insufficient_fee';
}

/** Fast is no longer on offer: move to the Standard timeline (sticky once degraded). */
function degrade(state: DepositState): DepositState {
  if (state.mode !== 'fast') return state;
  if (state.step !== 'fast-wait') return state;
  return { ...state, step: 'degraded-standard' };
}

export function reduceDeposit(state: DepositState, event: DepositEvent): DepositState {
  switch (event.type) {
    case 'receiving':
      return { ...state, step: 'attesting', attempts: event.attempt };
    case 'submitting':
      return { ...state, step: 'settling' };
    case 'settled':
      return settleFrom(state, event);
    case 'error':
      return { ...state, step: 'error', errorDetails: event.message };

    case 'mode-change':
      // The intent binds the mode at first write (server: first-claimer wins), so the
      // toggle is only meaningful before the burn.
      return PRE_BURN_STEPS.includes(state.step) ? { ...state, mode: event.mode } : state;
    case 'amount':
      return PRE_BURN_STEPS.includes(state.step) ? { ...state, amount: event.amount } : state;
    case 'max-fee':
      return PRE_BURN_STEPS.includes(state.step)
        ? { ...state, maxFee: event.maxFee.trim() === '' ? undefined : event.maxFee.trim() }
        : state;

    case 'quote-received': {
      // A quote only counts for the mode it was fetched for.
      const next: DepositState = { ...state, quote: event.quote, mode: event.quote.mode };
      // Arrived while Execute was waiting on it: proceed, unless it still busts the cap —
      // proceeding would degrade to Standard with nothing shown to the user.
      if (state.step !== 'quoting') return next;
      return quoteFeeOverMax(next) ? next : { ...next, step: 'burning' };
    }

    case 'execute': {
      const nowMs = event.nowMs ?? Date.now();
      // Standard needs no fee tier, so a fee outage must never block it (spec §4 FEE_UNAVAILABLE).
      if (state.mode === 'standard') return { ...state, step: 'burning' };
      if (!isQuoteFresh(state.quote, state.mode, nowMs) || quoteFeeOverMax(state)) {
        return { ...state, step: 'quoting' };
      }
      return { ...state, step: 'burning' };
    }

    case 'burn-submitted':
      return {
        ...state,
        step: event.mode === 'fast' ? 'fast-wait' : 'attesting',
        mode: event.mode,
        burnTxHash: event.burnTxHash,
        attempts: 0,
        errorDetails: undefined,
      };

    case 'status': {
      if (!isPollingStep(state.step)) return state;
      const { frame } = event;
      if (frame.status === 'settled' && frame.receipt) {
        return settleFrom(state, {
          type: 'settled',
          simulated: false,
          txHash: frame.receipt.mintTxHash,
          stellarAmount: frame.receipt.stellarAmount,
          dust: '0',
        });
      }
      if (frame.status === 'failed') {
        return {
          ...state,
          step: 'error',
          errorDetails: frame.error?.remediation ?? frame.error?.code ?? 'Transfer failed',
        };
      }
      const polled: DepositState = { ...state, attempts: state.attempts + 1 };
      // `degrade` is a no-op unless this is a fast-mode transfer still inside the window.
      return frame.degraded || irisSaysDegraded(frame) ? degrade(polled) : polled;
    }

    case 'fast-window-expired':
      // The elapsed-window fallback: the server-owned window has passed without `ready`.
      return degrade(state);

    case 'settle-ready':
      return isPollingStep(state.step) ? { ...state, step: 'settling' } : state;

    case 'cancel': {
      // Cancel stops the wait only — the intent persists, so the burn hash stays
      // claimable (spec §7/§8). Terminal states are absorbing.
      if (isTerminalStep(state.step) || state.step === 'idle') return state;
      return { ...state, step: 'cancelled' };
    }

    case 'retry-standard': {
      if (state.step !== 'cancelled' || !state.burnTxHash) return state;
      // Resume the SAME intent: `(hash|address|amount)` is bound at first write, so a
      // re-initiate could not flip the mode anyway. The Standard timeline is a UI label
      // here; the settle call keeps the mode the intent was recorded with.
      return { ...state, step: 'attesting', attempts: 0 };
    }

    default:
      return state;
  }
}

/**
 * Spec §7: a quote is usable at Execute only if it is for the selected mode and
 * younger than 5 minutes.
 */
export function isQuoteFresh(quote: FeeQuote | undefined, mode: TransferMode, nowMs: number): boolean {
  if (!quote || quote.mode !== mode) return false;
  const age = nowMs - quote.fetchedAt;
  return age >= 0 && age <= QUOTE_MAX_AGE_MS;
}

/** Parse a decimal string ("1.3") to a 6-decimal scaled bigint, or null. No floats. */
function scale6(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}

/**
 * Circle's `minimumFee` is basis points (a ratio). Returns the fee it implies for
 * `amount` (human USDC, ≤6 decimals) in base-6 units, or null when either input is
 * unparseable — a warning must never be derived from a guess.
 */
export function quotedFeeBase6(amount: string, minimumFee: string): bigint | null {
  const bps = scale6(minimumFee);
  if (bps === null) return null;
  let amountBase6: bigint;
  try {
    amountBase6 = parseUsdcBase6(amount);
  } catch {
    return null;
  }
  return (amountBase6 * bps) / (10_000n * 1_000_000n);
}

/** Spec §7: warn when the quoted fee exceeds the user's max fee input. */
export function quoteFeeOverMax(
  state: Pick<DepositState, 'amount' | 'maxFee' | 'quote'>,
): boolean {
  const { amount, maxFee, quote } = state;
  if (!amount || !maxFee || !quote) return false;
  const fee = quotedFeeBase6(amount, quote.minimumFee);
  if (fee === null) return false;
  let cap: bigint;
  try {
    cap = parseUsdcBase6(maxFee);
  } catch {
    return false;
  }
  return fee > cap;
}

/**
 * Next poll delay: 5s with ±20% jitter, backing off to 15s once the transfer is
 * past 2 minutes. `random` is injectable so the schedule is deterministic in tests;
 * the default is jitter-free.
 */
export function nextPollDelay(elapsedMs: number, random: () => number = () => 0.5): number {
  const base = elapsedMs >= POLL_BACKOFF_AFTER_MS ? POLL_BACKOFF_MS : POLL_BASE_MS;
  const swing = Math.round(base * POLL_JITTER_RATIO);
  return base + Math.round((random() * 2 - 1) * swing);
}

export function buildEventsUrl(params: {
  address: string;
  burnTxHash: string;
  sourceDomain: number;
  amount?: string;
}): string {
  let u =
    '/api/events?address=' +
    encodeURIComponent(params.address) +
    '&burnTxHash=' +
    encodeURIComponent(params.burnTxHash) +
    '&sourceDomain=' +
    encodeURIComponent(String(params.sourceDomain));
  if (params.amount !== undefined) {
    u += '&amount=' + encodeURIComponent(params.amount);
  }
  return u;
}

export async function postReceiveIntent(
  fetcher: typeof fetch,
  params: { burnTxHash: string; address: string; amount: string; sourceDomain: number },
): Promise<void> {
  const res = await fetcher('/api/receive:initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as any)?.error?.remediation ?? `Server returned ${res.status}`;
    throw new Error(msg);
  }
}

export function assertAddressUnchanged(connected: string, live: string): void {
  if (connected.trim() !== live.trim()) {
    throw new Error('Network mismatch: wallet address changed');
  }
}

/** Normalize freighter-api getAddress() result ({address} object or legacy string) to address or null. */
export function extractLiveAddress(result: unknown): string | null {
  if (typeof result === 'string') return result || null;
  if (result && typeof result === 'object' && typeof (result as { address?: unknown }).address === 'string') {
    return ((result as { address: string }).address) || null;
  }
  return null;
}

/** Extract error message from SSE error event data. Server sends {type:'error', code, remediation}. */
export function sseErrorMessage(data: Record<string, unknown>): string {
  if (typeof data.remediation === 'string') return data.remediation;
  if (typeof data.message === 'string') return data.message;
  return 'Unknown error';
}

/** Map a simError select value to a synthetic DepositEvent, or null for 'none'. */
export function simErrorEvent(
  value: string,
  network: 'testnet' | 'mainnet' = 'testnet',
): DepositEvent | null {
  switch (value) {
    case 'rejected-signing':
      return { type: 'error', message: 'Freighter signing rejected — unlock wallet and approve the transaction' };
    case 'insufficient-xlm':
      // Mainnet has no friendbot — never point prod users at testnet funding.
      return network === 'mainnet'
        ? { type: 'error', message: 'Insufficient XLM balance — fund with XLM via exchange withdrawal' }
        : { type: 'error', message: 'Insufficient XLM balance — fund with testnet friendbot: https://friendbot.stellar.org' };
    case 'network-mismatch':
      return { type: 'error', message: 'Network mismatch — switch Freighter wallet to the correct network and retry' };
    default:
      return null;
  }
}
