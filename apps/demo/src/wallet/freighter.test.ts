import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  getNetwork: vi.fn(),
  getNetworkDetails: vi.fn(),
  isAllowed: vi.fn().mockResolvedValue(true),
  setAllowed: vi.fn(),
}));

import * as freighterApi from '@stellar/freighter-api';
import {
  connectFreighter,
  signWithFreighter,
  getAccountBalances,
  checkNetworkMatch,
  fetchBalances,
} from './freighter.js';

const G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TESTNET_PASS = 'Test SDF Network ; September 2015';

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults stripped by clearAllMocks
  vi.mocked(freighterApi.isAllowed).mockResolvedValue(true as any);
  vi.mocked(freighterApi.requestAccess).mockResolvedValue({ address: G } as any);
  vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: TESTNET_PASS } as any);
});
afterEach(() => { vi.unstubAllGlobals?.(); vi.unstubAllEnvs?.(); });

describe('connectFreighter', () => {
  it('returns explicit not-installed state instead of a fake mock account', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false } as any);
    const res = await connectFreighter();
    expect(res.connected).toBe(false);
    expect(res.address).toBeNull();
    expect(res.error).toMatch(/install/i);
  });

  it('returns simulated sandbox state when allowSimulated is true and Freighter not installed', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false } as any);
    const res = await connectFreighter({ allowSimulated: true });
    expect(res.connected).toBe(true);
    expect(res.address).toBe(G);
    expect(res.isSimulated).toBe(true);
  });

  it('connects via requestAccess (prompt+address) without setAllowed/getAddress on click path', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    const res = await connectFreighter();
    expect(res.connected).toBe(true);
    expect(res.address).toBe(G);
    expect(freighterApi.requestAccess).toHaveBeenCalledTimes(1);
    expect(freighterApi.setAllowed).not.toHaveBeenCalled();
    expect(freighterApi.getAddress).not.toHaveBeenCalled();
  });

  it('surfaces user-decline as disconnected with reason', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({ address: '', error: 'declined' } as any);
    const res = await connectFreighter();
    expect(res.connected).toBe(false);
    expect(res.error).toMatch(/denied|declined/i);
  });

  it('names empty-account case distinctly from denial', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({ address: '' } as any);
    const res = await connectFreighter();
    expect(res.connected).toBe(false);
    expect(res.error).toMatch(/no account/i);
  });

  it('silent mode never prompts: disconnected without error when not allowed', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighterApi.isAllowed).mockResolvedValue({ isAllowed: false } as any);
    const res = await connectFreighter({ silent: true });
    expect(res.connected).toBe(false);
    expect(res.error).toBeUndefined();
    expect(freighterApi.setAllowed).not.toHaveBeenCalled();
    expect(freighterApi.requestAccess).not.toHaveBeenCalled();
  });

  it('silent mode reads address without prompting when already allowed', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighterApi.isAllowed).mockResolvedValue({ isAllowed: true } as any);
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: G } as any);
    const res = await connectFreighter({ silent: true });
    expect(res.connected).toBe(true);
    expect(res.address).toBe(G);
    expect(freighterApi.requestAccess).not.toHaveBeenCalled();
  });

  it('throws when isConnected resolves with error string', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true, error: 'browser lock' } as any);
    const res = await connectFreighter();
    expect(res.connected).toBe(false);
    expect(res.error).toMatch(/browser lock/i);
  });

  it('stays connected when balance fetch fails', async () => {
    for (const [k, v] of Object.entries({
      VITE_NETWORK: 'testnet',
      VITE_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      VITE_USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      VITE_FORWARDER_CONTRACT_ID: 'CBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEE5XW',
      VITE_ATTESTATION_URL: 'https://attestation.example.com',
    })) vi.stubEnv(k, v);
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: G } as any);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Horizon down')));
    const res = await connectFreighter();
    expect(res.connected).toBe(true);
    expect(res.address).toBe(G);
    expect(res.balancesError).toMatch(/Horizon down/i);
  });
});

describe('signWithFreighter', () => {
  it('throws typed error on rejection instead of returning xdr', async () => {
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({ signedTxXdr: '', error: 'rejected' } as any);
    await expect(signWithFreighter('AAAA')).rejects.toThrow(/rejected/i);
  });

  it('returns signedTxXdr on success', async () => {
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({ signedTxXdr: 'SIGNED_XDR_BLOB', error: '' } as any);
    const result = await signWithFreighter('AAAA');
    expect(result).toBe('SIGNED_XDR_BLOB');
  });

  it('passes custom passphrase to signTransaction', async () => {
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' } as any);
    const spy = vi.mocked(freighterApi.signTransaction).mockResolvedValue({ signedTxXdr: 'OK', error: '' } as any);
    await signWithFreighter('AAAA', 'Public Global Stellar Network ; September 2015');
    expect(spy).toHaveBeenCalledWith('AAAA', { networkPassphrase: 'Public Global Stellar Network ; September 2015' });
  });

  it('throws on network passphrase mismatch', async () => {
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'WRONG', networkPassphrase: 'Wrong Network ; September 2015' } as any);
    await expect(signWithFreighter('AAAA')).rejects.toThrow(/Network mismatch/i);
  });
});

describe('checkNetworkMatch', () => {
  it('flags mismatch between wallet network and expected passphrase', async () => {
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({ networkPassphrase: 'Public Global Stellar Network ; September 2015' } as any);
    await expect(checkNetworkMatch('Test SDF Network ; September 2015')).rejects.toThrow(/network mismatch/i);
  });

  it('throws when getNetwork returns an error', async () => {
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({ networkPassphrase: '', error: 'extension locked' } as any);
    await expect(checkNetworkMatch('Test SDF Network ; September 2015')).rejects.toThrow(/extension locked/i);
  });

  it('resolves without throwing when passphrase matches', async () => {
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({ networkPassphrase: 'Test SDF Network ; September 2015' } as any);
    await expect(checkNetworkMatch('Test SDF Network ; September 2015')).resolves.toBeUndefined();
  });
});

describe('getAccountBalances', () => {
  it('parses Horizon balances for an address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ asset_type: 'native', balance: '10.5' }] }),
    }));
    const b = await getAccountBalances(G, 'https://horizon-testnet.stellar.org');
    expect(b[0].balance).toBe('10.5');
  });

  it('throws actionable error when account unfunded (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(getAccountBalances('GUNFUNDED' + 'A'.repeat(48), 'https://horizon-testnet.stellar.org')).rejects.toThrow(/unfunded/i);
  });

  it('unfunded on testnet points to friendbot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(getAccountBalances('GUNFUNDED' + 'A'.repeat(48), 'https://horizon-testnet.stellar.org')).rejects.toThrow(/friendbot/i);
  });

  it('unfunded on mainnet never mentions friendbot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const err = await getAccountBalances('GUNFUNDED' + 'A'.repeat(48), 'https://horizon.stellar.org').catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/unfunded|fund.*xlm/i);
    expect((err as Error).message.toLowerCase()).not.toContain('friendbot');
  });

  it('throws generic error on non-404 failure (500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getAccountBalances(G, 'https://horizon-testnet.stellar.org')).rejects.toThrow(/Horizon request failed \(500\)/);
  });

  it('rejects non-https horizon urls before fetching', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(getAccountBalances(G, 'http://evil/x')).rejects.toThrow(/https/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('fetchBalances', () => {
  const requiredEnv = {
    VITE_NETWORK: 'testnet',
    VITE_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    VITE_USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    VITE_FORWARDER_CONTRACT_ID: 'CBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEE5XW',
    VITE_ATTESTATION_URL: 'https://attestation.example.com',
  };

  it('uses configured horizon url', async () => {
    for (const [k, v] of Object.entries(requiredEnv)) vi.stubEnv(k, v);
    vi.stubEnv('VITE_HORIZON_URL', 'https://horizon-testnet.stellar.org');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ balances: [{ asset_type: 'native', balance: '5' }] }),
    }));
    const b = await fetchBalances(G);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://horizon-testnet.stellar.org/accounts/'));
    expect(b[0].balance).toBe('5');
  });
  it('rejects invalid address before fetch', async () => {
    for (const [k, v] of Object.entries(requiredEnv)) vi.stubEnv(k, v);
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(fetchBalances('NOPE')).rejects.toThrow(/Invalid address/i);
    expect(spy).not.toHaveBeenCalled();
  });
  it('trims padded address', async () => {
    for (const [k, v] of Object.entries(requiredEnv)) vi.stubEnv(k, v);
    vi.stubEnv('VITE_HORIZON_URL', 'https://horizon-testnet.stellar.org');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ balances: [] }),
    }));
    await fetchBalances('  ' + G + '  ');
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/accounts/' + G));
  });
});

describe('secret hygiene tripwire', () => {
  it('wallet module never mentions secret material', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./freighter.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/secret|mnemonic|seed\s*:/i);
  });
});
