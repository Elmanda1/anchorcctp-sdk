import React from 'react';
import { Wallet } from '@phosphor-icons/react';
import { WalletState } from '../wallet/freighter';

interface NavbarProps {
  wallet: WalletState;
  onConnect: () => void;
  activeSection: string;
  setActiveSection: (section: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  wallet,
  onConnect,
  activeSection,
  setActiveSection,
}) => {
  const scrollTo = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="arch-nav sticky top-0 z-50 border-b border-slate-800/80 bg-[#070C18]/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <a href="#" className="flex items-center space-x-3 cursor-pointer group">
            <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-700/60 p-1.5 flex items-center justify-center transition-transform group-hover:scale-105 shadow-sm">
              <img
                src="/assets/img/final.svg"
                alt="AnchorCCTP Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-black text-white tracking-tight">
                Anchor<span className="text-[#3E6BFF]">CCTP</span>
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#3E6BFF]/20 text-[#3E6BFF] border border-[#3E6BFF]/40">
                SEP-CCTP
              </span>
            </div>
          </a>

          <nav className="hidden md:flex space-x-1 ml-6">
            <button
              onClick={() => scrollTo('catalog')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSection === 'catalog'
                  ? 'bg-[#3E6BFF] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Domain Catalog
            </button>
            <button
              onClick={() => scrollTo('process')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSection === 'process'
                  ? 'bg-[#3E6BFF] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              How It Works
            </button>
            <button
              onClick={() => scrollTo('trust')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSection === 'trust'
                  ? 'bg-[#3E6BFF] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Security
            </button>
            <button
              onClick={() => scrollTo('playground')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSection === 'playground'
                  ? 'bg-[#3E6BFF] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Developer SDK
            </button>
            <button
              onClick={() => scrollTo('faq')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                activeSection === 'faq'
                  ? 'bg-[#3E6BFF] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              FAQ
            </button>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onConnect}
            className={`inline-flex items-center px-4 py-2 border rounded-xl text-xs font-bold transition-all duration-200 shadow-sm cursor-pointer ${
              wallet.connected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-[#3E6BFF] bg-[#3E6BFF] text-white hover:bg-[#345CE0]'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 mr-2" />
            {wallet.connected ? (
              <span className="font-mono">
                {wallet.address?.slice(0, 5)}...{wallet.address?.slice(-4)}
              </span>
            ) : (
              'Connect Wallet'
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
