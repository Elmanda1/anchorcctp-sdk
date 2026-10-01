import React from 'react';
import { Stack, ShieldCheck, ArrowRight, BookOpen, Lock, Network, FileCode } from '@phosphor-icons/react';

export const ArchitectureDocsSection: React.FC = () => {
  return (
    <section id="specs" className="py-16 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-extrabold bg-[#3E6BFF]/15 border border-[#3E6BFF]/30 text-[#3E6BFF] shadow-sm">
            <BookOpen className="w-3.5 h-3.5 mr-1.5 text-[#3E6BFF]" />
            SEP-CCTP Protocol Specification
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight sm:text-4xl">
            Protocol Architecture & Security
          </h2>
          <p className="text-slate-300 max-w-xl mx-auto text-sm font-medium">
            Standardized mechanism for Stellar anchors to advertise and execute cross-chain USDC deposits.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Transfer Lifecycle Timeline */}
          <div className="lg:col-span-7 arch-card p-6 sm:p-8 rounded-2xl space-y-6 bg-slate-900/80 border border-slate-800">
            <h3 className="text-xl font-extrabold text-white flex items-center border-b border-slate-800 pb-4">
              <Stack className="w-5 h-5 mr-2.5 text-[#3E6BFF]" />
              4-Stage Inbound Transfer Lifecycle
            </h3>

            <div className="space-y-6">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 rounded-xl bg-[#3E6BFF] text-white flex items-center justify-center font-extrabold text-sm shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-white">Source Chain Burn</h4>
                  <p className="text-xs text-slate-300 leading-relaxed mt-1 font-medium">
                    Sender burns USDC on source chain targeting Stellar CCTP Domain ID <code className="text-[#3E6BFF] font-bold">27</code>. Recipient is encoded as 32-byte Ed25519 payload.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 rounded-xl bg-[#3E6BFF] text-white flex items-center justify-center font-extrabold text-sm shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-white">Circle Iris Attestation Signature</h4>
                  <p className="text-xs text-slate-300 leading-relaxed mt-1 font-medium">
                    Circle Iris API monitors finality and issues signed attestation proof. Anchor SDK polls <code className="text-[#3E6BFF] font-bold">iris-api.circle.com/v1/attestations</code>.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 rounded-xl bg-[#3E6BFF] text-white flex items-center justify-center font-extrabold text-sm shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-white">Soroban Forwarder Execution</h4>
                  <p className="text-xs text-slate-300 leading-relaxed mt-1 font-medium">
                    Anchor invokes Soroban Forwarder contract with Iris signature. Contract verifies proof and mints Stellar native USDC.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 rounded-xl bg-[#3E6BFF] text-white flex items-center justify-center font-extrabold text-sm shrink-0 mt-0.5">
                  4
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-white">Decimal Scaling & Settlement</h4>
                  <p className="text-xs text-slate-300 leading-relaxed mt-1 font-medium">
                    Anchor credits destination balance, scaling decimals from 6 (EVM/SVM) to 7 (Stellar Stroop units). Sub-stroop dust is swept automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Security & Architectural Principles */}
          <div className="lg:col-span-5 arch-card p-6 sm:p-8 rounded-2xl space-y-6 flex flex-col justify-between bg-slate-900/80 border border-slate-800">
            <div className="space-y-6">
              <h3 className="text-xl font-extrabold text-white flex items-center border-b border-slate-800 pb-4">
                <ShieldCheck className="w-5 h-5 mr-2.5 text-emerald-400" />
                Security Guarantees
              </h3>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center text-xs font-extrabold text-white">
                    <Lock className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                    Replay Attack Mitigation
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Persistent idempotency store records processed burn hashes. Duplicate burn submissions return <code className="text-[#3E6BFF]">REPLAY_TRANSFER</code>.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center text-xs font-extrabold text-white">
                    <Network className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                    Domain Allow-Listing
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Strict verification of source domain IDs against recognized CCTP domain mappings prevents testnet message injection.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center text-xs font-extrabold text-white">
                    <FileCode className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                    Trustline Reserve Cap
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Sponsored trustline creation is capped at <code className="text-amber-400 font-bold">≤ 2 XLM</code> reserve, protecting sponsorship pools.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between font-bold">
              <span>Read Full Specification</span>
              <a
                href="https://github.com/mothersgrace/anchorcctp-sdk/blob/main/docs/SEP-CCTP.md"
                target="_blank"
                rel="noreferrer"
                className="text-[#3E6BFF] hover:underline font-extrabold flex items-center"
              >
                <span>docs/SEP-CCTP.md</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
