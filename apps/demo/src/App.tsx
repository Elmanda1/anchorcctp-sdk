import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedNavbar } from './components/ui/AnimatedNavbar';
import { HeroSection } from './components/HeroSection';
import { CatalogSection } from './components/CatalogSection';
import { ShowcaseSection } from './components/ShowcaseSection';
import { WorkflowSection } from './components/WorkflowSection';
import { SecuritySection } from './components/SecuritySection';
import { FaqSection } from './components/FaqSection';
import { AnimatedFooter } from './components/ui/AnimatedFooter';
import { WalletState, connectFreighter } from './wallet/freighter';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { TermsOfServicePage } from './components/TermsOfServicePage';
import { SupportPage } from './components/SupportPage';

export function App() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
  });
  const [activeSection, setActiveSection] = useState<string>('hero');
  const [currentPage, setCurrentPage] = useState<'home' | 'privacy' | 'terms' | 'support'>('home');

  const handleConnectWallet = async () => {
    const res = await connectFreighter();
    setWallet(res);
  };

  useEffect(() => {
    connectFreighter({ silent: true }).then((res) => {
      if (res.connected) {
        setWallet(res);
      }
    });
  }, []);

  const scrollToDemo = () => {
    setActiveSection('catalog');
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToDocs = () => {
    const url =
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DOCS_URL ??
      '/docs/';
    window.open(url, '_blank', 'noreferrer');
  };

  const pageVariants = {
    initial: { opacity: 0, y: 20, filter: 'blur(8px)' },
    in: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
    out: { opacity: 0, y: -20, filter: 'blur(8px)', transition: { duration: 0.4, ease: [0.7, 0, 0.84, 0] } },
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-[#070C18] text-slate-100 selection:bg-[#3E6BFF] selection:text-white bg-grid-lines font-sans">
      {/* Background Ambient Glows */}
      <div className="bg-mesh-glow">
        <div className="bg-blob-1" />
        <div className="bg-blob-2" />
      </div>

      <AnimatedNavbar
        wallet={wallet}
        onConnect={handleConnectWallet}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        onNavigate={setCurrentPage}
      />

      {/* Main content with padding so navbar doesn't overlap */}
      <main className="relative z-10 w-full flex-grow flex flex-col pt-32 lg:pt-40 pb-16">
        <AnimatePresence mode="wait">
          {currentPage === 'home' && (
            <motion.div
              key="home"
              initial="initial"
              animate="in"
              exit="out"
              variants={pageVariants}
              className="w-full flex flex-col space-y-16"
            >
              <HeroSection
                onExploreDemo={scrollToDemo}
                onExploreDocs={scrollToDocs}
              />
              <CatalogSection
                wallet={wallet}
                onConnectWallet={handleConnectWallet}
              />
              <WorkflowSection />
              <SecuritySection />
              <FaqSection />
            </motion.div>
          )}
          {currentPage === 'privacy' && (
            <motion.div key="privacy" initial="initial" animate="in" exit="out" variants={pageVariants} className="w-full">
              <PrivacyPolicyPage onNavigate={setCurrentPage} />
            </motion.div>
          )}
          {currentPage === 'terms' && (
            <motion.div key="terms" initial="initial" animate="in" exit="out" variants={pageVariants} className="w-full">
              <TermsOfServicePage onNavigate={setCurrentPage} />
            </motion.div>
          )}
          {currentPage === 'support' && (
            <motion.div key="support" initial="initial" animate="in" exit="out" variants={pageVariants} className="w-full">
              <SupportPage onNavigate={setCurrentPage} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatedFooter onNavigate={setCurrentPage} />
    </div>
  );
}

export default App;
