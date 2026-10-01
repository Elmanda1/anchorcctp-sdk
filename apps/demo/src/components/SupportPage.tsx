import React from 'react';
import { ArrowLeft, Lifebuoy, Code, Envelope } from '@phosphor-icons/react';

interface Props {
  onNavigate: (page: 'home' | 'privacy' | 'terms' | 'support') => void;
}

export const SupportPage: React.FC<Props> = ({ onNavigate }) => {
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
        <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
          <Lifebuoy className="w-8 h-8" />
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">Support & Inquiries</h1>
      </div>

      <div className="prose prose-invert prose-slate max-w-none font-medium leading-relaxed">
        <p className="text-xl text-slate-300 mb-10">
          Find documentation, report protocol issues, or reach out directly to coordinate integration support.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          <a href="https://github.com/mothersgrace/anchorcctp-sdk" target="_blank" rel="noreferrer" className="block p-8 rounded-3xl bg-slate-900 border border-slate-800 hover:border-slate-600 transition-all group">
            <Code className="w-10 h-10 text-white mb-6" />
            <h3 className="text-2xl font-bold text-white mb-3">GitHub Issues</h3>
            <p className="text-slate-400 text-sm mb-6">
              Report bugs, submit feature requests, and review ongoing pull requests. This is the fastest channel for technical troubleshooting.
            </p>
            <span className="text-[#3E6BFF] text-sm font-bold flex items-center gap-2">
              Visit GitHub <ArrowLeft className="w-4 h-4 rotate-180 group-hover:translate-x-1 transition-transform" />
            </span>
          </a>

          <a href="mailto:support@anchorcctp.dev" className="block p-8 rounded-3xl bg-slate-900 border border-slate-800 hover:border-slate-600 transition-all group">
            <Envelope className="w-10 h-10 text-white mb-6" />
            <h3 className="text-2xl font-bold text-white mb-3">Direct Contact</h3>
            <p className="text-slate-400 text-sm mb-6">
              For partnership inquiries, anchor onboarding coordination, or responsible security disclosures.
            </p>
            <span className="text-[#3E6BFF] text-sm font-bold flex items-center gap-2">
              Send Email <ArrowLeft className="w-4 h-4 rotate-180 group-hover:translate-x-1 transition-transform" />
            </span>
          </a>
        </div>
      </div>
    </div>
  );
};
