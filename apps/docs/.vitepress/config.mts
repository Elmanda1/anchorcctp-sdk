import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AnchorCCTP Docs',
  titleTemplate: ':title — AnchorCCTP Docs',
  description: 'Accept USDC from any CCTP-connected chain on Stellar with a single function call.',
  base: '/docs/',
  appearance: 'dark',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs/assets/img/final.svg' }],
    ['meta', { name: 'theme-color', content: '#070C18' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'AnchorCCTP Docs' }],
    ['meta', { property: 'og:title', content: 'AnchorCCTP Docs' }],
    ['meta', { property: 'og:description', content: 'Accept USDC from any CCTP-connected chain on Stellar with a single function call.' }],
  ],
  themeConfig: {
    logo: '/assets/img/final.svg',
    siteTitle: 'AnchorCCTP Docs',
    socialLinks: [{ icon: 'github', link: 'https://github.com/Dyjuen/anchorcctp-sdk' }],
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/overview/what' },
      { text: 'CLI', link: '/cli/overview' },
      { text: 'Core', link: '/core/overview' },
      { text: 'SEP-CCTP', link: '/sep/overview' },
      { text: 'Demo', link: process.env.VITE_DEMO_URL ?? '/' },
    ],
    sidebar: [
      {
        text: 'Overview',
        collapsed: true,
        items: [
          { text: 'What is AnchorCCTP', link: '/overview/what' },
          { text: 'Why it exists', link: '/overview/why' },
          { text: 'How it works', link: '/overview/how-it-works' },
        ],
      },
      {
        text: 'Getting started',
        collapsed: true,
        items: [
          { text: 'Requirements', link: '/start/requirements' },
          { text: 'Try it in one command', link: '/start/try-it' },
          { text: 'Quick setup', link: '/start/quick-setup' },
        ],
      },
      {
        text: 'Install',
        collapsed: true,
        items: [
          { text: 'Packages', link: '/install/packages' },
          { text: 'From source', link: '/install/from-source' },
          { text: 'Verify the install', link: '/install/verify' },
        ],
      },
      {
        text: 'CLI guide',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/cli/overview' },
          { text: 'init', link: '/cli/init' },
          { text: 'listen', link: '/cli/listen' },
          { text: 'verify', link: '/cli/verify' },
          { text: 'domains', link: '/cli/domains' },
          { text: 'Exit codes', link: '/cli/exit-codes' },
          { text: 'Reading output', link: '/cli/reading-output' },
        ],
      },
      {
        text: 'Core guide',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/core/overview' },
          { text: 'Install & usage', link: '/core/install-usage' },
          { text: 'Attestation polling', link: '/core/attestation' },
          { text: 'Decimals & dust', link: '/core/decimals-dust' },
          { text: 'Forwarder & addresses', link: '/core/forwarder' },
          { text: 'Trustlines', link: '/core/trustline' },
          { text: 'Replay protection', link: '/core/replay' },
          { text: 'Events & errors', link: '/core/events-errors' },
        ],
      },
      {
        text: 'Demo',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/demo/overview' },
          { text: 'Freighter', link: '/demo/freighter' },
          { text: 'Vercel API', link: '/demo/vercel-api' },
        ],
      },
      {
        text: 'Configuration',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/configuration/overview' },
          { text: 'Networks', link: '/configuration/networks' },
          { text: 'Keys & secrets', link: '/configuration/keys' },
          { text: 'testnet:auto', link: '/configuration/testnet-auto' },
        ],
      },
      {
        text: 'Domain catalogue',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/domains/overview' },
          { text: 'Domain table', link: '/domains/table' },
        ],
      },
      {
        text: 'SEP-CCTP',
        collapsed: true,
        items: [{ text: 'Specification', link: '/sep/overview' }],
      },
      {
        text: 'Security',
        collapsed: true,
        items: [
          { text: 'Policy', link: '/security/overview' },
          { text: 'Audit status', link: '/security/audit-status' },
        ],
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'Migration guide', link: '/migration' },
          { text: 'Evidence', link: '/evidence' },
        ],
      },
    ],
    footer: {
      message: 'MIT © Mother\u2019s Grace (Juen). Not audited — see Security.',
      copyright: 'AnchorCCTP SDK',
    },
  },
});


