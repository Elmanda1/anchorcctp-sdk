import React, { useState } from 'react';
import { Copy, Check, Code } from '@phosphor-icons/react';

export const CodeSnippet: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const codeExample = `import { createAnchorCCTP } from '@anchor-cctp/core-sdk';

// 1. Initialize SDK with anchor configuration
const cctp = createAnchorCCTP({
  dustCollectorAddress: 'GAM2LT4MNPTLO6ODP5UEB2OTNJTEDSZRGVQG4354AUSFI27YOO5KHVES', // anchor-owned sink, real G...
  trustline: { allowCreation: true, spendCapXlm: 2 }
});

// 2. Subscribe to real-time deposit lifecycle events
cctp.on('onReceiving', (evt) => console.log('Attesting Iris Proof:', evt.burnTxHash));
cctp.on('onSettled', (evt) => console.log('Settled on Stellar:', evt.amount, evt.txHash));

// 3. Receive cross-chain USDC with single async function call
const result = await cctp.receive({
  sourceDomain: 0, // Ethereum
  burnTxHash: '0x9a8f4c2e...',
  destinationAddress: 'G...' // recipient Stellar account, never a USDC issuer
});

console.log('Credited Stellar Amount:', result.amount);`;

  const handleCopy = () => {
    navigator.clipboard.writeText(codeExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          Anchor SDK Integration
        </h1>
        <p className="text-slate-600 max-w-2xl mx-auto text-base">
          Accept cross-chain USDC from any CCTP-connected chain on Stellar in 3 lines of TypeScript.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 shadow-xl space-y-4 bg-slate-900/95 text-white border border-slate-800 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <Code className="w-5 h-5 text-red-400" />
            <span className="font-mono text-sm text-slate-300">deposit-service.ts</span>
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
                Copy Code
              </>
            )}
          </button>
        </div>

        <pre className="font-mono text-xs text-emerald-400 overflow-x-auto p-2 leading-relaxed">
          {codeExample}
        </pre>
      </div>
    </div>
  );
};

