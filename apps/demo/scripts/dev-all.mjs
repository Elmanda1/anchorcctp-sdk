// Spawns event server + vite together. Ctrl+C stops both.
// Real mode default (SIM_MODE=false): server needs STELLAR_SECRET.
// Maps repo root .env.testnet (STELLAR_TESTNET_*) when STELLAR_SECRET is unset.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal KEY=VALUE reader — the repo has no dotenv dependency. */
function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const demoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverEnv = { ...process.env };

if ((serverEnv.SIM_MODE ?? 'false').toLowerCase() !== 'true' && !serverEnv.STELLAR_SECRET) {
  const testnetEnv = join(demoDir, '..', '..', '.env.testnet');
  if (existsSync(testnetEnv)) {
    for (const [k, v] of Object.entries(readEnvFile(testnetEnv))) serverEnv[k] ??= v;
    serverEnv.STELLAR_SECRET ??= serverEnv.STELLAR_TESTNET_SECRET;
    serverEnv.STELLAR_DESTINATION ??= serverEnv.STELLAR_TESTNET_DESTINATION;
    serverEnv.STELLAR_NETWORK ??= 'testnet';
    // Forward CCTP/Stellar wiring when present in root .env.testnet (plain or TESTNET_ prefix).
    // dev-only testnet defaults last: real deploys must set explicit env.
    serverEnv.FORWARDER_CONTRACT_ID ??=
      serverEnv.TESTNET_FORWARDER_CONTRACT_ID ??
      'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ';
    serverEnv.USDC_ISSUER ??=
      serverEnv.STELLAR_USDC_ISSUER ??
      serverEnv.TESTNET_USDC_ISSUER ??
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    serverEnv.TRUSTLINE_ALLOW_CREATION ??= serverEnv.TESTNET_TRUSTLINE_ALLOW_CREATION ?? 'true';
    serverEnv.SPEND_CAP_XLM ??= serverEnv.STELLAR_SPEND_CAP_XLM ?? serverEnv.TESTNET_SPEND_CAP_XLM;
    serverEnv.REPLAY_STORE_PATH ??= './data/replay.json';
    serverEnv.MAX_MINT_AMOUNT_USDC ??= serverEnv.TESTNET_MAX_MINT_AMOUNT_USDC;
    // esbuild'd serve.cjs resolves relative REPLAY_STORE_PATH against its own CWD —
    // dev-all always runs from apps/demo, so materialize that dir up front.
    try {
      mkdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data'), { recursive: true });
    } catch { /* exists / read-only — serve.cjs reports */ }
    serverEnv.CIRCLE_ATTESTATION_BASE_URL ??= serverEnv.STELLAR_NETWORK === 'mainnet'
      ? 'https://iris-api.circle.com'
      : 'https://iris-api-sandbox.circle.com';
    serverEnv.SOROBAN_RPC_URL ??= 'https://soroban-testnet.stellar.org';
    serverEnv.HORIZON_URL ??= 'https://horizon-testnet.stellar.org';
    console.log('[dev-all] real mode: mapped STELLAR_TESTNET_* from root .env.testnet');
  }
}

// The server reads CIRCLE_ATTESTATION_BASE_URL, but apps/demo/.env only exposes it to
// the browser as VITE_ATTESTATION_URL. Without this bridge the server has no Iris
// endpoint and answers every /api/fees with 503.
const demoEnv = readEnvFile(join(demoDir, '.env'));
serverEnv.CIRCLE_ATTESTATION_BASE_URL ??=
  demoEnv.CIRCLE_ATTESTATION_BASE_URL ?? demoEnv.VITE_ATTESTATION_URL;

// Same VITE_/server split as the attestation URL: core reads the bare names, the demo
// env only defines the VITE_ ones. Left unset, the forwarder silently falls back to
// core's TESTNET_FORWARDER default instead of the contract this config names.
serverEnv.FORWARDER_CONTRACT_ID ??=
  demoEnv.FORWARDER_CONTRACT_ID ?? demoEnv.VITE_FORWARDER_CONTRACT_ID;
serverEnv.DUST_COLLECTOR_ADDRESS ??=
  demoEnv.DUST_COLLECTOR_ADDRESS ?? demoEnv.VITE_DUST_COLLECTOR_ADDRESS;

const procs = [
  spawn('node', ['dist-server/serve.cjs'], {
    env: { ...serverEnv, SIM_MODE: serverEnv.SIM_MODE ?? 'false', PORT: serverEnv.PORT ?? '3001' },
    stdio: 'inherit',
  }),
  spawn('npx', ['vite'], { env: process.env, stdio: 'inherit', shell: true }),
];

const kill = () => { for (const p of procs) p.kill('SIGINT'); };
process.on('SIGINT', () => { kill(); process.exit(0); });
process.on('exit', kill);
for (const p of procs) {
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) { kill(); process.exit(code); }
  });
}
