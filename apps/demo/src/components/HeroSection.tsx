import React from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowRight, Terminal } from 'lucide-react';

interface HeroSectionProps {
  onExploreDemo: () => void;
  onExploreDocs: () => void;
}

/**
 * Logo tilt driven directly by the pointer: the artwork leans toward the
 * cursor while hovered and settles back on leave. No loops, no autoplay.
 */
function useLogoTilt() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 180, damping: 22 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 180, damping: 22 });

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };
  return { rotateX, rotateY, onMove, onLeave };
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onExploreDemo,
  onExploreDocs,
}) => {
  const { rotateX, rotateY, onMove, onLeave } = useLogoTilt();

  return (
    <section className="relative pt-8 pb-16 overflow-hidden border-b border-slate-800/80 w-full">
      <div className="w-full max-w-[1700px] mx-auto px-6 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="lg:col-span-7 space-y-6 text-left"
          >

            {/* Main Title — gradient reserved for the single action word */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.08]">
              Cross-Chain USDC <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3E6BFF] via-[#60A5FA] to-[#06B6D4]">
                Settlement
              </span> <br />
              for Stellar Anchors.
            </h1>

            {/* Description */}
            <p className="text-slate-300 text-base sm:text-lg max-w-2xl leading-relaxed font-medium">
              Accept 1:1 USDC deposits from <strong className="text-white">26+ Circle CCTP domains</strong> directly on Stellar. Verified via Circle Iris attestation, executed on Soroban, with automatic 6-to-7 decimal Stroop conversion.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onExploreDemo}
                className="px-7 py-4 rounded-full font-extrabold text-sm bg-[#3E6BFF] hover:bg-[#345CE0] text-white shadow-lg flex items-center justify-center space-x-2 cursor-pointer"
              >
                <span>View catalog & demo</span>
                <ArrowRight className="w-4 h-4" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onExploreDocs}
                className="px-7 py-4 rounded-full font-extrabold text-sm bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700/60 flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Terminal className="w-4 h-4 text-slate-400" />
                <span>SDK Documentation</span>
              </motion.button>
            </div>
          </motion.div>

          {/* Right Column: logo with pointer tilt, sheen sweep, and hover reveal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:col-span-5 flex justify-center items-center relative overflow-visible"
            style={{ perspective: 1000 }}
          >
            <div
              role="img"
              aria-label="AnchorCCTP logo — anchor fused with the Stellar orbit mark"
              tabIndex={0}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onFocus={onLeave}
              className="group relative w-full flex items-center justify-center shrink-0 py-4 outline-none focus-visible:ring-2 focus-visible:ring-[#3E6BFF] focus-visible:ring-offset-4 focus-visible:ring-offset-[#070C18] rounded-3xl"
            >
              <motion.img
                src="/assets/img/final.svg"
                alt=""
                style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
                className="w-[420px] h-[420px] sm:w-[540px] sm:h-[540px] lg:w-[650px] lg:h-[650px] object-contain drop-shadow-[0_20px_50px_rgba(62,107,255,0.2)] transition-[filter] duration-500 group-hover:drop-shadow-[0_28px_80px_rgba(62,107,255,0.45)] group-focus-visible:drop-shadow-[0_28px_80px_rgba(62,107,255,0.45)] motion-reduce:transition-none"
              />
              {/* Sheen sweep — one pass per hover entry, then rests */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-8 left-1/2 w-1/3 -translate-x-[320%] skew-x-[-14deg] bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-all duration-1000 ease-out group-hover:translate-x-[220%] group-hover:opacity-100 group-focus-visible:translate-x-[220%] group-focus-visible:opacity-100 motion-reduce:hidden"
              />
              {/* Hover reveal — real settlement facts, keyboard reachable via focus */}
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 translate-y-3 opacity-0 transition-all duration-400 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
                <p className="whitespace-nowrap rounded-xl border border-slate-700/70 bg-slate-950/90 px-4 py-2.5 font-mono text-[11px] text-slate-200 shadow-xl">
                  burn <span className="text-slate-500">→</span> attest <span className="text-slate-500">→</span> <span className="text-white font-bold">settle on Stellar</span>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
