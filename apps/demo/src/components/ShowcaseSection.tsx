import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  Compass,
} from '@phosphor-icons/react';

interface StandardCardProps {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  frontDescription: string;
  backDetails: string[];
  ctaLabel: string;
}

export const ShowcaseSection: React.FC = () => {
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});

  const toggleFlip = (id: string) => {
    setFlippedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const standards: StandardCardProps[] = [
    {
      id: 'std-1',
      title: 'Soroban Forwarder Mint',
      subtitle: 'Smart Contract Automation',
      tag: 'CCTP Domain 27',
      frontDescription: 'Delegated minting with automatic trustline setup, removing manual onboarding steps.',
      backDetails: [
        'XLM reserve cap: ≤ 2 XLM',
        'Atomic execution via Soroban SDK',
        'Domain ID and Iris proof validation',
      ],
      ctaLabel: 'View Soroban Contract',
    },
    {
      id: 'std-2',
      title: 'Attestation Poller',
      subtitle: 'Circle Iris Proof Engine',
      tag: 'Cryptographic Proof',
      frontDescription: 'Automated polling with exponential backoff and 64-byte signature verification.',
      backDetails: [
        'Fast-path attestation retrieval',
        'Support for 26+ CCTP domains',
        'Automatic retry on pending proofs',
      ],
      ctaLabel: 'View Iris Proof Log',
    },
    {
      id: 'std-3',
      title: 'Decimal Precision Scaler',
      subtitle: '6 to 7 Stroop Conversion',
      tag: 'Lossless Scaling',
      frontDescription: 'Convert 6-decimal USDC (EVM/SVM) to 7-decimal Stellar Stroop units with zero rounding error.',
      backDetails: [
        'Pure BigInt integer arithmetic',
        'Deterministic sub-stroop dust accounting',
        'Compliant with Soroban token interface',
      ],
      ctaLabel: 'Test Decimal Math',
    },
    {
      id: 'std-4',
      title: 'Replay Attack Protection',
      subtitle: 'Idempotency Store',
      tag: 'Settlement Safety',
      frontDescription: 'Burn transaction hashes are recorded in an append-only store to prevent duplicate credits.',
      backDetails: [
        'Unique hash registry',
        'Zero double-minting guarantee',
        'Idempotent receive() lifecycle',
      ],
      ctaLabel: 'Verify Replay Store',
    },
  ];

  return (
    <div className="space-y-16 py-8">
      {/* SECTION 1: HUTS-STYLE ALTERNATING BACK-AND-FORTH SHOWCASE */}
      <section className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-16">
        {/* Back-and-Forth Block #1: Media Left, Content Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-6 relative"
          >
            <div className="relative rounded-3xl overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-[#0C310A]/60 via-[#071913] to-slate-950 p-8 shadow-2xl space-y-6">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-4">
                <span className="font-mono text-xs text-emerald-400 font-bold uppercase tracking-widest">
                  // HUTS ARCHITECTURE #01
                </span>
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                  Domain ID 27 Live
                </span>
              </div>

              <div className="space-y-4">
                <h3 className="text-2xl font-black text-white leading-tight">
                  Stellar Anchor Ingestion Infrastructure
                </h3>
                <p className="text-slate-300 text-sm font-medium leading-relaxed">
                  Combining Soroban smart contracts with Circle CCTP to enable frictionless cross-chain deposits from 26+ blockchains.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-emerald-500/20">
                <div className="p-4 rounded-2xl bg-slate-950/70 border border-emerald-500/20 space-y-1">
                  <p className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Response Time</p>
                  <p className="text-xl font-black text-white">&lt; 3 Seconds</p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-950/70 border border-emerald-500/20 space-y-1">
                  <p className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Trustline Cost</p>
                  <p className="text-xl font-black text-white">0 XLM (Auto)</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-6 space-y-6 text-left"
          >
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#3E6BFF]">
              // HUTS ARCHITECTURE
            </p>
            <h2 className="text-3xl font-black text-white tracking-tight sm:text-4xl">
              Engineered to Modern Production Standards
            </h2>
            <p className="text-slate-300 text-base font-medium leading-relaxed">
              The <strong className="text-white">AnchorCCTP SDK</strong> provides isolated, predictable primitives. Every module runs independently while maintaining end-to-end type safety.
            </p>
            <div className="space-y-3 pt-2">
              <div className="flex items-center space-x-3 text-sm font-bold text-slate-200">
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Automatic Soroban trustline creation for new recipient accounts</span>
              </div>
              <div className="flex items-center space-x-3 text-sm font-bold text-slate-200">
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Sponsor reserve pool protection capped at ≤ 2 XLM</span>
              </div>
              <div className="flex items-center space-x-3 text-sm font-bold text-slate-200">
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>SEP-CCTP metadata standard compliance via stellar.toml</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* CUSTOM INLINE SVG SECTION DIVIDER */}
        <div className="flex items-center justify-center py-6">
          <div className="flex items-center space-x-4 opacity-70">
            <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#3E6BFF] to-transparent" />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#3E6BFF] animate-bounce">
              <path d="M12 5V19M12 19L5 12M12 19L19 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#3E6BFF] to-transparent" />
          </div>
        </div>

        {/* Back-and-Forth Block #2: Content Left, Media Right (REVERSE DIRECTION) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-6 space-y-6 text-left order-2 lg:order-1"
          >
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#3E6BFF]">
              // PROOF VERIFICATION
            </p>
            <h2 className="text-3xl font-black text-white tracking-tight sm:text-4xl">
              Circle Iris Cryptographic Proof Engine
            </h2>
            <p className="text-slate-300 text-base font-medium leading-relaxed">
              Attestation proofs are retrieved via configurable exponential backoff polling, handling traffic spikes gracefully without dropped transfers.
            </p>
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Iris API Endpoint:</span>
                <span className="text-white font-bold">iris-api.circle.com/v1</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Proof Status:</span>
                <span className="text-emerald-400 font-bold">COMPLETE (Attested)</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-6 relative order-1 lg:order-2"
          >
            <div className="relative rounded-3xl overflow-hidden border border-[#3E6BFF]/30 bg-gradient-to-br from-[#0D1527] via-slate-900 to-slate-950 p-8 shadow-2xl space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <span className="font-mono text-xs text-[#3E6BFF] font-bold uppercase tracking-widest">
                  // ATTESTATION ENGINE
                </span>
                <span className="text-xs px-3 py-1 rounded-full bg-[#3E6BFF]/20 text-[#3E6BFF] font-bold border border-[#3E6BFF]/40">
                  Circle Iris v1
                </span>
              </div>

              <div className="space-y-4">
                <h3 className="text-2xl font-black text-white leading-tight">
                  Cryptographic Integrity Before Settlement
                </h3>
                <p className="text-slate-300 text-sm font-medium leading-relaxed">
                  The SDK validates that every burn message from Ethereum, Base, Solana, or Noble carries a genuine cryptographic signature prior to forwarding on Stellar.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <p className="text-emerald-400 font-bold">// Iris Attestation Payload</p>
                <p className="truncate text-slate-400">0x…attestation_bytes</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* SECTION 2: 3D FLIP CARD GRID */}
      <section className="relative py-16 bg-[#091526]/80 border-t border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-800 pb-6">
            <div className="space-y-2 text-left">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#3E6BFF]">
                // CORE PROTOCOL SPECIFICATIONS
              </p>
              <h2 className="text-3xl font-black text-white tracking-tight sm:text-4xl">
                Built on Verified Standards
              </h2>
              <p className="text-slate-300 max-w-xl text-sm font-medium">
                Click any card to flip and inspect the underlying architecture specifications.
              </p>
            </div>

            <div className="flex items-center space-x-2 text-xs font-extrabold text-slate-400">
              <Compass className="w-4 h-4 text-[#3E6BFF]" />
              <span>Click card to inspect details</span>
            </div>
          </div>

          {/* 3D Flip Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {standards.map((std) => {
              const isFlipped = !!flippedCards[std.id];
              return (
                <div
                  key={std.id}
                  onClick={() => toggleFlip(std.id)}
                  className="perspective-1000 h-[340px] cursor-pointer group"
                >
                  <motion.div
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                    className="relative w-full h-full preserve-3d"
                  >
                    {/* CARD FRONT SIDE */}
                    <div className="absolute inset-0 backface-hidden p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between shadow-xl group-hover:border-[#3E6BFF]/60 transition-colors">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase px-2.5 py-1 rounded bg-[#3E6BFF]/20 text-[#3E6BFF] border border-[#3E6BFF]/30">
                            {std.tag}
                          </span>
                          <span className="text-xs font-mono text-slate-500 font-bold">FRONT</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-slate-400">{std.subtitle}</p>
                          <h3 className="text-lg font-black text-white">{std.title}</h3>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">
                          {std.frontDescription}
                        </p>
                      </div>

                      <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs font-bold text-[#3E6BFF]">
                        <span>Flip Card</span>
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>

                    {/* CARD BACK SIDE */}
                    <div className="absolute inset-0 backface-hidden rotate-y-180 p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-[#070C18] border border-[#3E6BFF]/50 flex flex-col justify-between shadow-2xl">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <span className="text-xs font-black text-white uppercase">{std.title}</span>
                          <span className="text-xs font-mono text-emerald-400 font-bold">BACK</span>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-mono text-slate-400 font-bold">Key Specifications:</p>
                          <ul className="space-y-1.5 text-xs text-slate-200 font-medium">
                            {std.backDetails.map((detail, idx) => (
                              <li key={idx} className="flex items-center space-x-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3E6BFF]" />
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs font-bold text-white bg-[#3E6BFF] hover:bg-[#345CE0] px-4 py-2.5 rounded-xl text-center">
                        <span>{std.ctaLabel}</span>
                        <ArrowSquareOut className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
