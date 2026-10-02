import { describe, it, expect } from 'vitest';
import {
  reduceDeposit,
  initialDeposit,
  parseUsdcBase6,
  buildEventsUrl,
  assertAddressUnchanged,
  simErrorEvent,
  extractLiveAddress,
  postReceiveIntent,
  sseErrorMessage,
  isQuoteFresh,
  isPollingStep,
  isTerminalStep,
  nextPollDelay,
  quotedFeeBase6,
  quoteFeeOverMax,
  QUOTE_MAX_AGE_MS,
  POLL_BASE_MS,
  POLL_BACKOFF_MS,
  POLL_BACKOFF_AFTER_MS,
  type DepositState,
  type DepositStep,
  type FeeQuote,
  type StatusFrame,
  type TransferMode,
} from './depositMachine.js';

const G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const HASH = '0x' + 'ab'.repeat(32);
const PAST_TWO_MINUTES = POLL_BACKOFF_AFTER_MS + 1_000;

describe('parseUsdcBase6', () => {
  it('parses 100.00 to 100000000n', () => {
    expect(parseUsdcBase6('100.00')).toBe(100000000n);
  });
  it('rejects 7-decimal precision', () => {
    expect(() => parseUsdcBase6('100.0000001')).toThrow(/precision/i);
  });
  it('rejects negative and empty', () => {
    expect(() => parseUsdcBase6('-1')).toThrow();
    expect(() => parseUsdcBase6('')).toThrow();
  });
  it('rejects zero, whitespace-only, overflow', () => {
    expect(() => parseUsdcBase6('0')).toThrow();
    expect(() => parseUsdcBase6('   ')).toThrow();
    expect(parseUsdcBase6(' 100.00 ')).toBe(100000000n);
    expect(() => parseUsdcBase6('18446744073709551616')).toThrow(/overflow|too large/i);
  });
});

describe('reduceDeposit', () => {
  it('advances attempt counter on receiving events', () => {
    let s = initialDeposit;
    s = reduceDeposit(s, { type: 'receiving', attempt: 2 });
    expect(s.step).toBe('attesting');
    expect(s.attempts).toBe(2);
  });
  it('settles with simulated flag', () => {
    const s = reduceDeposit(initialDeposit, { type: 'settled', simulated: true, txHash: 'SIM-0001', stellarAmount: '100.0000000', dust: '0' });
    expect(s.step).toBe('settled');
    expect(s.receipt?.simulated).toBe(true);
    expect(s.receipt?.txHash).toMatch(/^SIM-/);
  });
  it('builds encoded EventSource URL', () => {
    const u = buildEventsUrl({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0 });
    expect(u).toBe('/api/events?address=' + encodeURIComponent(G) + '&burnTxHash=' + encodeURIComponent('0x' + 'ab'.repeat(32)) + '&sourceDomain=0');
  });
  it('aborts on address drift', () => {
    const drifted = 'G' + 'A'.repeat(55);
    expect(() => assertAddressUnchanged(G, drifted)).toThrow(/Network mismatch/i);
  });
  it('extracts address from getAddress object shape', () => {
    expect(extractLiveAddress({ address: G })).toBe(G);
    expect(extractLiveAddress(G)).toBe(G);
    expect(extractLiveAddress({ address: '' })).toBeNull();
    expect(extractLiveAddress(null)).toBeNull();
  });
});

describe('simErrorEvent', () => {
  it('returns null for none', () => {
    expect(simErrorEvent('none')).toBeNull();
  });
  it('maps rejected-signing to actionable error event', () => {
    const e = simErrorEvent('rejected-signing');
    expect(e).toEqual({ type: 'error', message: expect.stringMatching(/signing rejected/i) });
  });
  it('maps insufficient-xlm to actionable error event', () => {
    const e = simErrorEvent('insufficient-xlm');
    expect(e).toEqual({ type: 'error', message: expect.stringMatching(/insufficient xlm/i) });
  });
  it('insufficient-xlm defaults to testnet friendbot guidance', () => {
    const e = simErrorEvent('insufficient-xlm');
    expect((e as { message: string }).message).toMatch(/friendbot/i);
  });
  it('insufficient-xlm on mainnet never mentions friendbot', () => {
    const e = simErrorEvent('insufficient-xlm', 'mainnet');
    expect((e as { message: string }).message).toMatch(/insufficient xlm/i);
    expect((e as { message: string }).message.toLowerCase()).not.toContain('friendbot');
    expect((e as { message: string }).message).toMatch(/fund.*xlm/i);
  });
  it('maps network-mismatch to actionable error event', () => {
    const e = simErrorEvent('network-mismatch');
    expect(e).toEqual({ type: 'error', message: expect.stringMatching(/network mismatch/i) });
  });
  it('returns null for unknown values', () => {
    expect(simErrorEvent('bogus')).toBeNull();
  });
});

describe('real settled', () => {
  it('settles without simulated flag and keeps server amounts', () => {
    const s = reduceDeposit(initialDeposit, { type: 'settled', simulated: false, txHash: 'CA3D...REAL', stellarAmount: '1.0000000', dust: '0' });
    expect(s.step).toBe('settled');
    expect(s.receipt?.simulated).not.toBe(true);
    expect(s.receipt?.stellarAmount).toBe('1.0000000');
  });
  it('builds EventSource URL with amount', () => {
    const u = buildEventsUrl({ address: G, burnTxHash: '0x' + 'ab'.repeat(32), sourceDomain: 0, amount: '100.00' });
    expect(u).toContain('amount=' + encodeURIComponent('100.00'));
  });
  it('postReceiveIntent throws server remediation on 403', async () => {
    const fetcher = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN', remediation: 'Stream not authorized.' } }) });
    await expect(postReceiveIntent(fetcher as never, { burnTxHash: '0x1', address: G, amount: '1.00', sourceDomain: 0 })).rejects.toThrow(/not authorized/i);
  });
  it('postReceiveIntent resolves on 200', async () => {
    const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await expect(postReceiveIntent(fetcher as never, { burnTxHash: '0x1', address: G, amount: '1.00', sourceDomain: 0 })).resolves.toBeUndefined();
  });
});

describe('sseErrorMessage', () => {
  it('prefers remediation over message', () => {
    expect(sseErrorMessage({ type: 'error', code: 'X', remediation: 'Fix this.', message: 'ignored' })).toBe('Fix this.');
  });
  it('falls back to message when no remediation', () => {
    expect(sseErrorMessage({ type: 'error', message: 'Something broke' })).toBe('Something broke');
  });
  it('returns Unknown error when neither present', () => {
    expect(sseErrorMessage({ type: 'error', code: 'X' })).toBe('Unknown error');
  });
});

// ─── Spec §7: fast-wait / degraded / cancel ──────────────────────────────────

function quote(mode: TransferMode, over: Partial<FeeQuote> = {}): FeeQuote {
  return {
    minimumFee: '1.3',
    finalityThreshold: mode === 'fast' ? 1000 : 2000,
    fastTierAvailable: true,
    cachedAt: '2026-09-25T00:00:00.000Z',
    mode,
    fetchedAt: 1_000_000,
    ...over,
  };
}

function frame(over: Partial<StatusFrame> = {}): StatusFrame {
  return { status: 'attesting', attempt: 1, elapsedMs: 3_000, degraded: false, attestationReady: false, ...over };
}

/** A transfer that has been initiated in fast mode: step fast-wait. */
function fastWait(): DepositState {
  return reduceDeposit(
    { ...initialDeposit, amount: '100.00', mode: 'fast' },
    { type: 'burn-submitted', burnTxHash: HASH, mode: 'fast' },
  );
}

function standardWait(): DepositState {
  return reduceDeposit(
    { ...initialDeposit, amount: '100.00', mode: 'standard' },
    { type: 'burn-submitted', burnTxHash: HASH, mode: 'standard' },
  );
}

describe('fast-wait / degraded / cancel (§7)', () => {
  it('burn-submitted enters fast-wait for fast and attesting for standard', () => {
    expect(fastWait().step).toBe('fast-wait');
    expect(standardWait().step).toBe('attesting');
    expect(fastWait().burnTxHash).toBe(HASH);
  });

  it('fast-wait → degraded-standard on fast-window-expired', () => {
    const s = reduceDeposit(fastWait(), { type: 'fast-window-expired' });
    expect(s.step).toBe('degraded-standard');
    expect(s.burnTxHash).toBe(HASH);
    expect(isPollingStep(s.step)).toBe(true);
  });

  it('fast-window-expired leaves a standard wait and terminal states alone', () => {
    expect(reduceDeposit(standardWait(), { type: 'fast-window-expired' }).step).toBe('attesting');
    const settled = reduceDeposit(initialDeposit, {
      type: 'settled', simulated: false, txHash: 'MINT1', stellarAmount: '9998700000', dust: '0',
    });
    expect(reduceDeposit(settled, { type: 'fast-window-expired' }).step).toBe('settled');
  });

  it('degrades on the status frame Iris signal before any window expiry', () => {
    const s = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ finalityThresholdExecuted: 2000, elapsedMs: 3_000 }),
    });
    expect(s.step).toBe('degraded-standard');
  });

  it('degrades on delayReason insufficient_fee', () => {
    const s = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ delayReason: 'insufficient_fee' }),
    });
    expect(s.step).toBe('degraded-standard');
  });

  it('falls back to the frame degraded flag (elapsed-window signal)', () => {
    expect(reduceDeposit(fastWait(), { type: 'status', frame: frame({ degraded: true }) }).step).toBe('degraded-standard');
  });

  it('keeps a fast transfer waiting while Iris still reports the fast tier', () => {
    const s = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ finalityThresholdExecuted: 1000, delayReason: 'none' }),
    });
    expect(s.step).toBe('fast-wait');
  });

  it('never sends a standard-mode transfer down the fast degrade path', () => {
    const s = reduceDeposit(standardWait(), {
      type: 'status',
      frame: frame({ finalityThresholdExecuted: 2000, degraded: true }),
    });
    expect(s.step).toBe('attesting');
  });

  it('counts polls locally and ignores the status frame attempt (R12)', () => {
    let s = fastWait();
    s = reduceDeposit(s, { type: 'status', frame: frame({ attempt: 7 }) });
    s = reduceDeposit(s, { type: 'status', frame: frame({ attempt: 7 }) });
    expect(s.attempts).toBe(2);
  });

  it('settle-ready moves a fast-wait transfer to settling', () => {
    expect(reduceDeposit(fastWait(), { type: 'settle-ready' }).step).toBe('settling');
  });

  it('settle-ready moves a degraded-standard transfer to settling', () => {
    // Really reach `degraded-standard` first: the Iris signal degrades without waiting
    // out the window, so this exercises the degraded edge, not a standard wait.
    const degraded = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ finalityThresholdExecuted: 2000 }),
    });
    expect(degraded.step).toBe('degraded-standard');
    expect(degraded.burnTxHash).toBe(HASH);
    expect(reduceDeposit(degraded, { type: 'settle-ready' }).step).toBe('settling');
  });

  it('a settled status frame lands in settled with the receipt', () => {
    const s = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ status: 'settled', attestationReady: true, receipt: { stellarAmount: '9998700000', mintTxHash: 'MINT1' } }),
    });
    expect(s.step).toBe('settled');
    expect(s.receipt?.txHash).toBe('MINT1');
    expect(s.receipt?.stellarAmount).toBe('9998700000');
    expect(s.receipt?.simulated).toBe(false);
  });

  it('a failed status frame lands in error with the remediation', () => {
    const s = reduceDeposit(fastWait(), {
      type: 'status',
      frame: frame({ status: 'failed', error: { code: 'MINT_FAILED', remediation: 'Mint failed. Retry the settle.' } }),
    });
    expect(s.step).toBe('error');
    expect(s.errorDetails).toMatch(/retry the settle/i);
  });

  it('cancel from any live state stops polling and preserves the burn hash', () => {
    const live: DepositStep[] = ['quoting', 'burning', 'fast-wait', 'degraded-standard', 'attesting'];
    for (const step of live) {
      const s = reduceDeposit({ ...initialDeposit, step, burnTxHash: HASH, mode: 'fast' }, { type: 'cancel' });
      expect(s.step).toBe('cancelled');
      expect(s.burnTxHash).toBe(HASH);
      expect(isPollingStep(s.step)).toBe(false);
      expect(isTerminalStep(s.step)).toBe(true);
    }
  });

  it('cancel is a no-op once settled or errored', () => {
    const settled = reduceDeposit(initialDeposit, {
      type: 'settled', simulated: false, txHash: 'MINT1', stellarAmount: '1', dust: '0',
    });
    expect(reduceDeposit(settled, { type: 'cancel' }).step).toBe('settled');
    const errored = reduceDeposit(fastWait(), { type: 'error', message: 'boom' });
    expect(reduceDeposit(errored, { type: 'cancel' }).step).toBe('error');
  });

  it('retry-standard resumes a cancelled transfer into the Standard wait', () => {
    const cancelled = reduceDeposit(fastWait(), { type: 'cancel' });
    const retried = reduceDeposit(cancelled, { type: 'retry-standard' });
    expect(retried.step).toBe('attesting');
    expect(retried.burnTxHash).toBe(HASH);
    expect(retried.attempts).toBe(0);
    expect(isPollingStep(retried.step)).toBe(true);
  });

  it('retry-standard is a no-op outside cancelled', () => {
    expect(reduceDeposit(fastWait(), { type: 'retry-standard' }).step).toBe('fast-wait');
  });
});

describe('quote panel (§7)', () => {
  it('execute with a fresh fast quote moves to burning', () => {
    const s = reduceDeposit(
      { ...initialDeposit, amount: '100.00', mode: 'fast', quote: quote('fast') },
      { type: 'execute', nowMs: 1_000_000 },
    );
    expect(s.step).toBe('burning');
  });

  it('a quote older than 5 minutes at Execute forces a re-quote, never a silent degrade', () => {
    const base = { ...initialDeposit, amount: '100.00', mode: 'fast' as TransferMode, quote: quote('fast') };
    expect(reduceDeposit(base, { type: 'execute', nowMs: 1_000_000 + QUOTE_MAX_AGE_MS + 1 }).step).toBe('quoting');
    expect(reduceDeposit(base, { type: 'execute', nowMs: 1_000_000 + QUOTE_MAX_AGE_MS }).step).toBe('burning');
  });

  it('a quote fetched for the other mode is stale regardless of age', () => {
    expect(isQuoteFresh(quote('standard'), 'fast', 1_000_000)).toBe(false);
    expect(isQuoteFresh(quote('fast', { fetchedAt: 0 }), 'fast', QUOTE_MAX_AGE_MS + 1)).toBe(false);
    expect(isQuoteFresh(undefined, 'fast', 0)).toBe(false);
  });

  it('execute with no quote re-quotes in fast mode and proceeds in standard mode', () => {
    expect(reduceDeposit({ ...initialDeposit, amount: '100.00', mode: 'fast' }, { type: 'execute', nowMs: 0 }).step).toBe('quoting');
    expect(reduceDeposit({ ...initialDeposit, amount: '100.00', mode: 'standard' }, { type: 'execute', nowMs: 0 }).step).toBe('burning');
  });

  it('quote-received completes a re-quote into burning and stores the quote', () => {
    let s = reduceDeposit({ ...initialDeposit, amount: '100.00', mode: 'fast' }, { type: 'execute', nowMs: 0 });
    expect(s.step).toBe('quoting');
    s = reduceDeposit(s, { type: 'quote-received', quote: quote('fast', { fetchedAt: 5 }) });
    expect(s.step).toBe('burning');
    expect(s.quote?.minimumFee).toBe('1.3');
    expect(s.mode).toBe('fast');
  });

  it('a fresh quote above the user max keeps the panel instead of degrading silently', () => {
    const s = reduceDeposit(
      { ...initialDeposit, amount: '100.00', mode: 'fast', maxFee: '0.01', quote: quote('fast', { minimumFee: '10' }) },
      { type: 'execute', nowMs: 1_000_000 },
    );
    expect(s.step).toBe('quoting');
  });

  it('quotedFeeBase6 turns basis points into base-6 USDC for the amount', () => {
    expect(quotedFeeBase6('100.00', '1.3')).toBe(13_000n);
    expect(quotedFeeBase6('100.00', '0')).toBe(0n);
    expect(quotedFeeBase6('100.00', 'nonsense')).toBeNull();
    expect(quotedFeeBase6('not-an-amount', '1')).toBeNull();
  });

  it('quoteFeeOverMax warns only when a cap is set and the quote exceeds it', () => {
    const over = { amount: '100.00', maxFee: '0.01', quote: quote('fast', { minimumFee: '10' }) };
    expect(quoteFeeOverMax(over)).toBe(true);
    expect(quoteFeeOverMax({ ...over, maxFee: '1' })).toBe(false);
    expect(quoteFeeOverMax({ ...over, maxFee: undefined })).toBe(false);
    expect(quoteFeeOverMax({ ...over, maxFee: '' })).toBe(false);
    expect(quoteFeeOverMax({ amount: '100.00', maxFee: '0.01', quote: undefined })).toBe(false);
  });

  it('mode-change updates the selected mode only before the burn', () => {
    expect(reduceDeposit({ ...initialDeposit }, { type: 'mode-change', mode: 'standard' }).mode).toBe('standard');
    expect(reduceDeposit(fastWait(), { type: 'mode-change', mode: 'standard' }).mode).toBe('fast');
  });
});

describe('poller (§7)', () => {
  it('polls at 5s with ±20% jitter', () => {
    expect(nextPollDelay(0, () => 0.5)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(0, () => 0)).toBe(POLL_BASE_MS - 1_000);
    expect(nextPollDelay(0, () => 1)).toBe(POLL_BASE_MS + 1_000);
  });

  it('backs off to 15s after 2 minutes', () => {
    expect(nextPollDelay(POLL_BACKOFF_AFTER_MS - 1, () => 0.5)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(POLL_BACKOFF_AFTER_MS, () => 0.5)).toBe(POLL_BACKOFF_MS);
    expect(nextPollDelay(PAST_TWO_MINUTES, () => 0)).toBe(POLL_BACKOFF_MS - 3_000);
  });

  it('never returns a non-positive delay', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      expect(nextPollDelay(0, () => r)).toBeGreaterThan(0);
      expect(nextPollDelay(PAST_TWO_MINUTES, () => r)).toBeGreaterThan(0);
    }
  });

  it('polls only while waiting — terminal steps stop it', () => {
    for (const step of ['fast-wait', 'degraded-standard', 'attesting'] as DepositStep[]) {
      expect(isPollingStep(step)).toBe(true);
    }
    for (const step of ['idle', 'quoting', 'burning', 'settling', 'settled', 'cancelled', 'error'] as DepositStep[]) {
      expect(isPollingStep(step)).toBe(false);
    }
    for (const step of ['settled', 'cancelled', 'error'] as DepositStep[]) {
      expect(isTerminalStep(step)).toBe(true);
    }
    for (const step of ['idle', 'quoting', 'burning', 'fast-wait', 'degraded-standard', 'settling', 'attesting'] as DepositStep[]) {
      expect(isTerminalStep(step)).toBe(false);
    }
  });
});
