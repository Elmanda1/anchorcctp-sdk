import React, { useRef } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import {
  Globe,
  Lock,
  ArrowsClockwise,
  Cpu,
  SealCheck,
  ShieldWarning,
  ArrowRight,
} from '@phosphor-icons/react';

export const WorkflowSection: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: mapRef,
    offset: ["start center", "end center"],
  });
  const pathLength = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  const steps = [
    {
      step: '01',
      title: 'Select & Burn',
      description: 'Call depositForBurn on source chain with destination domain set to Stellar (Domain 27).',
      badge: 'Step 1: Source Burn',
    },
    {
      step: '02',
      title: 'Iris Attestation',
      description: 'Poll Circle Iris API for cryptographic signature proof.',
      badge: 'Step 2: Proof',
    },
    {
      step: '03',
      title: 'Soroban Forwarder',
      description: 'Submit proof to Soroban forwarder. 6-to-7 Stroop conversion runs automatically.',
      badge: 'Step 3: Execute',
    },
    {
      step: '04',
      title: 'Stellar Settlement',
      description: 'Native Stellar USDC arrives directly into recipient wallet balance.',
      badge: 'Step 4: Settled',
    },
  ];

  const features = [
    {
      icon: <Globe className="w-5 h-5 text-[#3E6BFF]" />,
      title: '26+ Circle CCTP Domains',
      description:
        'Full support for Ethereum, Arbitrum, Optimism, Solana, Polygon, Base, Avalanche, and all active CCTP chains.',
      codeSnippet: `import { Domains } from '@anchor-cctp/core-sdk';\n\nconst dest = Domains.STELLAR; // Domain 27\nconst src = Domains.ETHEREUM; // Domain 0`,
    },
    {
      icon: <Lock className="w-5 h-5 text-emerald-400" />,
      title: 'Cryptographic Proof Verification',
      description:
        'Circle Iris API integration with exponential backoff and ECDSA signature checks prior to contract execution.',
      codeSnippet: `const proof = await irisApi.getAttestation({\n  txHash: burnTxHash,\n  retries: 5,\n});`,
    },
    {
      icon: <ArrowsClockwise className="w-5 h-5 text-cyan-400" />,
      title: 'Lossless Decimal Scaling (6 to 7 Stroops)',
      description:
        'Integer math preserves exact value between 6-decimal EVM/SVM tokens and 7-decimal Stellar Stroops.',
      codeSnippet: `// 1 USDC (6 decimals) -> 10,000,000 stroops\nconst stroopAmount = DecimalMath.scaleToStroop(\n  amount,\n  sourceDecimals\n);`,
    },
    {
      icon: <Cpu className="w-5 h-5 text-purple-400" />,
      title: 'Soroban Forwarder Contract',
      description:
        'Delegated minting contract with automated trustline creation and a strict 2 XLM reserve ceiling.',
      codeSnippet: `await forwarderContract.invoke({\n  method: "receive",\n  args: [recipient, amount, attestation]\n});`,
    },
    {
      icon: <SealCheck className="w-5 h-5 text-amber-400" />,
      title: 'Replay Guard & Idempotency',
      description:
        'Prevents double-crediting by tracking processed burn hashes in an append-only transaction store.',
      codeSnippet: `if (await store.isBurnProcessed(hash)) {\n  throw new ReplayError("Transaction already minted");\n}`,
    },
    {
      icon: <ShieldWarning className="w-5 h-5 text-[#3E6BFF]" />,
      title: 'SEP-CCTP Ecosystem Standards',
      description:
        'Stellar ecosystem standard extending stellar.toml with verified forwarder addresses and dust collector rules.',
      codeSnippet: `[[CCTP_ISSUERS]]\ndomain = 27\nissuer = "G..."\nforwarder = "C..."`,
    },
  ];

  return (
    <section id="features" className="py-16 relative bg-slate-50 dark:bg-slate-950 w-full">
      <div className="w-full max-w-[1700px] mx-auto px-6 sm:px-10 lg:px-16 space-y-16">
        {/* Section 1: Buying Workflow Timeline */}
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="space-y-2 text-left"
          >
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight sm:text-4xl">
              CCTP Ingestion Lifecycle
            </h2>
            <p className="text-slate-300 max-w-xl text-sm font-medium">
              From source transaction burn to final USDC settlement on Soroban Stellar.
            </p>
          </motion.div>

          {/* Creative Curved Arrow Map */}
          <div ref={mapRef} className="relative max-w-6xl mx-auto py-16 mt-16 md:mt-24">
            {/* Custom SVG Curved Path (Desktop) */}
            <svg className="absolute left-0 top-0 w-full h-full hidden md:block pointer-events-none z-0" viewBox="0 0 1000 800" preserveAspectRatio="none">
              <path
                d="M 500 0 C 800 150, 800 350, 500 400 C 200 450, 200 650, 500 800"
                fill="none"
                stroke="rgba(62, 107, 255, 0.15)"
                strokeWidth="4"
                strokeDasharray="8 8"
              />
              <motion.path
                d="M 500 0 C 800 150, 800 350, 500 400 C 200 450, 200 650, 500 800"
                fill="none"
                stroke="#3E6BFF"
                strokeWidth="4"
                strokeLinecap="round"
                style={{ pathLength }}
              />
            </svg>

            <div className="space-y-32 relative z-10 px-4 md:px-0">
              {steps.map((item, idx) => {
                // Position logic: Step 1 (Left), Step 2 (Right), Step 3 (Left), Step 4 (Right)
                const isLeft = idx % 2 === 0;
                const flexAlign = isLeft ? 'md:items-start md:pl-24 lg:pl-32' : 'md:items-end md:pr-24 lg:pr-32';
                
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ type: "spring", stiffness: 80, damping: 20, delay: 0.1 }}
                    className={`flex flex-col w-full relative ${flexAlign}`}
                  >
                    <div className="relative max-w-lg w-full group cursor-default">
                      {/* Huge Background Number */}
                      <div className="absolute -left-10 md:-left-20 -top-16 md:-top-24 text-[120px] md:text-[160px] font-black text-slate-800/30 group-hover:text-[#3E6BFF]/10 transition-colors duration-700 select-none z-0 tracking-tighter">
                        {item.step}
                      </div>

                      {/* Content without traditional card borders */}
                      <div className="relative z-10 pl-6 border-l-2 border-[#3E6BFF]/30 group-hover:border-[#3E6BFF] transition-colors duration-500 space-y-4">
                        <div className="inline-block relative">
                          <span className="text-xs font-black uppercase tracking-widest text-[#3E6BFF] bg-[#3E6BFF]/10 px-3 py-1 rounded-sm">
                            {item.badge}
                          </span>
                        </div>
                        <h3 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                          {item.title}
                        </h3>
                        <p className="text-lg text-slate-400 leading-relaxed font-medium">
                          {item.description}
                        </p>
                      </div>

                      {/* Floating glowing dot anchor */}
                      <div className={`absolute top-4 w-3 h-3 rounded-full bg-[#3E6BFF] shadow-[0_0_20px_#3E6BFF] hidden md:block transition-all duration-500 group-hover:scale-150 ${isLeft ? '-left-[4.5px]' : '-left-[4.5px]'}`} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 2: Core Capabilities Editorial Index (Cardless) */}
        <div className="pt-32 pb-24 border-t border-slate-800/50 mt-12">
          <div className="flex flex-col lg:flex-row gap-16 lg:gap-24 relative">
            
            {/* Sticky Header */}
            <div className="lg:w-5/12 relative">
              <div className="sticky top-40 space-y-6">
                <h3 className="text-4xl md:text-6xl lg:text-7xl font-black text-white tracking-tighter leading-[1.1]">
                  Cross-Chain <br className="hidden lg:block"/> Core <br className="hidden lg:block"/> Engine
                </h3>
                <p className="text-slate-400 text-base md:text-lg font-medium leading-relaxed max-w-sm">
                  Deterministic security guarantees and developer primitives for liquidity movement across Stellar.
                </p>
                <div className="hidden lg:block pt-8">
                  <div className="w-20 h-1 bg-[#3E6BFF] rounded-full" />
                </div>
              </div>
            </div>

            {/* Editorial List (Absolutely No Cards) */}
            <div className="lg:w-7/12 flex flex-col">
              {features.map((feat, idx) => (
                <motion.div
                  key={idx}
                  initial="inactive"
                  whileInView="active"
                  viewport={{ margin: "-35% 0px -35% 0px", amount: "some" }}
                  variants={{
                    inactive: { opacity: 0.4, scale: 0.98 },
                    active: { opacity: 1, scale: 1 }
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="relative flex flex-col md:flex-row md:items-start gap-6 md:gap-10 py-10 md:py-16 border-b border-slate-800/60 transition-colors duration-500 first:border-t"
                >
                  {/* Glowing Icon (Scroll-Activated) */}
                  <motion.div 
                    variants={{
                      inactive: { color: "#475569" }, // slate-600
                      active: { color: "#3E6BFF" }
                    }}
                    className="relative shrink-0 mt-1 transition-colors duration-500"
                  >
                    <motion.div 
                      variants={{ inactive: { opacity: 0 }, active: { opacity: 0.4 } }}
                      className="absolute inset-0 bg-[#3E6BFF] blur-2xl transition-opacity duration-500" 
                    />
                    {React.cloneElement(feat.icon as React.ReactElement, { className: "w-10 h-10 md:w-12 md:h-12 relative z-10" })}
                  </motion.div>

                  {/* Text Content */}
                  <div className="space-y-4 flex-grow max-w-full overflow-hidden">
                    <motion.h4 
                      variants={{ inactive: { x: 0, color: "#e2e8f0" }, active: { x: 8, color: "#ffffff" } }}
                      className="text-2xl md:text-3xl font-extrabold tracking-tight transition-all duration-500"
                    >
                      {feat.title}
                    </motion.h4>
                    <motion.p 
                      variants={{ inactive: { color: "#94a3b8" }, active: { color: "#cbd5e1" } }}
                      className="text-sm md:text-base font-medium leading-relaxed max-w-xl transition-colors duration-500"
                    >
                      {feat.description}
                    </motion.p>
                    
                    {/* Expandable Code Snippet (Reveals on Scroll Active) */}
                    <motion.div 
                      initial="inactive"
                      whileInView="active"
                      viewport={{ margin: "-35% 0px -35% 0px", amount: "some" }}
                      variants={{ 
                        inactive: { maxHeight: 0, opacity: 0, marginTop: 0 }, 
                        active: { maxHeight: 500, opacity: 1, marginTop: 24 } 
                      }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="bg-[#070b14] rounded-xl p-4 md:p-5 border border-slate-800/80 shadow-2xl relative">
                        {/* Fake Window Dots */}
                        <div className="flex gap-1.5 mb-3">
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                        </div>
                        <pre className="font-mono text-[11px] sm:text-xs text-[#89ddff] overflow-x-auto whitespace-pre">
                          <code>{feat.codeSnippet}</code>
                        </pre>
                      </div>
                    </motion.div>
                  </div>
                  
                  {/* Minimalist Arrow (Appears on Active) */}
                  <motion.div 
                    variants={{ inactive: { opacity: 0, x: -16 }, active: { opacity: 1, x: 0 } }}
                    className="hidden md:flex shrink-0 transition-all duration-500 mt-2"
                  >
                    <ArrowRight className="w-8 h-8 text-[#3E6BFF]" />
                  </motion.div>
                </motion.div>
              ))}
            </div>
            
          </div>
        </div>
      </div>
    </section>
  );
};
