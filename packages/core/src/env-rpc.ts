import { Keypair, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { InvalidConfigError } from './errors/index.js';
import { SorobanTransport } from './forwarder/index.js';
import { TrustlineProvider } from './trustline/index.js';

/**
 * Real `rpc.Server` → `SorobanTransport` adapter (B3/B4).
 *
 * SEQUENCE WARNING (verified against @stellar/stellar-sdk 13.3.0):
 * `rpc.Server.prepareTransaction`/`assembleTransaction` do NOT take the source
 * account's sequence number from the simulation response. `assembleTransaction`
 * rebuilds via `TransactionBuilder.cloneFrom(raw, …)`, which copies the input
 * transaction's sequence verbatim. The simulation response carries no sequence.
 * → Callers MUST read the sponsor's real account sequence from chain and pass it
 *   as `sourceSequence`. `'0'` yields account sequence 1 and the network rejects
 *   the transaction.
 *
 * The passphrase is explicit: the XDR that core builds is encoded with the
 * deployment's network, never a testnet default.
 */
export function createSorobanTransport(
  server: rpc.Server,
  networkPassphrase: string
): SorobanTransport {
  return {
    simulateTransaction: async (xdr) =>
      server.simulateTransaction(TransactionBuilder.fromXDR(xdr, networkPassphrase)),
    assembleTransaction: (xdr, sim) =>
      rpc
        .assembleTransaction(
          TransactionBuilder.fromXDR(xdr, networkPassphrase),
          sim as rpc.Api.SimulateTransactionResponse
        )
        .build()
        .toXDR(),
    sendTransaction: async (signedXdr) => {
      const sent = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      );
      return { status: sent.status, hash: sent.hash };
    },
    getTransaction: async (hash) => {
      try {
        const got = await server.getTransaction(hash);
        return { status: got.status };
      } catch (error) {
        // An SDK older than the network's XDR throws while *decoding a transaction
        // that succeeded* (see `rawTransactionStatus`). That is a decode failure, not
        // a missing transaction, and treating it as one makes every confirmed mint
        // look unconfirmed forever. Read the status straight from the RPC instead.
        const status = await rawTransactionStatus(server, hash);
        if (status === undefined) throw error;
        return { status };
      }
    },
  };
}

/**
 * Reads a transaction's `status` directly from Soroban RPC, bypassing the SDK's decoder.
 *
 * `@stellar/stellar-sdk@13.3.0` cannot decode the `TransactionMeta` a current-network
 * Soroban transaction returns — the XDR union has a case its schema predates, so
 * `server.getTransaction()` throws `Bad union switch: 4` **for a transaction that
 * succeeded**. `submitMint`'s confirmation poll catches that as `NOT_FOUND` and never
 * observes SUCCESS, so a mint that landed is reported as `MINT_UNCONFIRMED` — observed
 * on mainnet 2026-10-02, where the mint was on chain and the portal still refused it.
 *
 * The poll only needs `status`, so read that one field. Returns `undefined` when the RPC
 * is unreachable or answers without a status, letting the caller keep the original error.
 */
async function rawTransactionStatus(
  server: rpc.Server,
  hash: string,
): Promise<string | undefined> {
  const url = String(server.serverURL ?? '');
  if (!url) return undefined;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash } }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: { status?: unknown } };
    return typeof body?.result?.status === 'string' ? body.result.status : undefined;
  } catch {
    return undefined;
  }
}

/** Horizon surface the trustline provider needs — narrow so tests can fake it. */
export interface HorizonTrustlineServer {
  loadAccount(addr: string): Promise<unknown>;
  submitTransaction(tx: unknown): Promise<{ hash: string }>;
}

export interface HorizonTrustlineProviderParams {
  horizon: HorizonTrustlineServer;
  /** Asset issuer the USDC trustline must name (no default — callers resolve it). */
  issuer: string;
  networkPassphrase: string;
  /** Deployment keypair that signs + submits the change-trust is on our own account. */
  keypair: Keypair;
}

/**
 * B5/R9: Horizon-backed trustline provider — the production path wired into
 * `createAnchorCCTPFromEnv`. `hasTrustline` inspects the account's USDC balance;
 * `createTrustline` signs only a single change-trust sourced from our own account.
 */
export function createHorizonTrustlineProvider(
  params: HorizonTrustlineProviderParams
): TrustlineProvider {
  return {
    async hasTrustline(addr: string): Promise<boolean> {
      let account: unknown;
      try {
        account = await params.horizon.loadAccount(addr);
      } catch {
        // Unfunded (404) account cannot hold a trustline.
        return false;
      }
      const balances =
        (account as { balances?: Array<{ asset_code?: string; asset_issuer?: string }> })
          .balances ?? [];
      return balances.some(
        (b) => b.asset_code === 'USDC' && b.asset_issuer === params.issuer
      );
    },
    async createTrustline(xdr: string): Promise<string> {
      const tx = TransactionBuilder.fromXDR(xdr, params.networkPassphrase) as unknown as {
        source: string;
        operations: Array<{ type: string }>;
        sign(kp: Keypair): void;
      };
      // O7-equivalent: refuse anything that is not one change-trust on our own account.
      if (tx.operations.length !== 1 || tx.operations[0].type !== 'changeTrust') {
        throw new InvalidConfigError(
          'trustline signer refused: XDR is not a single changeTrust operation'
        );
      }
      if (tx.source !== params.keypair.publicKey()) {
        throw new InvalidConfigError(
          `trustline signer refused: XDR source ${tx.source} is not the signing account`
        );
      }
      tx.sign(params.keypair);
      const res = await params.horizon.submitTransaction(tx);
      return res.hash;
    },
  };
}
