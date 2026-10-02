import { StrKey, Contract, TransactionBuilder, Networks, Account, nativeToScVal } from '@stellar/stellar-sdk';
import { AnchorCCTPError, MintFailedError, MintUnconfirmedError, ForwarderContractError, InvalidConfigError, InvalidAddressError } from '../errors/index.js';

export interface MintParams {
  message: string;
  signature: string;
  forwarderContractId?: string;
  horizonUrl?: string;
  networkPassphrase?: string;
  sourceSequence?: string;
  /**
   * O15/B2: Sponsor account used as transaction source. Required — the Stellar
   * recipient travels inside `hookData` (Task 1), so the two-arg
   * `mint_and_forward(message, attestation)` has no destination to fall back to.
   */
  sourceAccount: string;
}

export type SignerCallback = (xdr: string) => Promise<string>;

/**
 * Minimal Soroban RPC surface `submitMint` needs (B3/B4). Core stays
 * transport-injected so unit tests never touch a network; the real
 * `rpc.Server` is adapted at the call sites (scripts, server handlers).
 *
 * `assembleTransaction` must return the assembled **envelope XDR string** —
 * `rpc.Server` users get this from `assembleTransaction(tx, sim).build().toXDR()`.
 */
export interface SorobanTransport {
  simulateTransaction(xdr: string): Promise<unknown>;
  assembleTransaction(xdr: string, sim: unknown): string;
  sendTransaction(signedXdr: string): Promise<{ status: string; hash?: string }>;
  getTransaction(hash: string): Promise<{ status: string }>;
}

/** Confirmation polling knobs — injectable so tests never sleep for real. */
export interface MintConfirmOptions {
  /** Maximum `getTransaction` polls before `MintUnconfirmedError`. Default 20. */
  maxAttempts?: number;
  /** Delay between polls in ms. Default 3000. Set 0 in tests. */
  pollIntervalMs?: number;
}

const DEFAULT_CONFIRM_ATTEMPTS = 20;
const DEFAULT_CONFIRM_POLL_MS = 3000;

/**
 * How long the assembled mint transaction stays valid.
 *
 * This **must** outlive the confirmation window below
 * (`DEFAULT_CONFIRM_ATTEMPTS × DEFAULT_CONFIRM_POLL_MS` = 60s). At 30s a transaction
 * that was merely slow to be included expired (`txTOO_LATE`) and was dropped with its
 * sequence unconsumed, while `submitMint` kept polling for another 30s and finally
 * reported `MINT_UNCONFIRMED` for a transaction that could never confirm.
 *
 * Observed on mainnet: the broadcast hash was absent from both Horizon and Soroban
 * RPC, and the sponsor's sequence had not advanced — the signature of an expiry, not
 * of a pending transaction.
 */
const TX_VALIDITY_SECONDS = 180;

/**
 * Inclusion fee bid per operation, in stroops.
 *
 * The Stellar base fee is 100 stroops, but under surge pricing
 * (`ledger_capacity_usage` above the 0.5 threshold) the fee a transaction must bid to
 * be *includable at all* is `100 × (capacity / 0.5)`. Bidding the bare 100 while the
 * requirement sits at 104 does not get the transaction rejected — `sendTransaction`
 * still returns PENDING — the transaction simply can never be included, sits in the
 * queue, and is evicted. It then reports `NOT_FOUND` from every provider with its
 * sequence unconsumed, which is indistinguishable from "still pending" to the caller.
 *
 * Observed on mainnet at 0.52 capacity: required 104, bid 100, two mints vanished.
 * `fee_stats.max_fee.p50` was 22,592 stroops, i.e. real bidders pay far more than the
 * base fee. 100,000 (0.01 XLM) clears typical surge with room to spare and is
 * negligible against a CCTP transfer; only the inclusion portion is spent, the
 * resource fee is set from simulation.
 */
const INCLUSION_FEE_BID = '100000';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const TESTNET_FORWARDER = 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ';
export const MAINNET_FORWARDER = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T';
export const DEFAULT_FORWARDER = TESTNET_FORWARDER;

export function resolveForwarder(network?: 'testnet' | 'mainnet'): string {
  if (network === 'mainnet') return MAINNET_FORWARDER;
  if (network === 'testnet') return TESTNET_FORWARDER;
  throw new InvalidConfigError('network required: "testnet" | "mainnet" (no silent testnet default).');
}

function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0 || clean.length === 0) {
    throw new ForwarderContractError('input', 'Invalid hex: charset+even-length required.');
  }
  return Buffer.from(clean, 'hex');
}

/**
 * Builds a real Stellar Soroban XDR transaction that calls mint_and_forward on the forwarder contract.
 */
export function buildMintAndForwardXdr(params: MintParams): string {
  const contractId = params.forwarderContractId || DEFAULT_FORWARDER;
  const passphrase = params.networkPassphrase || Networks.TESTNET;

  // O15/B2: sourceAccount is required — no destination fallback exists any more.
  if (!params.sourceAccount || !StrKey.isValidEd25519PublicKey(params.sourceAccount)) {
    throw new InvalidAddressError(params.sourceAccount ?? '', 'sourceAccount is required and must be a valid G... StrKey');
  }

  try {
    const source = new Account(params.sourceAccount, params.sourceSequence ?? '0');
    const contract = new Contract(contractId);
    // B2: Circle's mint_and_forward(message: Bytes, attestation: Bytes) — recipient
    // lives in the 88-byte hookData carried by `message`, not in a third argument.
    const op = contract.call(
      'mint_and_forward',
      nativeToScVal(hexToBytes(params.message)),
      nativeToScVal(hexToBytes(params.signature)),
    );
    const tx = new TransactionBuilder(source, {
      fee: INCLUSION_FEE_BID,
      networkPassphrase: passphrase,
    })
      .addOperation(op)
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    return tx.toXDR();
  } catch (err) {
    if (err instanceof InvalidAddressError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ForwarderContractError(contractId, reason);
  }
}

/**
 * Translates an EVM 20-byte or 32-byte hexadecimal address into a Stellar G... public key (strkey).
 * If the address is already a valid Stellar G... address, it returns it unchanged.
 */
export function translateToStellar(evmAddress: string): string {
  if (typeof evmAddress !== 'string') {
    throw new InvalidAddressError(String(evmAddress), 'Address must be a string');
  }

  const trimmed = evmAddress.trim();

  // If already a valid Stellar public key, return as is
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return trimmed;
  }

  let cleanHex = trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? trimmed.slice(2)
    : trimmed;

  // If 20-byte EVM address (40 hex chars), left-pad to 32 bytes (64 hex chars)
  if (cleanHex.length === 40) {
    cleanHex = cleanHex.padStart(64, '0');
  }

  if (cleanHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new InvalidAddressError(evmAddress, 'cannot translate to Stellar public key');
  }

  const buffer = Buffer.from(cleanHex, 'hex');
  if (buffer.length !== 32) {
    throw new InvalidAddressError(evmAddress, `expected 32 bytes, received ${buffer.length}`);
  }

  // Reject zero addresses (20 or 32 byte)
  if (buffer.every(b => b === 0)) {
    throw new InvalidAddressError(evmAddress, 'zero address not allowed');
  }

  return StrKey.encodeEd25519PublicKey(buffer);
}

/**
 * Builds, simulates, assembles, signs, broadcasts and confirms the CCTP mint (B3/B4).
 * Delegates signing to the caller; returns the **network tx hash** only once the
 * network reports SUCCESS, so callers can never persist a receipt for a mint
 * that did not land.
 *
 * Throws:
 * - `ForwarderContractError` / `InvalidAddressError` for local build problems.
 * - `MintFailedError` when simulate, assemble, sign or send fails, or on FAILED.
 * - `MintUnconfirmedError` when no SUCCESS is observed within the polling window.
 */
export async function submitMint(
  params: MintParams,
  signer: SignerCallback,
  rpc: SorobanTransport,
  confirm: MintConfirmOptions = {}
): Promise<{ txHash: string }> {
  const maxAttempts = confirm.maxAttempts ?? DEFAULT_CONFIRM_ATTEMPTS;
  const pollIntervalMs = confirm.pollIntervalMs ?? DEFAULT_CONFIRM_POLL_MS;
  const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  try {
    const xdr = buildMintAndForwardXdr(params);

    // B4: never send an un-simulated Soroban tx — footprint + fee come from simulation.
    let sim: unknown;
    try {
      sim = await rpc.simulateTransaction(xdr);
    } catch (e) {
      throw new MintFailedError(params.message, `simulate: ${reason(e)}`);
    }
    const assembled = rpc.assembleTransaction(xdr, sim);

    const signed = await signer(assembled);

    const sent = await rpc.sendTransaction(signed);
    if (sent.status !== 'PENDING' || !sent.hash) {
      throw new MintFailedError(params.message, `send status=${sent.status}`);
    }
    const hash = sent.hash;

    // B3: do not report success until the network confirms SUCCESS.
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let status: string;
      try {
        status = (await rpc.getTransaction(hash)).status;
      } catch {
        // A transient RPC/network error while polling is "confirmation not observed",
        // not a failed mint — keep polling and let SUCCESS/FAILED/the window decide,
        // so the broadcast hash survives as MINT_UNCONFIRMED rather than MINT_FAILED.
        status = 'NOT_FOUND';
      }
      if (status === 'SUCCESS') return { txHash: hash };
      if (status === 'FAILED') {
        throw new MintFailedError(params.message, 'transaction FAILED on network');
      }
      const isLastAttempt = attempt === maxAttempts - 1;
      if (!isLastAttempt && pollIntervalMs > 0) await sleep(pollIntervalMs);
    }
    throw new MintUnconfirmedError(params.message, hash);
  } catch (error) {
    if (error instanceof AnchorCCTPError) throw error;
    throw new MintFailedError(params.message, reason(error));
  }
}
