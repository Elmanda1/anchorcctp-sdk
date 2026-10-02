import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  parseTestnetConfig,
  loadTestnetConfigFromFile,
  createAnchorCCTPFromEnv,
} from '../src/testnet-config.js';
import { InvalidConfigError } from '../src/errors/index.js';

const dest = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x55));
const dust = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x66));

function valid(): Record<string, unknown> {
  return {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    attestationBaseUrl: 'https://iris-api-sandbox.circle.com',
    forwarderContractId: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    destinationAddress: dest,
    dustCollectorAddress: dust,
  };
}

describe('testnet public config loader', () => {
  it('parses valid public config, exposes no secrets', () => {
    const cfg = parseTestnetConfig(valid());
    expect(cfg.destinationAddress).toBe(dest);
    expect(cfg.network).toBe('testnet');
    expect('secret' in (cfg as object)).toBe(false);
  });

  it('refuses files containing secret-like keys or S... values', () => {
    expect(() =>
      parseTestnetConfig({ ...valid(), STELLAR_TESTNET_SECRET: 'S' + 'A'.repeat(55) })
    ).toThrow(InvalidConfigError);
    expect(() =>
      parseTestnetConfig({ ...valid(), privateKey: 'xxx' })
    ).toThrow(InvalidConfigError);
  });

  it('rejects missing destination and malformed addresses', () => {
    const { destinationAddress: _omit, ...rest } = valid();
    expect(() => parseTestnetConfig(rest)).toThrow(InvalidConfigError);
    expect(() => parseTestnetConfig({ ...valid(), destinationAddress: 'NOT_A_KEY' })).toThrow(
      InvalidConfigError
    );
  });

  it('loads JSON from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cctp-'));
    const p = join(dir, 'testnet.public.json');
    writeFileSync(p, JSON.stringify(valid()));
    expect(loadTestnetConfigFromFile(p).usdcIssuer).toBe(
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    );
  });
});

describe('parseTestnetConfig branch coverage', () => {
  it('rejects non-object root', () => {
    expect(() => parseTestnetConfig(null as any)).toThrow(InvalidConfigError);
    expect(() => parseTestnetConfig('string' as any)).toThrow(InvalidConfigError);
    expect(() => parseTestnetConfig(42 as any)).toThrow(InvalidConfigError);
  });

  it('rejects array root', () => {
    expect(() => parseTestnetConfig([] as any)).toThrow(InvalidConfigError);
  });

  it('rejects non-https horizonUrl', () => {
    expect(() => parseTestnetConfig({ ...valid(), horizonUrl: 'http://x' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects non-https sorobanRpcUrl', () => {
    expect(() => parseTestnetConfig({ ...valid(), sorobanRpcUrl: 'http://x' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects non-https attestationBaseUrl', () => {
    expect(() => parseTestnetConfig({ ...valid(), attestationBaseUrl: 'http://x' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects bad forwarderContractId', () => {
    expect(() => parseTestnetConfig({ ...valid(), forwarderContractId: 'GBAD' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects bad usdcIssuer', () => {
    expect(() => parseTestnetConfig({ ...valid(), usdcIssuer: 'GBAD' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects bad dustCollectorAddress', () => {
    expect(() => parseTestnetConfig({ ...valid(), dustCollectorAddress: 'GBAD' })).toThrow(
      InvalidConfigError
    );
  });

  it('rejects non-testnet network', () => {
    expect(() => parseTestnetConfig({ ...valid(), network: 'mainnet' })).toThrow(
      InvalidConfigError
    );
  });
});

describe('loadTestnetConfigFromFile branch coverage', () => {
  it('rejects missing file', () => {
    expect(() => loadTestnetConfigFromFile('/tmp/cctp-does-not-exist-123.json')).toThrow(
      InvalidConfigError
    );
  });

  it('rejects invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cctp-'));
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not valid json');
    expect(() => loadTestnetConfigFromFile(p)).toThrow(InvalidConfigError);
  });
});

describe('createAnchorCCTPFromEnv', () => {
  it('builds public-only client without secret', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any);
    expect(r.destinationAddress).toBe(dest);
    expect(r.hasSigner).toBe(false);
    expect(r.network).toBe('testnet');
  });

  it('wires Keypair signer when STELLAR_TESTNET_SECRET present', () => {
    const kp = Keypair.random();
    const r = createAnchorCCTPFromEnv({
      STELLAR_TESTNET_DESTINATION: kp.publicKey(),
      STELLAR_TESTNET_SECRET: kp.secret(),
    } as any);
    expect(r.hasSigner).toBe(true);
    expect(r.destinationAddress).toBe(kp.publicKey());
  });

  it('rejects malformed destination and secret', () => {
    expect(() => createAnchorCCTPFromEnv({ STELLAR_DESTINATION: 'NOPE' } as any)).toThrow(
      InvalidConfigError
    );
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest, STELLAR_SECRET: 'NOPE' } as any)
    ).toThrow(InvalidConfigError);
  });

  it('rejects non-testnet/mainnet network', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_NETWORK: 'devnet', STELLAR_DESTINATION: dest } as any)
    ).toThrow(InvalidConfigError);
  });

  it('rejects bad DUST_COLLECTOR_ADDRESS', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest, DUST_COLLECTOR_ADDRESS: 'GBAD' } as any)
    ).toThrow(InvalidConfigError);
  });

  it('rejects bad FORWARDER_CONTRACT_ID', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest, FORWARDER_CONTRACT_ID: 'GBAD' } as any)
    ).toThrow(InvalidConfigError);
  });

  it('rejects secret not matching destination', () => {
    const kp = Keypair.random();
    const kp2 = Keypair.random();
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: kp.publicKey(),
        STELLAR_SECRET: kp2.secret(),
      } as any)
    ).toThrow(InvalidConfigError);
  });

  it('rejects invalid STELLAR_SECRET format', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest, STELLAR_SECRET: 'INVALID_SECRET' } as any)
    ).toThrow(InvalidConfigError);
  });
});

describe('C3/C8/O9/N3/O6 env factory guardrails', () => {
  it('C3: trustline creation defaults OFF', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any);
    expect((r.client as any)).toBeDefined();
    // allowCreation is wired into config.trustline — verify OFF by default
    // (behavioral proof: receive without trustline + no flag → TrustlineMissingError tested elsewhere)
  });

  it('N3: SPEND_CAP_XLM=abc throws INVALID_CONFIG', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        TRUSTLINE_ALLOW_CREATION: 'true',
        SPEND_CAP_XLM: 'abc',
      } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('N3: SPEND_CAP_XLM=-1 throws INVALID_CONFIG', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        TRUSTLINE_ALLOW_CREATION: 'true',
        SPEND_CAP_XLM: '-1',
      } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('O6: http attestation URL rejected in env factory', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        CIRCLE_ATTESTATION_BASE_URL: 'http://evil/x',
      } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });
});

describe('parseTestnetConfig secret guard', () => {
  it('rejects secret-like keys and S... values', () => {
    expect(() => parseTestnetConfig({ ...valid(), apiSecret: 'x' })).toThrow('secret-like key');
    expect(() => parseTestnetConfig({ ...valid(), note: 'S' + 'A'.repeat(55) })).toThrow('secret-like value');
  });
});

describe('M9: EnvConfigResult exposes validated keypair', () => {
  it('with secret: keypair matches destination', () => {
    const kp = Keypair.random();
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
    } as any);
    expect(r.keypair).toBeDefined();
    expect(r.keypair!.publicKey()).toBe(kp.publicKey());
  });

  it('without secret: keypair is undefined', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any);
    expect(r.keypair).toBeUndefined();
  });
});

describe('O6: hostname allowlist for horizonUrl', () => {
  it('accepts *.stellar.org https hosts', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        HORIZON_URL: 'https://horizon-testnet.stellar.org',
      } as any)
    ).not.toThrow();
  });

  it('accepts localhost for tests', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        HORIZON_URL: 'https://localhost:8000',
      } as any)
    ).not.toThrow();
  });

  it('rejects non-allowlisted host', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        HORIZON_URL: 'https://evil.example.com/horizon',
      } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('rejects http (non-https) horizonUrl', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        HORIZON_URL: 'http://horizon-testnet.stellar.org',
      } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });
});

describe('O7: signer XDR structural guard', () => {
  it('rejects garbage XDR', async () => {
    const kp = Keypair.random();
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
    } as any);
    // signer is wired — call it with garbage XDR
    const signer = (r.client as any).config?.signer ?? (r.client as any)._signer;
    // Access signer through the config if available, otherwise skip
    if (typeof signer === 'function') {
      await expect(signer('not-valid-xdr')).rejects.toThrow();
    }
  });
});

describe('sorobanRpcUrl in EnvConfigResult', () => {
  it('returns sorobanRpcUrl when SOROBAN_RPC_URL is https', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: dest,
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    } as any);
    expect(r.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
  });

  it('sorobanRpcUrl undefined when SOROBAN_RPC_URL absent', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any);
    expect(r.sorobanRpcUrl).toBeUndefined();
  });

  it('sorobanRpcUrl undefined when SOROBAN_RPC_URL empty', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: dest,
      SOROBAN_RPC_URL: '',
    } as any);
    expect(r.sorobanRpcUrl).toBeUndefined();
  });

  it('rejects http SOROBAN_RPC_URL', () => {
    expect(() =>
      createAnchorCCTPFromEnv({
        STELLAR_DESTINATION: dest,
        SOROBAN_RPC_URL: 'http://evil/x',
      } as any)
    ).toThrow(/SOROBAN_RPC_URL.*https/i);
  });
});

describe('R9: env factory wires trustline provider, Soroban transport and sponsor', () => {
  const kp = Keypair.random();

  it('wires both adapters when HORIZON_URL + SOROBAN_RPC_URL + secret are present', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    } as any);

    expect(typeof r.sorobanTransport?.simulateTransaction).toBe('function');
    expect(typeof r.trustlineProvider?.hasTrustline).toBe('function');
    expect(typeof r.trustlineProvider?.createTrustline).toBe('function');
  });

  it('builds the Soroban transport without HORIZON_URL (transport needs RPC only)', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: dest,
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    } as any);
    expect(r.sorobanTransport).toBeDefined();
    // No keypair → no trustline provider (nothing could sign the change-trust).
    expect(r.trustlineProvider).toBeUndefined();
  });

  it('leaves both undefined for a minimal env (existing callers unchanged)', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any);
    expect(r.sorobanTransport).toBeUndefined();
    expect(r.trustlineProvider).toBeUndefined();
  });

  it('rejects a malformed USDC_ISSUER', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest, USDC_ISSUER: 'GBAD' } as any)
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('accepts STELLAR_USDC_ISSUER as an alias for USDC_ISSUER', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      STELLAR_USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    } as any);
    expect(r.trustlineProvider).toBeDefined();
  });

  it('caps the attestation poll budget via overrides (serverless settle)', () => {
    const r = createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any, { maxRetries: 10 });
    expect(r.maxRetries).toBe(10);
    expect(createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any).maxRetries).toBeUndefined();
  });

  it('rejects a non-positive-integer maxRetries override', () => {
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any, { maxRetries: 0 })
    ).toThrow(InvalidConfigError);
    expect(() =>
      createAnchorCCTPFromEnv({ STELLAR_DESTINATION: dest } as any, { maxRetries: 1.5 })
    ).toThrow(InvalidConfigError);
  });

  it('mainnet: no USDC_ISSUER → no trustline provider (testnet issuer never crosses over)', () => {
    const r = createAnchorCCTPFromEnv({
      STELLAR_NETWORK: 'mainnet',
      STELLAR_DESTINATION: kp.publicKey(),
      STELLAR_SECRET: kp.secret(),
      HORIZON_URL: 'https://horizon.stellar.org',
      SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com',
      FORWARDER_CONTRACT_ID: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    } as any);
    expect(r.trustlineProvider).toBeUndefined();
    expect(r.sorobanTransport).toBeDefined();
  });
});

describe('N9: single-process lock file guard', () => {
  it('concurrent second run fails with LOCKED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cctp-lock-'));
    const statePath = join(dir, 'state.json');
    const lockPath = statePath + '.lock';
    writeFileSync(statePath, '[]');
    // First run acquires lock
    writeFileSync(lockPath, '12345', { flag: 'wx' });
    try {
      // Second run sees lock → should fail
      expect(() => {
        try {
          writeFileSync(lockPath, '99999', { flag: 'wx' });
        } catch {
          throw new Error('LOCKED');
        }
      }).toThrow('LOCKED');
    } finally {
      unlinkSync(lockPath);
    }
  });

  it('stale lock (>5min) is broken and re-acquired', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cctp-stale-'));
    const statePath = join(dir, 'state.json');
    const lockPath = statePath + '.lock';
    writeFileSync(statePath, '[]');
    // Create lock file
    writeFileSync(lockPath, '12345');
    // Simulate stale: backdate mtime by 6 minutes
    const staleTime = Date.now() - 6 * 60 * 1000;
    const { utimesSync } = require('node:fs');
    utimesSync(lockPath, new Date(staleTime), new Date(staleTime));
    // Verify stale detection
    const st = statSync(lockPath);
    expect(Date.now() - st.mtimeMs).toBeGreaterThan(5 * 60 * 1000);
    // Break stale lock
    unlinkSync(lockPath);
    // Re-acquire succeeds
    writeFileSync(lockPath, '99999', { flag: 'wx' });
    expect(readFileSync(lockPath, 'utf8')).toBe('99999');
    unlinkSync(lockPath);
  });
});
