import React from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';

export const Footer: React.FC = () => {
  return (
    <footer className="relative z-10 border-t border-slate-800/80 bg-[#070C18] py-12 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-700/60 p-1 flex items-center justify-center">
              <img
                src="/assets/img/final.svg"
                alt="AnchorCCTP Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="text-lg font-black text-white tracking-tight">
              Anchor<span className="text-[#3E6BFF]">CCTP</span>
            </span>
            <span className="text-xs text-slate-400 font-bold border-l border-slate-800 pl-3">
              Circle CCTP Ingestion Engine
            </span>
          </div>

          <div className="flex items-center space-x-6 text-xs font-bold">
            <a
              href="https://github.com/mothersgrace/anchorcctp-sdk"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors flex items-center space-x-1.5"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>GitHub</span>
            </a>
            <a
              href="https://github.com/mothersgrace/anchorcctp-sdk/blob/main/docs/SEP-CCTP.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors flex items-center space-x-1.5"
            >
              <ArrowSquareOut className="w-3.5 h-3.5" />
              <span>SEP-CCTP Specification</span>
            </a>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4 font-medium">
          <p className="flex items-center">
            Developed for Stellar Community Fund & Circle CCTP Interoperability
          </p>
          <p className="font-mono font-semibold">
            Apache-2.0 / MIT Open Source • Built by Mother's Grace
          </p>
        </div>
      </div>
    </footer>
  );
};
