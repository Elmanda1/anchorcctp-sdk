/**
 * Mainnet trustline setup: USDC trustline on distribution + fee accounts.
 *
 * Each account self-signs its own single changeTrust (0.5 XLM reserve).
 * Guardrails: TRUSTLINE_ALLOW_CREATION must be 'true', required 0.5 XLM
 * must fit SPEND_CAP_XLM. Secrets from .env.mainnet only, never logged.
 *
 * stdout: result JSON only (hashes, no secrets). stderr: human context.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/mainnet-trustline.ts [--env .env.mainnet]
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const HORIZON = 'https://horizon.stellar.org';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const REQUIRED_RESERVE = 0.5;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

async function main(): Promise<void> {
  const envPath = arg('--env') || '.env.mainnet';
  const fileEnv = readEnvFile(envPath);
  const env = { ...fileEnv, ...process.env } as Record<string, string | undefined>;

  if ((env.TRUSTLINE_ALLOW_CREATION ?? 'false').toLowerCase() !== 'true') {
    throw new Error('refused: TRUSTLINE_ALLOW_CREATION != true (explicit opt-in required)');
  }
  const cap = Number(env.SPEND_CAP_XLM ?? 'NaN');
  if (!Number.isFinite(cap) || cap < REQUIRED_RESERVE) {
    throw new Error(`refused: SPEND_CAP_XLM=${env.SPEND_CAP_XLM} < required ${REQUIRED_RESERVE} XLM`);
  }

  const pairs = [
    { label: 'distribution', addr: env.STELLAR_MAINNET_DISTRIBUTION, secret: env.STELLAR_MAINNET_DISTRIBUTION_SECRET },
    { label: 'fee', addr: env.STELLAR_MAINNET_FEE, secret: env.STELLAR_MAINNET_FEE_SECRET },
  ];
  const server = new Horizon.Server(HORIZON);
  const results: Array<{ account: string; label: string; created: boolean; hash?: string }> = [];

  for (const p of pairs) {
    if (!p.addr || !p.secret) throw new Error(`missing secret/address for ${p.label} in ${envPath}`);
    const kp = Keypair.fromSecret(p.secret.trim());
    if (kp.publicKey() !== p.addr.trim()) throw new Error(`secret mismatch for ${p.label}`);
    const address = p.addr.trim();

    const account = await server.loadAccount(address);
    const balances = (account as unknown as { balances: Array<{ asset_code?: string; asset_issuer?: string }> }).balances ?? [];
    if (balances.some((b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER)) {
      console.error(`[INFO] ${p.label} ${address}: trustline exists, skipping.`);
      results.push({ account: address, label: p.label, created: false });
      continue;
    }

    const source = new Account(address, (account as unknown as { sequence: string }).sequence);
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_ISSUER) }))
      .setTimeout(30)
      .build();
    tx.sign(kp);
    const res = await server.submitTransaction(tx);
    console.error(`[INFO] ${p.label} ${address}: trustline created, hash ${res.hash}.`);
    results.push({ account: address, label: p.label, created: true, hash: res.hash });
  }

  process.stdout.write(JSON.stringify({ success: true, results }) + '\n');
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ success: false, error: String(err?.message || err) }) + '\n');
  process.exit(1);
});
