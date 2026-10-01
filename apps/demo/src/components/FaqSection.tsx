import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from '@phosphor-icons/react';

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(2); // Default to middle element

  const faqs = [
    {
      question: 'What is AnchorCCTP?',
      answer: 'AnchorCCTP is an open-source TypeScript SDK that accepts 1:1 cross-chain USDC deposits from 26+ Circle CCTP blockchains into the Stellar ecosystem without bridging friction.'
    },
    {
      question: '6-to-7 Stroop Decimals',
      answer: 'Circle CCTP standardizes on 6 decimal places for USDC, whereas Stellar native assets use 7 decimals (Stroop). AnchorCCTP performs automated high-precision integer scaling with zero rounding loss.'
    },
    {
      question: '26+ Circle CCTP Domains',
      answer: 'AnchorCCTP supports all production Circle CCTP domains, including Ethereum, Solana, Arbitrum, Optimism, Polygon, Base, Avalanche, and Stellar (Domain 27).'
    },
    {
      question: 'Soroban Forwarder Contract',
      answer: 'The Soroban contract acts as an on-chain minting proxy on Stellar: it verifies Circle Iris attestation signatures and automatically provisions destination USDC trustlines (capped at 2 XLM).'
    },
    {
      question: 'Deposit Order Tracking',
      answer: 'Every transfer includes a verified burn hash tracked in an idempotency store. You can query status and inspect attestation proofs on-chain in real time.'
    },
  ];

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-24 relative bg-[#03060c] w-full border-t border-slate-800/60 font-sans overflow-hidden">
      <div className="w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-16 space-y-16">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="space-y-4 text-left max-w-3xl"
        >
          <h2 className="text-5xl md:text-6xl font-black text-white tracking-tighter">
            Got questions?
          </h2>
          <p className="text-slate-400 text-base md:text-lg font-medium leading-relaxed max-w-sm">
            Some of answered questions that might help you.
          </p>
          <div className="hidden lg:block pt-8">
            <div className="w-20 h-1 bg-[#3E6BFF] rounded-full" />
          </div>
        </motion.div>

        {/* Responsive Horizontal/Vertical Accordion (Naleka Style) */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 lg:mt-16"
        >
          <div className="flex flex-col lg:flex-row w-full h-auto lg:h-[600px] border border-slate-800/80 rounded-[2rem] overflow-hidden bg-[#070C18]">
            {faqs.map((faq, idx) => {
              const isOpen = openIndex === idx;
              return (
                <motion.div
                  key={idx}
                  layout
                  transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                  onClick={() => toggleFaq(idx)}
                  className={`group relative flex flex-col transition-all duration-300 ease-out cursor-pointer overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-800 last:border-0 ${isOpen ? 'lg:flex-[3] bg-slate-900/50 h-[500px] lg:h-full' : 'lg:flex-[0.5] hover:bg-slate-800/30 h-[80px] lg:h-full'
                    }`}
                >
                  {/* Desktop Closed State (Vertical Text) */}
                  <div className={`hidden lg:flex w-full h-full flex-col items-center justify-between py-10 absolute inset-0 transition-opacity duration-150 ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                    <div className="flex-1 flex items-center justify-center">
                      <h3
                        className="text-lg font-bold text-slate-400 whitespace-nowrap tracking-wide group-hover:text-white transition-colors"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                      >
                        {faq.question}
                      </h3>
                    </div>
                    <div className="text-slate-500 group-hover:text-[#3E6BFF] transition-colors">
                      <Plus className="w-6 h-6" />
                    </div>
                  </div>

                  {/* Mobile Closed State (Horizontal Text) */}
                  <div className={`lg:hidden w-full h-full flex items-center justify-between px-6 absolute inset-0 transition-opacity duration-150 ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                    <h3 className="text-base font-bold text-slate-400 group-hover:text-white transition-colors">
                      {faq.question}
                    </h3>
                    <Plus className="w-5 h-5 text-slate-500" />
                  </div>

                  {/* Opened State Content */}
                  <div className={`w-full h-full flex flex-col justify-between p-8 md:p-12 relative z-10 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>

                    {/* Top Content: Question & Answer */}
                    <div className="flex flex-col lg:flex-row justify-between items-start gap-8">
                      <div className="max-w-2xl">
                        <h3 className="text-3xl md:text-5xl font-black text-white leading-[1.1] tracking-tight">
                          {faq.question}
                        </h3>
                        <p className="mt-6 text-lg md:text-xl text-slate-400 font-medium leading-relaxed max-w-xl">
                          {faq.answer}
                        </p>
                      </div>
                    </div>

                    {/* Bottom Content: Logo Visual (1.5x Larger) */}
                    <div className="self-center lg:self-end mt-12 lg:mt-auto relative w-full lg:w-auto flex justify-center lg:justify-end">
                      <div className="absolute inset-0 bg-[#3E6BFF]/20 blur-[100px] rounded-full pointer-events-none" />
                      <div className="relative flex items-center justify-center w-72 h-72 lg:w-[30rem] lg:h-[30rem]">
                        <img
                          src="/assets/img/final.svg"
                          alt="Logo"
                          className="w-64 h-64 lg:w-[26rem] lg:h-[26rem] object-contain drop-shadow-[0_0_40px_rgba(62,107,255,0.5)] relative z-10 hover:scale-105 transition-transform duration-500"
                        />
                      </div>
                    </div>

                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
};
