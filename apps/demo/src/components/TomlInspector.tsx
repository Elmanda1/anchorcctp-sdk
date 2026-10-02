import React, { useState } from 'react';
import { Copy, Check, FileText } from '@phosphor-icons/react';
import { loadNetworkConfig } from '../config/network.js';

export const TomlInspector: React.FC = () => {
  const [copied, setCopied] = useState(false);

  let tomlContent: string;
  try {
    const cfg = loadNetworkConfig();
    tomlContent = `# SEP-CCTP Anchor Configuration
# Published at /.well-known/stellar.toml

[[CURRENCIES]]
code = "USDC"
issuer = "${cfg.usdcIssuer}"
cctp_domain = 27
cctp_forwarder = "${cfg.forwarderContractId}"

[CCTP]
CCTP_DOMAIN = 27
FORWARDER_ADDRESS = "${cfg.forwarderContractId}"
SUPPORTED_SOURCE_DOMAINS = [0, 6]
DUST_HANDLING = "collector_sweep"
DUST_COLLECTOR_ACCOUNT = "GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES"
`;
  } catch {
    tomlContent = '# Error: failed to load network config — check VITE_* env vars';
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(tomlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          Anchor stellar.toml Specification
        </h1>
        <p className="text-slate-600 max-w-2xl mx-auto text-base">
          Stellar ecosystem configuration advertising CCTP deposit support, supported source domain IDs, and Soroban forwarder addresses.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 shadow-xl space-y-4 bg-slate-900/95 text-white border border-slate-800 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-red-400" />
            <span className="font-mono text-sm text-slate-300">/.well-known/stellar.toml</span>
          </div>
          <button
            onClick={handleCopy}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors shadow-xs"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 mr-1" />
                Copy TOML
              </>
            )}
          </button>
        </div>

        <pre className="font-mono text-xs text-slate-300 overflow-x-auto p-2 leading-relaxed">
          {tomlContent}
        </pre>
      </div>
    </div>
  );
};

