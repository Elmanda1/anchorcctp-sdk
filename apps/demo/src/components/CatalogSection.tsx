import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CCTP_DOMAINS } from '@anchor-cctp/core-sdk';
import {
  ArrowRight,
  CheckCircle,
  WarningCircle,
  ArrowsClockwise,
  WifiHigh,
  WifiSlash,
} from '@phosphor-icons/react';
import { WalletState, fetchBalances } from '../wallet/freighter';
import { loadNetworkConfig } from '../config/network';
import {
  DepositState,
  FeeQuote,
  StatusFrame,
  TransferMode,
  initialDeposit,
  reduceDeposit,
  parseUsdcBase6,
  assertAddressUnchanged,
  simErrorEvent,
  extractLiveAddress,
  isPollingStep,
  nextPollDelay,
  quoteFeeOverMax,
} from '../catalog/depositMachine';

/**
 * Chain marks for the domain list, keyed by the domain's `chain` slug.
 *
 * Real brand assets live under /logos. Chains we have no asset for fall back to
 * a colored initial tile — the same shape the existing base.svg already uses —
 * so every row reads as its own chain instead of collapsing onto one shared mark.
 */
const CHAIN_LOGOS: Record<string, string> = {
  ethereum: '/logos/ethereum.svg',
  avalanche: '/logos/avalanche.svg',
  optimism: '/logos/optimism.svg',
  arbitrum: '/logos/arbitrum.svg',
  solana: '/logos/solana.svg',
  base: '/logos/base.svg',
  polygon: '/logos/polygon.svg',
  aptos: '/logos/aptos.png',
  linea: '/logos/linea.png',
  sonic: '/logos/sonic.png',
  monad: '/logos/monad.png',
  sei: '/logos/sei.png',
  bnb: '/logos/bnb.png',
  xdc: '/logos/xdc.png',
  hyperevm: '/logos/hyperevm.png',
  stellar: '/logos/stellar.png',
  cronos: '/logos/cronos.png',
  plasma: '/logos/plasma.png',
};

const CHAIN_MONOGRAMS: Record<string, { color: string; label: string }> = {
  unichain: { color: '#FF007A', label: 'U' },
  codex: { color: '#4F46E5', label: 'C' },
  worldchain: { color: '#4B5563', label: 'W' },
  ink: { color: '#7C3AED', label: 'I' },
  plume: { color: '#EC4899', label: 'P' },
  starknet: { color: '#2563EB', label: 'S' },
  arc: { color: '#0EA5E9', label: 'A' },
  edge: { color: '#10B981', label: 'E' },
  injective: { color: '#0082FA', label: 'I' },
  morph: { color: '#16A34A', label: 'M' },
  pharos: { color: '#F97316', label: 'P' },
  xlayer: { color: '#64748B', label: 'X' },
};

const DomainLogo: React.FC<{ chain: string; name: string; className?: string }> = ({
  chain,
  name,
  className,
}) => {
  const src = CHAIN_LOGOS[chain];
  if (src) return <img src={src} alt={name} className={className} />;

  const mark = CHAIN_MONOGRAMS[chain] ?? { color: '#334155', label: name.charAt(0) };
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={name}>
      <circle cx="16" cy="16" r="16" fill={mark.color} />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize="18"
        fontWeight="bold"
        fill="#fff"
      >
        {mark.label}
      </text>
    </svg>
  );
};

interface CatalogSectionProps {
  wallet: WalletState;
  onConnectWallet: () => void;
}

/** CCTP domain of the Stellar destination (spec §4: the demo always mints to 27). */
const STELLAR_CCTP_DOMAIN = 27;

/**
 * Client-side copy of the fast window. The server owns the real threshold (it
 * computes `degraded` against the intent's `createdAt`) — this only decides when the
 * client's own clock says the window has passed, so a frame that omits `degraded`
 * cannot stall the "continuing as Standard" label.
 */
const FAST_WINDOW_FALLBACK_MS = 90_000;

/** One in-flight transfer: everything the poller and the settle call need. */
interface TransferRun {
  address: string;
  burnTxHash: string;
  amount: string;
  sourceDomain: number;
  /** Mode recorded on the intent at initiate — settle must match it byte-for-byte. */
  mode: TransferMode;
  intentId: string;
  maxFee?: string;
  startedAt: number;
}

export const CatalogSection: React.FC<CatalogSectionProps> = ({
  wallet,
  onConnectWallet,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDomainId, setSelectedDomainId] = useState<number>(0);
  const [burnTxHash, setBurnTxHash] = useState<string>('');
  const [usdcAmount, setUsdcAmount] = useState<string>('100.00');
  const [simError, setSimError] = useState<string>('none');
  /** User's fee cap in USDC — empty means "no cap". */
  const [maxFee, setMaxFee] = useState<string>('');
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Deposit state machine
  const [deposit, setDeposit] = useState<DepositState>(initialDeposit);

  // Balance + network state
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [networkOk, setNetworkOk] = useState<boolean | null>(null);
  const [networkLabel, setNetworkLabel] = useState<string>('');
  /** Raw loader message when the env config is invalid — rendered as an actionable hint. */
  const [networkError, setNetworkError] = useState<string | null>(null);

  /** The transfer the poller is driving. Kept through `cancelled` so retry can resume it. */
  const runRef = useRef<TransferRun | null>(null);
  /** False once the wait is over (cancel/settle/unmount) — stops the next poll from arming. */
  const pollingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Drops quote responses a newer request superseded. */
  const quoteSeqRef = useRef(0);

  const categories = [
    { id: 'all', label: 'All Domains' },
    { id: 'evm', label: 'EVM Chains' },
    { id: 'svm', label: 'Solana (SVM)' },
    { id: 'cosmos', label: 'Cosmos / Noble' },
  ];

  const domainsList = Object.values(CCTP_DOMAINS);
  const filteredDomains = domainsList.filter((d) => {
    // Stellar (27) is always the destination — never a source.
    if (d.domainId === 27) return false;
    if (selectedCategory === 'evm') return d.domainId !== 5;
    if (selectedCategory === 'svm') return d.domainId === 5;
    if (selectedCategory === 'cosmos') return d.domainId === 21;
    return true;
  });

  const activeDomain = CCTP_DOMAINS[selectedDomainId] || CCTP_DOMAINS[0];

  const network = React.useMemo(() => {
    try { return loadNetworkConfig().network; } catch { return 'testnet'; }
  }, []);

  const refreshBalances = async () => {
    if (!wallet.address) return;
    try {
      const balances = await fetchBalances(wallet.address);
      let xlm: string | null = null;
      let usdc: string | null = null;
      for (const b of balances) {
        if (b.asset_type === 'native') {
          xlm = b.balance;
        } else if (
          b.asset_type === 'credit_alphanum12' &&
          'asset_code' in b &&
          (b as { asset_code?: string }).asset_code === 'USDC'
        ) {
          usdc = b.balance;
        }
      }
      setXlmBalance(xlm);
      setUsdcBalance(usdc);
    } catch {
      setXlmBalance(null);
      setUsdcBalance(null);
    }
  };

  const checkNetwork = () => {
    try {
      const config = loadNetworkConfig();
      setNetworkOk(true);
      setNetworkLabel(config.passphrase);
      setNetworkError(null);
    } catch (err) {
      setNetworkOk(false);
      setNetworkLabel('Config error');
      setNetworkError(err instanceof Error ? err.message : 'Unknown config error');
    }
  };

  useEffect(() => {
    if (wallet.connected && wallet.address) {
      refreshBalances();
      checkNetwork();
    } else {
      setXlmBalance(null);
      setUsdcBalance(null);
      setNetworkOk(null);
      setNetworkLabel('');
      setNetworkError(null);
    }
  }, [wallet.connected, wallet.address]);

  // Spec §7: the poller stops on settled/cancelled/error — and on unmount.
  useEffect(() => {
    if (isPollingStep(deposit.step)) return;
    pollingRef.current = false;
    stopPolling();
  }, [deposit.step]);

  useEffect(
    () => () => {
      pollingRef.current = false;
      stopPolling();
      runRef.current = null;
    },
    [],
  );

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  /** Spec §7: 5s with jitter, 15s after 2 minutes — never a fixed `setInterval`,
   *  because the delay changes with jitter and backoff. */
  const scheduleNextPoll = () => {
    stopPolling();
    const run = runRef.current;
    if (!run || !pollingRef.current) return;
    pollTimerRef.current = setTimeout(() => {
      void pollOnce();
    }, nextPollDelay(Date.now() - run.startedAt, Math.random));
  };

  const finishRun = () => {
    pollingRef.current = false;
    stopPolling();
  };

  /**
   * One status read. Terminates the wait on settled/failed; settles when the
   * attestation is ready; otherwise re-arms with the jittered delay.
   */
  const pollOnce = async () => {
    const run = runRef.current;
    if (!run || !pollingRef.current) return;

    let frame: StatusFrame;
    try {
      const query = new URLSearchParams({
        burnTxHash: run.burnTxHash,
        address: run.address,
        amount: run.amount,
      });
      const res = await fetch(`/api/receive/status?${query.toString()}`);
      const body = (await res.json().catch(() => ({}))) as StatusFrame & {
        error?: { remediation?: string };
      };
      if (!res.ok) {
        finishRun();
        setDeposit((s) =>
          reduceDeposit(s, {
            type: 'error',
            message: body?.error?.remediation ?? `Status request failed (${res.status})`,
          }),
        );
        return;
      }
      frame = body;
    } catch {
      finishRun();
      setDeposit((s) => reduceDeposit(s, { type: 'error', message: 'Status request failed — connection lost.' }));
      return;
    }

    if (!pollingRef.current) return; // cancelled while the request was in flight
    setDeposit((s) => reduceDeposit(s, { type: 'status', frame }));

    if (frame.status === 'settled' || frame.status === 'failed') {
      finishRun();
      return;
    }
    // §7: the Iris signal is handled by the frame itself; this is the elapsed-window
    // fallback, so "continuing as Standard" appears even if a frame omits `degraded`.
    if (frame.degraded || Date.now() - run.startedAt > FAST_WINDOW_FALLBACK_MS) {
      setDeposit((s) => reduceDeposit(s, { type: 'fast-window-expired' }));
    }
    if (frame.status === 'ready' || frame.attestationReady) {
      await settleRun(run);
      return;
    }
    scheduleNextPoll();
  };

  /** POST /api/receive/settle — the only call that mints (spec §4). */
  const settleRun = async (run: TransferRun) => {
    setDeposit((s) => reduceDeposit(s, { type: 'settle-ready' }));
    try {
      const res = await fetch('/api/receive/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burnTxHash: run.burnTxHash,
          address: run.address,
          amount: run.amount,
          sourceDomain: run.sourceDomain,
          transferMode: run.mode,
          intentId: run.intentId,
          ...(run.maxFee ? { maxFee: run.maxFee } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        receipt?: { stellarAmount?: string; mintTxHash?: string; dust?: string };
        error?: { code?: string; remediation?: string; detail?: string };
      };
      if (!res.ok) {
        finishRun();
        // `fail()` in handlers.ts carries the upstream cause in `detail`; without it a 502
        // reads as "Receive failed. Retry later." and the real fault stays invisible.
        const why = body?.error?.remediation ?? `Settle failed (${res.status})`;
        const detail = body?.error?.detail;
        setDeposit((s) =>
          reduceDeposit(s, {
            type: 'error',
            message: detail ? `${why} — ${detail}` : why,
          }),
        );
        return;
      }
      finishRun();
      setDeposit((s) =>
        reduceDeposit(s, {
          type: 'settled',
          simulated: false,
          txHash: body.receipt?.mintTxHash ?? 'UNKNOWN',
          stellarAmount: String(body.receipt?.stellarAmount ?? ''),
          ...(body.receipt?.dust === undefined ? {} : { dust: body.receipt.dust }),
        }),
      );
    } catch {
      finishRun();
      setDeposit((s) =>
        reduceDeposit(s, {
          type: 'error',
          message: 'Settle request failed — check the burn on a Stellar explorer before retrying.',
        }),
      );
    }
  };

  /** POST /api/receive/initiate, then start the status poller (spec §4/§7). */
  const startRun = async (mode: TransferMode) => {
    const address = wallet.address;
    if (!address) return;
    try {
      parseUsdcBase6(usdcAmount);

      // Re-fetch the address and assert no drift before recording the intent.
      const { getAddress } = await import('@stellar/freighter-api');
      const liveAddress = extractLiveAddress(await getAddress());
      if (liveAddress) {
        assertAddressUnchanged(address, liveAddress);
      }

      const trimmedMaxFee = maxFee.trim();
      const res = await fetch('/api/receive/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burnTxHash,
          address,
          amount: usdcAmount,
          sourceDomain: activeDomain.domainId,
          transferMode: mode,
          ...(trimmedMaxFee ? { maxFee: trimmedMaxFee } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        intentId?: string;
        error?: { remediation?: string };
      };
      if (!res.ok) {
        throw new Error(body?.error?.remediation ?? `Initiate failed (${res.status})`);
      }

      runRef.current = {
        address,
        burnTxHash,
        amount: usdcAmount,
        sourceDomain: activeDomain.domainId,
        mode,
        intentId: body.intentId ?? '',
        ...(trimmedMaxFee ? { maxFee: trimmedMaxFee } : {}),
        startedAt: Date.now(),
      };
      pollingRef.current = true;
      setDeposit((s) => reduceDeposit(s, { type: 'burn-submitted', burnTxHash, mode }));
      scheduleNextPoll();
    } catch (err) {
      finishRun();
      runRef.current = null;
      setDeposit((s) =>
        reduceDeposit(s, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
    }
  };

  /** Quote the fee for a mode. Stale responses are dropped, not rendered. */
  const refreshQuote = async (mode: TransferMode) => {
    const seq = ++quoteSeqRef.current;
    try {
      const query = new URLSearchParams({
        sourceDomain: String(activeDomain.domainId),
        destDomain: String(STELLAR_CCTP_DOMAIN),
        mode,
      });
      const res = await fetch(`/api/fees?${query.toString()}`);
      const body = (await res.json().catch(() => ({}))) as {
        minimumFee?: string;
        finalityThreshold?: number;
        fastTierAvailable?: boolean;
        cachedAt?: string;
        error?: { remediation?: string };
      };
      if (seq !== quoteSeqRef.current) return;
      if (!res.ok) {
        setQuoteError(body?.error?.remediation ?? `Fee quote unavailable (${res.status}).`);
        return;
      }
      setQuoteError(null);
      const quote: FeeQuote = {
        minimumFee: String(body.minimumFee ?? '0'),
        finalityThreshold: body.finalityThreshold ?? 0,
        fastTierAvailable: body.fastTierAvailable !== false,
        cachedAt: body.cachedAt ?? '',
        mode,
        fetchedAt: Date.now(),
      };
      setDeposit((s) => reduceDeposit(s, { type: 'quote-received', quote }));
    } catch {
      if (seq !== quoteSeqRef.current) return;
      setQuoteError('Fee quote unavailable — retry, or switch to Standard.');
    }
  };

  // The panel's inputs live in the machine so the quote rules see them.
  useEffect(() => {
    setDeposit((s) => reduceDeposit(s, { type: 'amount', amount: usdcAmount }));
  }, [usdcAmount]);

  useEffect(() => {
    setDeposit((s) => reduceDeposit(s, { type: 'max-fee', maxFee }));
  }, [maxFee]);

  // Panel quote: refetch when the route or the mode changes.
  useEffect(() => {
    if (!wallet.connected) return;
    void refreshQuote(deposit.mode);
  }, [wallet.connected, activeDomain.domainId, deposit.mode]);

  // Execute asked for a quote (fresh or after the 5-minute rule). `quoting` is the
  // machine's instruction to fetch; the frame's arrival moves it on to `burning`.
  useEffect(() => {
    if (deposit.step !== 'quoting') return;
    void refreshQuote(deposit.mode);
  }, [deposit.step]);

  // Execute cleared the panel: register the intent and start polling.
  useEffect(() => {
    if (deposit.step !== 'burning' || runRef.current) return;
    void startRun(deposit.mode);
  }, [deposit.step]);

  const handleModeChange = (mode: TransferMode) => {
    setDeposit((s) => reduceDeposit(s, { type: 'mode-change', mode }));
  };

  const handleExecuteDeposit = () => {
    if (!wallet.connected || !wallet.address) {
      onConnectWallet();
      return;
    }

    // Error simulation: inject synthetic event instead of starting a transfer.
    const simEvt = simErrorEvent(simError, network);
    if (simEvt) {
      setDeposit((s) => reduceDeposit({ ...s, step: 'burning' }, simEvt));
      return;
    }

    // A previous attempt's run must not block the new one.
    runRef.current = null;
    finishRun();
    setDeposit((s) => reduceDeposit(s, { type: 'execute' }));
  };

  /** Spec §7: cancel stops the wait only — the burn stays valid and retryable. */
  const handleCancel = () => {
    finishRun();
    setDeposit((s) => reduceDeposit(s, { type: 'cancel' }));
  };

  /** Retry as Standard: resume the same intent and wait on the Standard timeline. */
  const handleRetryStandard = () => {
    if (!runRef.current) return;
    runRef.current = { ...runRef.current, startedAt: Date.now() };
    pollingRef.current = true;
    setDeposit((s) => reduceDeposit(s, { type: 'retry-standard' }));
    scheduleNextPoll();
  };

  const handleDismissCancelled = () => {
    runRef.current = null;
    finishRun();
    setDeposit({ ...initialDeposit, mode: deposit.mode, amount: usdcAmount, maxFee });
  };

  /** Inputs and the mode toggle are live until the intent binds them (spec §7). */
  const isPreBurn = deposit.step === 'idle' || deposit.step === 'error' || deposit.step === 'quoting';
  const inputsDisabled = !isPreBurn;
  const waiting = isPollingStep(deposit.step);
  const inFlight = deposit.step === 'burning' || deposit.step === 'settling';
  const { quote } = deposit;
  const overMax = quoteFeeOverMax(deposit);
  const fastUnavailable = quote !== undefined && !quote.fastTierAvailable;

  return (
    <section id="catalog" className="py-20 lg:py-28 relative bg-[#070C18] border-t border-slate-800 w-full overflow-hidden">
      <div className="w-full max-w-[1700px] mx-auto px-6 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-start">

          {/* Left: oversized editorial headline, mirroring the reference layout */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="lg:col-span-3 space-y-5 lg:sticky lg:top-32"
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-[#3E6BFF]">
              How to use
            </p>
            <h2 className="text-5xl xl:text-6xl font-black text-white tracking-tighter leading-[0.95]">
              Not sure where to start? here&apos;s how!
            </h2>
            <p className="text-slate-400 text-base font-medium leading-relaxed max-w-xs">
              Pick a domain, burn, then watch USDC land on Stellar. Transfer 1:1 USDC from 26+ chains straight to your Stellar account.
            </p>
            <div className="flex items-center gap-2 pt-2">
              {wallet.connected && (xlmBalance !== null || usdcBalance !== null) && (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full text-[11px] font-mono font-bold bg-slate-800/80 border border-slate-700 text-slate-200">
                  {usdcBalance ?? '…'} USDC · {xlmBalance ?? '…'} XLM
                </span>
              )}
            </div>
            {networkOk === false && (
              <p className="text-xs font-bold text-rose-400">{networkLabel}</p>
            )}
          </motion.div>

          {/* Right: three tilted cards joined by a connector line, like the reference */}
          <div className="lg:col-span-9 relative">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10 lg:gap-14 items-stretch relative z-10">

              {/* Card 1 — Pick domain */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
                className="rounded-3xl bg-[#0D1527] border border-slate-800 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 md:-rotate-2 hover:rotate-0 transition-transform duration-500"
              >
                <div>
                  <h3 className="text-2xl font-extrabold text-white tracking-tight">Pick a domain</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1 leading-relaxed">
                    Check the source chain before burning.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                        selectedCategory === cat.id
                          ? 'bg-[#3E6BFF] text-white shadow-lg shadow-blue-500/25'
                          : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <p className="text-[11px] font-mono text-slate-500 -mt-3">
                  {filteredDomains.length} source chains available — scroll for more
                </p>

                <div className="rounded-2xl bg-slate-950/60 border border-slate-800/80 p-3 space-y-2 max-h-[420px] overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                  <AnimatePresence mode="popLayout">
                    {filteredDomains.map((domain) => {
                      const isSelected = selectedDomainId === domain.domainId;
                      const isSvm = domain.domainId === 5;
                      const isCosmos = domain.domainId === 21;
                      return (
                        <motion.button
                          layout
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          key={domain.domainId}
                          onClick={() => setSelectedDomainId(domain.domainId)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-slate-900 border-[#3E6BFF]/70 shadow-md'
                              : 'bg-transparent border-transparent hover:border-slate-700 hover:bg-slate-900/70'
                          }`}
                        >
                          <span className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5">
                            <DomainLogo chain={domain.chain} name={domain.name} className="w-full h-full object-contain" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="block text-sm font-extrabold text-white truncate">{domain.name}</span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold border shrink-0 ${
                                  isSvm
                                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                                    : isCosmos
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                }`}
                              >
                                {domain.networkType}
                              </span>
                            </span>
                            <span className="block text-[11px] font-mono text-slate-500">ID: {domain.domainId} · CCTP v1 Standard</span>
                          </span>
                          <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-[12px] font-black ${
                            isSelected ? 'bg-[#3E6BFF] border-[#3E6BFF] text-white' : 'border-slate-700 text-transparent'
                          }`}>
                            ✓
                          </span>
                        </motion.button>
                      );
                    })}
                  </AnimatePresence>
                </div>

                <div className="mt-auto pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-400">Deposit Ratio</span>
                  <span className="text-emerald-400 font-mono">1 USDC = 1 USDC</span>
                </div>
              </motion.div>

              {/* Card 2 — Burn pakai form */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.55, ease: 'easeOut', delay: 0.1 }}
                className="rounded-3xl bg-[#0D1527] border border-slate-800 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-4 md:rotate-1 hover:rotate-0 transition-transform duration-500"
              >
                <div>
                  <h3 className="text-2xl font-extrabold text-white tracking-tight">Burn & send</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1 leading-relaxed">
                    {activeDomain.name} → Stellar ({STELLAR_CCTP_DOMAIN}) · fill in the burn hash, then execute.
                  </p>
                </div>

                <div className="flex items-center gap-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 p-3">
                  <span className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-2">
                    <DomainLogo chain={activeDomain.chain} name={activeDomain.name} className="w-full h-full object-contain" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-extrabold text-white truncate">{activeDomain.name}</span>
                    <span className="block text-[11px] font-mono text-blue-400 font-bold">Circle Domain ID: {activeDomain.domainId}</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-[#3E6BFF] text-white shadow-md shrink-0">
                    Selected
                  </span>
                </div>

                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={usdcAmount}
                      onChange={(e) => setUsdcAmount(e.target.value)}
                      disabled={inputsDisabled}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-white focus:ring-2 focus:ring-[#3E6BFF] focus:border-[#3E6BFF] outline-none transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Burn Tx Hash
                    </label>
                    <input
                      type="text"
                      value={burnTxHash}
                      onChange={(e) => setBurnTxHash(e.target.value)}
                      disabled={inputsDisabled}
                      placeholder="0x…"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-300 focus:ring-2 focus:ring-[#3E6BFF] outline-none transition-all truncate"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Stellar destination
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={wallet.connected && wallet.address ? wallet.address : 'Connect Freighter Wallet…'}
                      className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-500 cursor-not-allowed truncate"
                    />
                  </div>
                </div>

                {wallet.connected && wallet.address && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-[11px] font-mono">
                      <span className="text-slate-400">
                        XLM <span className="text-white font-bold">{xlmBalance ?? '…'}</span>
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">
                        USDC <span className="text-white font-bold">{usdcBalance ?? '…'}</span>
                      </span>
                      {networkOk === true ? (
                        <span className="inline-flex items-center font-extrabold text-emerald-400">
                          <WifiHigh className="w-3 h-3 mr-1" />
                          {networkLabel} ✓
                        </span>
                      ) : networkOk === false ? (
                        <span className="inline-flex items-center font-extrabold text-rose-400">
                          <WifiSlash className="w-3 h-3 mr-1" />
                          {networkLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2 text-[11px] font-mono space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Amount:</span>
                        <span className="text-white font-bold">{usdcAmount} USDC</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400 shrink-0">Destination:</span>
                        <span className="text-white font-bold truncate">{wallet.address}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Network:</span>
                        <span className="text-white font-bold">{networkLabel || '…'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {networkOk === false && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[11px] font-mono text-amber-300 space-y-1">
                    <p className="font-extrabold">Network config invalid{networkError ? `: ${networkError.replace(/^NETWORK_CONFIG\s*/, '')}` : ''}</p>
                    <p className="text-amber-200/80">Fix: copy <span className="font-bold">apps/demo/.env.testnet.example</span> to <span className="font-bold">apps/demo/.env</span>, then restart the dev server.</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Mode</span>
                  <div className="flex items-center gap-1.5">
                    {(['fast', 'standard'] as TransferMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => handleModeChange(mode)}
                        disabled={inputsDisabled || (mode === 'fast' && fastUnavailable)}
                        className={`px-3 py-1 rounded-full text-[11px] font-extrabold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          deposit.mode === mode
                            ? 'bg-[#3E6BFF] text-white shadow-md'
                            : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        {mode === 'fast' ? 'Fast' : 'Standard'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Max Fee (USDC, optional)
                  </label>
                  <input
                    type="text"
                    value={maxFee}
                    onChange={(e) => setMaxFee(e.target.value)}
                    placeholder="No cap"
                    disabled={inputsDisabled}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:ring-2 focus:ring-[#3E6BFF] outline-none transition-all"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    Fee: {quote ? `${quote.minimumFee} bps` : quoteError ? 'unavailable' : 'quoting…'}
                  </p>
                  {overMax && (
                    <div className="flex items-start text-amber-400 font-bold text-[11px]">
                      <WarningCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 shrink-0" />
                      <span>Quoted fee is above your max — raise the cap or switch to Standard, or this transfer will continue as Standard.</span>
                    </div>
                  )}
                  {fastUnavailable && (
                    <div className="flex items-start text-amber-400 font-bold text-[11px]">
                      <WarningCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 shrink-0" />
                      <span>Fast allowance unavailable for this route — use Standard.</span>
                    </div>
                  )}
                  {quoteError && (
                    <div className="flex items-start text-rose-300 font-bold text-[11px]">
                      <WarningCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 shrink-0" />
                      <span>{quoteError}</span>
                    </div>
                  )}
                </div>

                {wallet.connected && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Simulate Error
                    </label>
                    <select
                      value={simError}
                      onChange={(e) => setSimError(e.target.value)}
                      disabled={inputsDisabled}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white focus:ring-2 focus:ring-[#3E6BFF] outline-none transition-all"
                    >
                      <option value="none" className="bg-slate-900 text-white">None</option>
                      <option value="rejected-signing" className="bg-slate-900 text-white">Freighter signing rejected</option>
                      <option value="insufficient-xlm" className="bg-slate-900 text-white">Insufficient XLM balance</option>
                      <option value="network-mismatch" className="bg-slate-900 text-white">Network mismatch (mainnet)</option>
                    </select>
                  </div>
                )}

                <button
                  onClick={wallet.connected ? handleExecuteDeposit : onConnectWallet}
                  disabled={inputsDisabled}
                  className="mt-auto w-full py-3.5 rounded-xl bg-[#3E6BFF] hover:bg-[#345CE0] text-white font-extrabold text-xs sm:text-sm transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  {inFlight || waiting ? (
                    <>
                      <ArrowsClockwise className="w-4 h-4 animate-spin" />
                      <span>{inFlight ? 'Processing…' : 'Waiting attestation…'}</span>
                    </>
                  ) : deposit.step === 'quoting' ? (
                    <>
                      <ArrowsClockwise className="w-4 h-4 animate-spin" />
                      <span>Re-quoting fee…</span>
                    </>
                  ) : wallet.connected ? (
                    <>
                      <span>Execute Deposit Now</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <span>Connect Freighter Wallet</span>
                  )}
                </button>
                {!wallet.connected && wallet.error && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[11px] font-mono text-rose-300">
                    <span className="font-bold">Wallet connection failed: </span>
                    {wallet.error}
                    {/install/i.test(wallet.error) && (
                      <>
                        {' — '}
                        <a
                          href="https://freighter.app"
                          target="_blank"
                          rel="noreferrer"
                          className="underline font-bold"
                        >
                          Install Freighter
                        </a>
                      </>
                    )}
                  </div>
                )}
              </motion.div>

              {/* Card 3 — Receive & tracking */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.55, ease: 'easeOut', delay: 0.2 }}
                className="rounded-3xl bg-[#0D1527] border border-slate-800 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-4 md:rotate-2 hover:rotate-0 transition-transform duration-500"
              >
                <div>
                  <h3 className="text-2xl font-extrabold text-white tracking-tight">Receive USDC</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1 leading-relaxed">
                    Check tracking to see the delivery status.
                  </p>
                </div>

                {/* Stepper */}
                <div className="rounded-2xl bg-slate-950/60 border border-slate-800/80 p-4">
                  <div className="flex items-center justify-between">
                    {['Burn', 'Attest', 'Settle'].map((label, i) => {
                      const activeIdx = deposit.step === 'settled' ? 3
                        : deposit.step === 'settling' ? 2
                        : waiting || deposit.step === 'burning' || deposit.step === 'quoting' ? 1
                        : 0;
                      const done = i < activeIdx;
                      const current = i === activeIdx;
                      return (
                        <React.Fragment key={label}>
                          <div className="flex flex-col items-center gap-1.5">
                            <span className={`w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-black transition-all ${
                              done ? 'bg-emerald-500 border-emerald-500 text-white'
                              : current ? 'bg-[#3E6BFF] border-[#3E6BFF] text-white'
                              : 'border-slate-700 text-slate-500'
                            }`}>
                              {done ? '✓' : i + 1}
                            </span>
                            <span className={`text-[10px] font-bold ${done || current ? 'text-white' : 'text-slate-500'}`}>{label}</span>
                          </div>
                          {i < 2 && <div className={`flex-1 h-[2px] mx-1 mb-5 rounded ${i < activeIdx ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* Live status / receipt */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 min-h-[132px] text-xs font-mono space-y-2">
                  {deposit.step === 'settled' && deposit.receipt ? (
                    <div className="space-y-2">
                      {deposit.receipt.simulated && deposit.receipt.txHash.startsWith('SIM-') && (
                        <div className="text-center text-amber-400 font-extrabold text-[11px] uppercase tracking-wider">
                          ⚠ SIMULATED — No real transaction submitted
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        <span>Payment received</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Minting Output:</span>
                        <span className="text-white font-bold">{deposit.receipt.stellarAmount} USDC</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Dust sweep:</span>
                        <span>{deposit.receipt.dust} base units</span>
                      </div>
                      <div className="flex justify-between text-slate-400 gap-2">
                        <span>Stellar Tx:</span>
                        {deposit.receipt.simulated && deposit.receipt.txHash.startsWith('SIM-') ? (
                          <span className="truncate max-w-[140px] text-white">{deposit.receipt.txHash}</span>
                        ) : (
                          <a
                            href={`https://stellar.expert/explorer/${network}/tx/${deposit.receipt.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate max-w-[140px] text-white underline hover:text-emerald-400"
                          >
                            {deposit.receipt.txHash}
                          </a>
                        )}
                      </div>
                    </div>
                  ) : deposit.step === 'error' && deposit.errorDetails ? (
                    <div className="rounded-xl bg-rose-950/40 border border-rose-800/60 p-3 flex items-start text-rose-300 font-extrabold">
                      <WarningCircle className="w-4 h-4 mr-1.5 shrink-0 mt-0.5 text-rose-400" />
                      <span>{deposit.errorDetails}</span>
                    </div>
                  ) : deposit.step === 'cancelled' ? (
                    <div className="space-y-3">
                      <p className="font-extrabold text-slate-200">Cancelled — no mint was attempted.</p>
                      <p className="text-slate-500">Cancelling stops waiting; your burn stays valid — retry anytime.</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleRetryStandard}
                          className="flex-1 py-2.5 rounded-xl bg-[#3E6BFF] hover:bg-[#345CE0] text-white font-extrabold text-[11px] transition-all cursor-pointer"
                        >
                          Retry Standard
                        </button>
                        <button
                          onClick={handleDismissCancelled}
                          className="flex-1 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-300 font-extrabold text-[11px] transition-all cursor-pointer"
                        >
                          New transfer
                        </button>
                      </div>
                    </div>
                  ) : !isPreBurn ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-slate-300">
                        <ArrowsClockwise className="w-3.5 h-3.5 animate-spin text-[#3E6BFF]" />
                        <span>
                          {deposit.step === 'burning' && 'Verifying wallet & registering burn…'}
                          {deposit.step === 'fast-wait' && `Fast: attestation in seconds (attempt ${Math.max(deposit.attempts, 1)})`}
                          {deposit.step === 'degraded-standard' && 'Fast unavailable — continuing as Standard…'}
                          {deposit.step === 'attesting' && `Standard: attestation in minutes (attempt ${Math.max(deposit.attempts, 1)})`}
                          {deposit.step === 'settling' && 'Submitting Soroban mint…'}
                        </span>
                      </div>
                      {waiting && (
                        <div className="space-y-2 border-t border-slate-800 pt-3">
                          <p className="text-slate-500">
                            Cancelling stops waiting; your burn stays valid — retry anytime.
                          </p>
                          <button
                            onClick={handleCancel}
                            className="w-full py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-rose-500/50 hover:text-rose-300 text-slate-300 font-extrabold text-[11px] transition-all cursor-pointer"
                          >
                            Cancel waiting
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-500 leading-relaxed">
                      No transfer yet — pick a domain, fill in the burn hash, then execute. Live status shows up here.
                    </p>
                  )}
                </div>

                <div className="mt-auto pt-4 border-t border-slate-800/80 text-[11px] font-mono text-slate-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Route:</span>
                    <span className="text-slate-200 font-bold">{activeDomain.name} → Stellar</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Network:</span>
                    <span className="text-slate-200 font-bold">{networkLabel || '…'}</span>
                  </div>
                </div>
              </motion.div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
};
