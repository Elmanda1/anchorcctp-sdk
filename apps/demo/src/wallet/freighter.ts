import * as freighter from '@stellar/freighter-api';
import { StrKey } from '@stellar/stellar-sdk';
import { loadNetworkConfig } from '../config/network.js';

export interface WalletState {
  connected: boolean;
  address: string | null;
  network?: string;
  error?: string;
  isSimulated?: boolean;
  needsInstall?: boolean;
  balances?: Array<{ asset_type: string; balance: string }>;
  balancesError?: string;
  networkPassphrase?: string;
}

export async function checkFreighterInstalled(): Promise<boolean> {
  try {
    const { isConnected: connected } = await freighter.isConnected();
    return connected;
  } catch {
    return false;
  }
}

export async function connectFreighter(
  opts?: { allowSimulated?: boolean; silent?: boolean },
): Promise<WalletState> {
  try {
    const { isConnected: connected, error } = await freighter.isConnected();

    if (error) {
      throw new Error(error);
    }

    if (!connected) {
      if (opts?.allowSimulated) {
        return {
          connected: true,
          address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          network: 'TESTNET',
          isSimulated: true,
        };
      }
      return {
        connected: false,
        address: null,
        error: 'Freighter not installed. Install from freighter.app',
      };
    }

    let address: string;
    if (opts?.silent) {
      // Mount path: never prompt. Read only when the origin is already approved.
      const { isAllowed } = await import('@stellar/freighter-api');
      const { isAllowed: allowed } = await isAllowed();
      if (!allowed) return { connected: false, address: null };
      const { getAddress } = await import('@stellar/freighter-api');
      const { address: addr, error: addrError } = await getAddress();
      if (addrError || !addr) return { connected: false, address: null };
      address = addr;
    } else {
      // Click path: requestAccess prompts + returns the address in one call.
      // setAllowed-first re-prompt is unreliable after access removal, so it is
      // no longer used here.
      const { requestAccess } = await import('@stellar/freighter-api');
      const ra = (await requestAccess()) as { address?: string; error?: unknown };
      const addr = ra.address ?? '';
      if (ra.error || !addr) {
        return { connected: false, address: null, error: describeAccessFailure(ra.error) };
      }
      address = addr;
    }

    return await finishConnect(address);
  } catch (err: unknown) {
    return {
      connected: false,
      address: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Distinct errors for denial vs empty-account (locked wallet / no account). */
function describeAccessFailure(err: unknown): string {
  const msg = typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
  const text = typeof msg === 'string' ? msg : '';
  if (/denied|declined|reject|dismiss|cancel/i.test(text)) {
    return `Connection denied in Freighter — approve the prompt and retry${text ? ` (${text})` : ''}`;
  }
  return 'Freighter returned no account — unlock the wallet, make sure an account exists, then approve the connect prompt';
}

/** Network check + balances shared by click and silent paths. */
async function finishConnect(address: string): Promise<WalletState> {

    // Verify network passphrase (must match STELLAR_NETWORK_PASSPHRASE)
    const { getNetwork } = await import('@stellar/freighter-api');
    const { networkPassphrase, error: netError } = await getNetwork();
    if (netError) {
      return {
        connected: false,
        address: null,
        error: typeof netError === 'string' ? netError : 'Wallet network unavailable',
      };
    }
    const expectedPassphrase =
      (import.meta as any).env?.VITE_STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015';

    if (networkPassphrase !== expectedPassphrase) {
      return {
        connected: false,
        address,
        networkPassphrase,
        error: `Network mismatch: wallet on ${networkPassphrase}, expected ${expectedPassphrase}`,
      };
    }

    // Fetch balances via Horizon — non-blocking: balance failure must not sink connect
    let balanceInfo: WalletState['balances'];
    let balancesError: string | undefined;
    try {
      balanceInfo = await fetchBalances(address);
    } catch (err: unknown) {
      balancesError = err instanceof Error ? err.message : String(err);
    }

    return {
      connected: true,
      address,
      networkPassphrase,
      balances: balanceInfo,
      balancesError,
    };
}

/**
 * Sign a transaction with Freighter.
 * Throws with an actionable error if the user rejects or the network mismatches.
 */
export async function signWithFreighter(
  xdr: string,
  networkPassphrase: string = 'Test SDF Network ; September 2015'
): Promise<string> {
  const { signTransaction, getNetwork } = await import('@stellar/freighter-api');

  const { networkPassphrase: currentPassphrase, error: netError } = await getNetwork();
  if (netError) {
    throw new Error(typeof netError === 'string' ? netError : 'Wallet network unavailable');
  }
  if (currentPassphrase !== networkPassphrase) {
    throw new Error(`Network mismatch: wallet on ${currentPassphrase}, expected ${networkPassphrase}`);
  }

  const result = await signTransaction(xdr, {
    networkPassphrase,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  return result.signedTxXdr;
}

/**
 * Network-aware funding guidance. Testnet accounts fund via friendbot;
 * mainnet has no friendbot — fund via exchange withdrawal. Inferred from the
 * Horizon URL so callers cannot show testnet instructions on mainnet.
 */
function fundingGuidance(horizonUrl: string): string {
  return /testnet/i.test(horizonUrl)
    ? 'send testnet XLM from friendbot.stellar.org'
    : 'fund with XLM via exchange withdrawal';
}

/**
 * Verify destination account exists and has a funded XLM balance.
 * Returns the current XLM and USDC balances.
 */
export async function verifyAccountFunded(
  address: string,
  horizonUrl = 'https://horizon-testnet.stellar.org'
): Promise<{ xlm: string; usdc: string; exists: boolean }> {
  try {
    const balances = await getAccountBalances(address, horizonUrl);
    const xlmBalance =
      balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
    const usdcBalance =
      balances.find(
        (b) =>
          b.asset_type !== 'native' &&
          'asset_code' in b &&
          (b as any).asset_code === 'USDC'
      )?.balance ?? '0';

    return { xlm: xlmBalance, usdc: usdcBalance, exists: true };
  } catch (err) {
    // Preserve the network-aware message from getAccountBalances (404/Horizon
    // errors already carry the right guidance) — never overwrite with testnet text.
    if (err instanceof Error && /unfunded|horizon request failed/i.test(err.message)) throw err;
    throw new Error(`Account unfunded: ${fundingGuidance(horizonUrl)} to ${address}`, { cause: err });
  }
}

export async function getAccountBalances(address: string, horizonUrl: string): Promise<Array<{ asset_type: string; balance: string }>> {
  if (!horizonUrl.startsWith('https://')) {
    throw new Error('Horizon URL must use https');
  }
  const res = await fetch(`${horizonUrl}/accounts/${encodeURIComponent(address)}`);
  if (res.status === 404) {
    throw new Error(`Account unfunded: ${fundingGuidance(horizonUrl)} to ${address}`);
  }
  if (!res.ok) {
    throw new Error(`Horizon request failed (${res.status})`);
  }
  const data = await res.json();
  return data.balances;
}

/** Throw if wallet's network passphrase doesn't match expected. */
export async function checkNetworkMatch(expectedPassphrase: string): Promise<void> {
  const { getNetwork } = await import('@stellar/freighter-api');
  const res = (await getNetwork()) as { networkPassphrase?: string; error?: string };
  if (res.error) throw new Error(res.error);
  if (res.networkPassphrase !== expectedPassphrase) {
    throw new Error(`Network mismatch: wallet on ${res.networkPassphrase ?? 'unknown'}, expected ${expectedPassphrase}`);
  }
}

/** Fetch account balances from Horizon using configured URL. Validates address first. */
export async function fetchBalances(address: string): Promise<Array<{ asset_type: string; balance: string }>> {
  if (!StrKey.isValidEd25519PublicKey(address.trim())) throw new Error('Invalid address');
  const { horizonUrl } = loadNetworkConfig();
  return getAccountBalances(address.trim(), horizonUrl);
}
