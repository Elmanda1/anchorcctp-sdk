/**
 * Mainnet deploy/setup script.
 *
 * Generates (or reuses) Stellar mainnet distribution + fee accounts.
 * Mainnet has NO friendbot — funding happens via exchange/CEX withdrawal
 * or a funded sponsor account. This script never funds, only generates keys.
 *
 * Writes TWO files with different trust levels:
 * - public JSON (committable): addresses, contract IDs, URLs. No secrets ever.
 * - .env.mainnet (gitignored, mode 0600): S... secrets. Never logged/printed.
 *
 * stdout: result JSON only. stderr: human context. Secrets never touch stdout.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/mainnet-deploy.ts [--out config/mainnet.public.json] [--env-out .env.mainnet] [--distribution G...] [--fee G...] [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { MAINNET_FORWARDER } from '../packages/core/src/forwarder/index.js';

const HORIZON = 'https://horizon.stellar.org';
const RPC = 'https://soroban-mainnet.stellar.org';
const ATTEST = 'https://iris-api.circle.com';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Scoped launch: Ethereum (0) + Base (6) only. Verify on Etherscan/Basescan before funding.
const EVM = {
  ethereum: {
    domain: 0,
    chainId: 1,
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  base: {
    domain: 6,
    chainId: 8453,
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913',
  },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const outPath = arg('--out') || 'config/mainnet.public.json';
const envPath = arg('--env-out') || '.env.mainnet';
const reuseDistribution = arg('--distribution');
const reuseFee = arg('--fee');
const force = flag('--force');

function isG(v: unknown): v is string {
  return typeof v === 'string' && StrKey.isValidEd25519PublicKey(v);
}

async function main(): Promise<void> {
  let distribution = reuseDistribution;
  let fee = reuseFee;
  let distributionSecret: string | undefined;
  let feeSecret: string | undefined;

  if (distribution && !isG(distribution)) throw new Error('invalid --distribution G... address');
  if (fee && !isG(fee)) throw new Error('invalid --fee G... address');

  if (!distribution) {
    const kp = Keypair.random();
    distribution = kp.publicKey();
    distributionSecret = kp.secret();
  } else {
    console.error(`[INFO] Reusing distribution ${distribution} (no secret handled).`);
  }
  if (!fee) {
    const kp = Keypair.random();
    fee = kp.publicKey();
    feeSecret = kp.secret();
  } else {
    console.error(`[INFO] Reusing fee account ${fee} (no secret handled).`);
  }

  const publicConfig = {
    network: 'mainnet',
    horizonUrl: HORIZON,
    sorobanRpcUrl: RPC,
    attestationBaseUrl: ATTEST,
    attestationV2Pattern: 'GET {base}/v2/messages/{sourceDomain}?transactionHash=0x...',
    forwarderContractId: MAINNET_FORWARDER,
    usdcIssuer: USDC_ISSUER,
    distributionAddress: distribution,
    feeAddress: fee,
    dustCollectorAddress: distribution,
    destinationDomain: 27,
    supportedSourceDomains: [0, 6],
    evm: EVM,
  };

  if (!isG(publicConfig.distributionAddress) || !isG(publicConfig.feeAddress)) {
    throw new Error('generated addresses failed validation');
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(publicConfig, null, 2) + '\n');
  console.error(`[INFO] Wrote public config ${outPath} (no secrets).`);

  let secretStored = false;
  if (distributionSecret || feeSecret) {
    if (existsSync(envPath) && !force) {
      console.error(`[WARN] ${envPath} exists — secrets NOT overwritten (pass --force to rotate).`);
    } else {
      const lines = [
        'STELLAR_NETWORK=mainnet',
        distributionSecret ? `STELLAR_MAINNET_DISTRIBUTION_SECRET=${distributionSecret}` : null,
        `STELLAR_MAINNET_DISTRIBUTION=${distribution}`,
        feeSecret ? `STELLAR_MAINNET_FEE_SECRET=${feeSecret}` : null,
        `STELLAR_MAINNET_FEE=${fee}`,
        `STELLAR_DESTINATION=${distribution}`,
        `HORIZON_URL=${HORIZON}`,
        `SOROBAN_RPC_URL=${RPC}`,
        `CIRCLE_ATTESTATION_BASE_URL=${ATTEST}`,
        `FORWARDER_CONTRACT_ID=${MAINNET_FORWARDER}`,
        `USDC_ISSUER=${USDC_ISSUER}`,
        'TRUSTLINE_ALLOW_CREATION=true',
        'SPEND_CAP_XLM=2',
        'REPLAY_STORE_PATH=./data/replay.json',
      ].filter(Boolean) as string[];
      writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
      secretStored = true;
      console.error(`[INFO] Secrets written to ${envPath} only (mode 0600). Values never printed.`);
    }
  }

  console.error('[NEXT] Fund both G... with 5-10 XLM via exchange withdrawal (no friendbot on mainnet).');
  console.error('[NEXT] Then add USDC trustline USDC:' + USDC_ISSUER + ' on each holding account.');
  console.error('[NEXT] Verify EVM addresses on Etherscan/Basescan before first burn.');

  process.stdout.write(
    JSON.stringify({
      success: true,
      writtenPath: outPath,
      distributionAddress: distribution,
      feeAddress: fee,
      secretStored,
    }) + '\n',
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ success: false, error: String(err?.message || err) }) + '\n');
  process.exit(1);
});
