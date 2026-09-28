"use client";

import * as React from "react";
import { motion, useScroll, useMotionValueEvent, useTransform } from "framer-motion";
import { Menu, Wallet } from "lucide-react";
import { cn } from "../../lib/utils";

import { WalletState } from "../../wallet/freighter";

interface AnimatedNavProps {
  wallet?: WalletState;
  onConnect?: () => void;
  activeSection?: string;
  setActiveSection?: (s: string) => void;
  onNavigate?: (page: 'home' | 'privacy' | 'terms' | 'support') => void;
}

const navItems = [
  { name: "Home", href: "#hero", id: "hero" },
  { name: "How to use", href: "#catalog", id: "catalog" },
  { name: "How It Works", href: "#features", id: "features" },
  { name: "FAQ", href: "#faq", id: "faq" },
];

const EXPAND_SCROLL_THRESHOLD = 80;

// Docs site (VitePress, same domain in prod at /docs).
// Override locally with VITE_DOCS_URL=http://localhost:5174/docs/
export const DOCS_URL: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DOCS_URL ??
  '/docs/';

const containerVariants = {
  expanded: {
    y: 0,
    opacity: 1,
    left: "50%",
    x: "-50%",
    width: "auto",
    transition: {
      type: "spring",
      stiffness: 70,
      damping: 20,
      mass: 1,
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
  collapsed: {
    y: 0,
    opacity: 1,
    left: "2rem",
    x: "0%",
    width: "3.5rem",
    transition: {
      type: "spring",
      stiffness: 70,
      damping: 20,
      mass: 1,
      when: "afterChildren",
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

const logoVariants = {
  expanded: { opacity: 1, scale: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  collapsed: { opacity: 0, scale: 0.8, x: -10, transition: { duration: 0.2 } },
};

const itemVariants = {
  expanded: { opacity: 1, scale: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  collapsed: { opacity: 0, scale: 0.8, x: -10, transition: { duration: 0.15 } },
};

const collapsedIconVariants = {
  expanded: { opacity: 0, scale: 0.6, rotate: -45, transition: { duration: 0.2 } },
  collapsed: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: {
      type: "spring",
      stiffness: 150,
      damping: 15,
      delay: 0.1,
    }
  },
};

export function AnimatedNavbar({ wallet, onConnect, activeSection, setActiveSection, onNavigate }: AnimatedNavProps) {
  const [isExpanded, setExpanded] = React.useState(true);

  const { scrollY } = useScroll();
  const lastScrollY = React.useRef(0);
  const scrollPositionOnCollapse = React.useRef(0);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = lastScrollY.current;

    // Hide navbar if near the bottom of the page (footer)
    const isAtBottom = typeof window !== 'undefined' &&
      (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200);

    if (isAtBottom) {
      setExpanded(false);
      scrollPositionOnCollapse.current = latest;
    } else if (isExpanded && latest > previous && latest > 150) {
      setExpanded(false);
      scrollPositionOnCollapse.current = latest;
    } else if (!isExpanded && !isAtBottom && latest < previous && (scrollPositionOnCollapse.current - latest > EXPAND_SCROLL_THRESHOLD)) {
      setExpanded(true);
    }

    lastScrollY.current = latest;
  });

  const handleNavClick = (e: React.MouseEvent) => {
    if (!isExpanded) {
      e.preventDefault();
      setExpanded(true);
    }
  };

  const footerOpacity = useTransform(scrollY, (y) => {
    if (typeof window === 'undefined') return 1;
    return window.innerHeight + y >= document.body.offsetHeight - 200 ? 0 : 1;
  });

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={isExpanded ? "expanded" : "collapsed"}
      variants={containerVariants}
      whileHover={!isExpanded ? { scale: 1.1 } : {}}
      whileTap={!isExpanded ? { scale: 0.95 } : {}}
      onClick={handleNavClick}
      style={{
        opacity: footerOpacity,
        pointerEvents: isExpanded || !isExpanded ? 'auto' : 'none',
      }}
      className={cn(
        "fixed top-6 z-50 flex items-center justify-between overflow-hidden rounded-full border border-slate-800/90 bg-slate-900/95 shadow-2xl backdrop-blur-xl h-14 sm:h-16 px-6 sm:px-8 max-w-[92vw]",
        !isExpanded && "cursor-pointer justify-center px-0 h-14"
      )}
    >
      {/* Left Brand Logo Icon only */}
      <motion.div
        variants={logoVariants}
        className="flex-shrink-0 flex items-center font-semibold cursor-pointer pr-2"
        onClick={() => {
          onNavigate?.('home');
          setActiveSection?.('hero');
          document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        <img src="/assets/img/final.svg" alt="Anchor CCTP Logo" className="h-7 w-7 object-contain" />
      </motion.div>

      {/* Nav Links */}
      <motion.div
        variants={itemVariants}
        className={cn(
          "flex items-center gap-1 sm:gap-3 px-2 sm:px-4",
          !isExpanded && "pointer-events-none opacity-0 transition-opacity duration-200"
        )}
      >
        {navItems.map((item) => (
          <motion.a
            key={item.name}
            href={item.href}
            variants={itemVariants}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveSection?.(item.id);
              document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
            }}
            className={cn(
              "text-xs sm:text-sm font-extrabold transition-all px-4 py-2 rounded-full cursor-pointer whitespace-nowrap",
              activeSection === item.id
                ? "text-white bg-[#3E6BFF] shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            )}
          >
            {item.name}
          </motion.a>
        ))}
      </motion.div>

      {/* Right Controls */}
      <motion.div
        variants={itemVariants}
        className={cn(
          "flex items-center space-x-3 pl-2",
          !isExpanded && "pointer-events-none opacity-0 transition-opacity duration-200"
        )}
      >
        <motion.a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          variants={itemVariants}
          onClick={(e) => e.stopPropagation()}
          className="text-xs sm:text-sm font-extrabold transition-all px-4 py-2 rounded-full cursor-pointer whitespace-nowrap text-slate-300 hover:text-white hover:bg-slate-800/60"
        >
          Docs
        </motion.a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onConnect?.();
          }}
          className="text-xs font-extrabold bg-[#3E6BFF] hover:bg-[#345CE0] text-white px-5 py-2.5 rounded-full transition-all shadow-md cursor-pointer shrink-0 whitespace-nowrap flex items-center"
        >
          <Wallet className="w-4 h-4 mr-2" />
          <span>{wallet?.connected ? `${wallet.address?.slice(0, 6)}...${wallet.address?.slice(-4)}` : "Connect Wallet"}</span>
        </button>
      </motion.div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          variants={collapsedIconVariants}
          animate={isExpanded ? "expanded" : "collapsed"}
        >
          <Menu className="h-5 w-5 text-white" />
        </motion.div>
      </div>
    </motion.nav>
  );
}
