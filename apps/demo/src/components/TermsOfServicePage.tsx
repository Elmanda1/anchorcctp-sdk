import React from 'react';
import { ArrowLeft, FileText } from '@phosphor-icons/react';

interface Props {
  onNavigate: (page: 'home' | 'privacy' | 'terms' | 'support') => void;
}

export const TermsOfServicePage: React.FC<Props> = ({ onNavigate }) => {
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
        <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
          <FileText className="w-8 h-8" />
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">Terms of Service</h1>
      </div>

      <div className="prose prose-invert prose-slate max-w-none font-medium leading-relaxed">
        <p className="text-xl text-slate-300 mb-10">
          By using AnchorCCTP SDK and this interactive demonstration, you agree to these open-source terms.
        </p>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">1. Open-Source License</h2>
        <p className="text-slate-400 mb-6">
          AnchorCCTP is licensed under the MIT License. You are free to use, modify, and distribute the codebase provided that the original copyright notice remains intact. The software is provided "as is", without warranty of any kind, express or implied.
        </p>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">2. Limitation of Liability</h2>
        <p className="text-slate-400 mb-6">
          The authors and contributors shall not be liable for any claims, damages, or liabilities arising from the use of this software, including loss of funds from smart contract interactions, network congestion, or third-party relayer downtime.
        </p>

        <h2 className="text-2xl font-bold text-white mt-12 mb-6">3. Regulatory Compliance</h2>
        <p className="text-slate-400 mb-6">
          Anchors and developers implementing this SDK on Stellar are solely responsible for adhering to applicable KYC, AML, and financial regulations in their respective jurisdictions. AnchorCCTP provides developer tooling and smart contract interfaces; it is not a custodial financial service provider.
        </p>
      </div>
    </div>
  );
};
