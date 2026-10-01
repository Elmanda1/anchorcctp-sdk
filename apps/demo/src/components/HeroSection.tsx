import React from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowRight, Terminal } from '@phosphor-icons/react';

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

/**
 * Brand marks that ride the attestation ring on hover — six of the CCTP source
 * chains a deposit can originate from. Each sits on a light plate so dark brand
 * marks (Ethereum's greys, Arbitrum's navy) stay legible against the dark hero.
 * Angles are chosen just off the vertical axis so no chip lands on the
 * artwork's flame or anchor tips.
 */
const ORBIT_CHAINS = [
  { src: '/logos/ethereum.svg', label: 'Ethereum', angle: 30 },
  { src: '/logos/arbitrum.svg', label: 'Arbitrum', angle: 90 },
  { src: '/logos/base.svg', label: 'Base', angle: 150 },
  { src: '/logos/solana.svg', label: 'Solana', angle: 210 },
  { src: '/logos/polygon.svg', label: 'Polygon', angle: 270 },
  { src: '/logos/avalanche.svg', label: 'Avalanche', angle: 330 },
];

/** Ring radius as a percentage of the square logo box. */
const ORBIT_RADIUS = 47;

const polar = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { left: `${50 + ORBIT_RADIUS * Math.sin(rad)}%`, top: `${50 - ORBIT_RADIUS * Math.cos(rad)}%` };
};

const chipVariants = {
  rest: { opacity: 0, scale: 0.5 },
  hover: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 260, damping: 18 },
  },
};

const ringContainerVariants = {
  rest: {},
  hover: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};

const ringLineVariants = {
  rest: { opacity: 0, scale: 0.92 },
  hover: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: 'easeOut' as const } },
};

const glowVariants = {
  rest: { opacity: 0.35, scale: 0.9 },
  hover: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

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

          {/* Right Column: pointer-tilted logo wrapped in an attestation ring */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:col-span-5 flex justify-center items-center relative overflow-visible"
            style={{ perspective: 1000 }}
          >
            <motion.div
              role="img"
              aria-label="AnchorCCTP logo — anchor fused with the Stellar orbit mark, ringed by logos of the source chains a deposit can come from"
              tabIndex={0}
              initial="rest"
              animate="rest"
              whileHover="hover"
              whileFocus="hover"
              variants={ringContainerVariants}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onFocus={onLeave}
              className="group relative shrink-0 w-[420px] h-[420px] sm:w-[540px] sm:h-[540px] lg:w-[650px] lg:h-[650px] outline-none focus-visible:ring-2 focus-visible:ring-[#3E6BFF] focus-visible:ring-offset-4 focus-visible:ring-offset-[#070C18] rounded-full"
            >
              {/* Ambient bloom, brightening on hover */}
              <motion.span
                aria-hidden="true"
                variants={glowVariants}
                className="pointer-events-none absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(62,107,255,0.55)_0%,rgba(6,182,212,0.18)_45%,transparent_72%)] blur-3xl"
              />

              {/* Dashed orbit — spins only while hovered/focused (see .orbit-ring) */}
              <motion.span
                aria-hidden="true"
                variants={ringLineVariants}
                className="orbit-ring pointer-events-none absolute -inset-[4%] rounded-full border border-dashed border-[#3E6BFF]/45"
              />

              <motion.img
                src="/assets/img/final.svg"
                alt=""
                style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
                className="relative z-10 w-full h-full object-contain drop-shadow-[0_20px_50px_rgba(62,107,255,0.2)] transition-[filter] duration-500 group-hover:drop-shadow-[0_28px_80px_rgba(62,107,255,0.45)] group-focus-visible:drop-shadow-[0_28px_80px_rgba(62,107,255,0.45)] motion-reduce:transition-none"
              />

              {/* Source-chain marks orbiting the artwork, staggered in on hover */}
              <span aria-hidden="true" className="absolute inset-0 z-20">
                {ORBIT_CHAINS.map(({ src, label, angle }) => (
                  <motion.span
                    key={label}
                    variants={chipVariants}
                    style={polar(angle)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/95 ring-1 ring-white/25 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.9)] transition-shadow duration-500 group-hover:ring-2 group-hover:ring-[#3E6BFF]/70 group-focus-visible:ring-2 group-focus-visible:ring-[#3E6BFF]/70 motion-reduce:transition-none"
                  >
                    <img
                      src={src}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      className="w-6 h-6 sm:w-[26px] sm:h-[26px] object-contain select-none"
                    />
                  </motion.span>
                ))}
              </span>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
