import React from 'react';
import { ArrowLeft, Shield } from '@phosphor-icons/react';

interface Props {
  onNavigate: (page: 'home' | 'privacy' | 'terms' | 'support') => void;
}

export const PrivacyPolicyPage: React.FC<Props> = ({ onNavigate }) => {
  return (
    <div className="w-full max-w-[900px] mx-auto px-6 py-20 animate-fade-in relative z-10">
      <button 
        onClick={() => onNavigate('home')}
        className="group flex items-center gap-3 text-slate-400 hover:text-white transition-colors mb-12 font-mono text-sm uppercase tracking-widest"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to Home
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-[#3E6BFF]/10 text-[#3E6BFF] rounded-xl border border-[#3E6BFF]/20">
          <Shield className="w-8 h-8" />
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">Privacy Policy</h1>
      </div>

      <div className="prose prose-invert prose-slate max-w-none font-medium leading-relaxed">
        <p className="text-xl text-slate-300 mb-10">
          AnchorCCTP is an open-source development toolkit designed for cross-chain settlement. This policy explains how information is handled when interacting with our protocol and documentation demo.
        </p>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">1. Data Collection</h2>
        <p className="text-slate-400 mb-6">
          Given the decentralized nature of the protocol, AnchorCCTP only processes technical data cryptographically required to execute cross-chain transfers: public blockchain addresses, transaction hashes, and Circle CCTP message payloads. We do not collect or store personally identifiable information (PII).
        </p>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">2. Data Usage</h2>
        <p className="text-slate-400 mb-6">
          On-chain transaction data is processed strictly to:
        </p>
        <ul className="list-disc pl-6 text-slate-400 space-y-3 mb-8">
          <li>Verify Circle Iris attestation signatures.</li>
          <li>Invoke the minting operation on the Soroban forwarder contract.</li>
          <li>Prevent duplicate credits and replay attacks via local idempotency stores.</li>
        </ul>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">3. Public Ledger Transparency</h2>
        <p className="text-slate-400 mb-6">
          All transactions executed across source blockchains and the Stellar network are publicly visible, immutable records governed by the respective distributed ledgers.
        </p>
      </div>
    </div>
  );
};
