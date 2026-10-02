/**
 * Base error class for all AnchorCCTP errors.
 */
export abstract class AnchorCCTPError extends Error {
  abstract readonly code: string;
  abstract readonly remediation: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a CCTP domain ID is not in the allow-listed registry.
 */
export class InvalidDomainError extends AnchorCCTPError {
  readonly code = 'INVALID_DOMAIN';
  readonly remediation = 'Provide a supported sourceDomain (e.g. 0 for Ethereum, 6 for Base, 27 for Stellar).';

  constructor(public readonly domainId: number) {
    super(`Unsupported CCTP domain ID: ${domainId}.`);
  }
}

/**
 * Thrown when an invalid or non-positive amount is passed for token conversion.
 */
export class InvalidAmountError extends AnchorCCTPError {
  readonly code = 'INVALID_AMOUNT';
  readonly remediation = 'Ensure the amount is a positive BigInt value (> 0n).';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when Circle Attestation API polling times out before status complete.
 */
export class AttestationTimeoutError extends AnchorCCTPError {
  readonly code = 'ATTESTATION_TIMEOUT';
  readonly remediation = 'Increase pollTimeoutMs or retry once the source chain burn transaction has finalized.';

  constructor(public readonly burnTxHash: string, public readonly elapsedTimeMs: number) {
    super(`Attestation polling timed out for transaction ${burnTxHash} after ${elapsedTimeMs}ms.`);
  }
}

/**
 * Thrown when trustline is missing and auto-creation is disabled or reserve cap is exceeded.
 */
export class TrustlineMissingError extends AnchorCCTPError {
  readonly code = 'TRUSTLINE_MISSING';
  readonly remediation = 'Pass allowTrustlineCreation: true or establish a USDC trustline on the destination account.';

  constructor(public readonly destinationAddress: string) {
    super(`USDC trustline missing for account ${destinationAddress}.`);
  }
}

/**
 * Thrown when Soroban forwarder mint submission fails.
 */
export class MintFailedError extends AnchorCCTPError {
  readonly code = 'MINT_FAILED';
  readonly remediation = 'Verify forwarder contract deployment, destination account status, or retry mint transaction.';

  constructor(public readonly burnTxHash: string, public readonly reason?: string) {
    super(`Failed to submit mint for burn transaction ${burnTxHash}${reason ? `: ${reason}` : ''}.`);
  }
}

/**
 * Thrown when a broadcast mint transaction was accepted by the network but never
 * reached SUCCESS within the confirmation polling window (B3).
 */
export class MintUnconfirmedError extends AnchorCCTPError {
  readonly code = 'MINT_UNCONFIRMED';
  readonly remediation = 'The mint may still land — check the mint txHash on a Stellar explorer before retrying; the replay store prevents double-crediting.';

  constructor(public readonly burnTxHash: string, public readonly mintTxHash: string) {
    super(`Mint transaction ${mintTxHash} for burn transaction ${burnTxHash} is unconfirmed: no SUCCESS observed within the confirmation window.`);
  }
}

/**
 * Thrown when trustline creation transaction fails.
 */
export class TrustlineCreationError extends AnchorCCTPError {
  readonly code = 'TRUSTLINE_CREATION_FAILED';
  readonly remediation = 'Ensure destination account is funded with sufficient XLM to cover base reserves or increase spendCapXlm.';

  constructor(public readonly destinationAddress: string, public readonly reason?: string) {
    super(`Failed to create USDC trustline for account ${destinationAddress}${reason ? `: ${reason}` : ''}.`);
  }
}

/**
 * Thrown when an attestation fails cryptographic verification.
 */
export class AttestationVerificationError extends AnchorCCTPError {
  readonly code = 'ATTESTATION_VERIFICATION_FAILED';
  readonly remediation = 'Ensure burnTxHash is valid hex (>=66 chars) and attestation message signature is >=130 chars from Iris API.';

  constructor(public readonly burnTxHash: string, public readonly reason?: string) {
    super(`Attestation verification failed for burn transaction ${burnTxHash}${reason ? `: ${reason}` : ''}.`);
  }
}

/**
 * Thrown when a Soroban forwarder contract call fails.
 */
export class ForwarderContractError extends AnchorCCTPError {
  readonly code = 'FORWARDER_CONTRACT_ERROR';
  readonly remediation = 'Verify the forwarder contract is deployed and the contractId is correct.';

  constructor(public readonly contractId: string, public readonly reason?: string) {
    super(`Forwarder contract call failed for ${contractId}${reason ? `: ${reason}` : ''}.`);
  }
}

/**
 * Thrown when a public JSON config file is missing, malformed, or unsafe.
 * Config files must never contain secrets — secrets live in env vars only.
 */
export class InvalidConfigError extends AnchorCCTPError {
  readonly code = 'INVALID_CONFIG';
  readonly remediation = 'Fix public config (public addresses only) and keep secrets in env vars.';

  constructor(public readonly reason: string) {
    super(`Invalid config: ${reason}.`);
  }
}
/**
 * Thrown when burnTxHash is malformed (not 0x + 64 hex chars).
 */
export class InvalidBurnHashError extends AnchorCCTPError {
  readonly code = 'INVALID_HASH';
  readonly remediation = 'Provide EVM burn hash as 0x + 64 hex chars (lowercased before replay check).';

  constructor(public readonly hash: string) {
    super(`Invalid burnTxHash: "${hash}".`);
  }
}

/**
 * Thrown when a Stellar/EVM address is invalid or represents a zero-address.
 */
export class InvalidAddressError extends AnchorCCTPError {
  readonly code = 'INVALID_ADDRESS';
  readonly remediation = 'Provide a valid G... StrKey or 0x 20/32-byte non-zero hex address.';

  constructor(public readonly address: string, reason?: string) {
    super(`Invalid address "${address}"${reason ? `: ${reason}` : ''}.`);
  }
}

/**
 * Thrown when the Circle Iris fee API is unreachable, errors, or has no entry for
 * the requested finality tier — callers must never fall back to a hardcoded fee.
 */
export class FeeUnavailableError extends AnchorCCTPError {
  readonly code = 'FEE_UNAVAILABLE';
  readonly remediation = 'Retry the fee quote, or fall back to the Standard tier (free) if Fast is unavailable.';

  constructor(
    public readonly sourceDomain: number,
    public readonly destDomain: number,
    public readonly reason: string
  ) {
    super(`Circle fee API unavailable for route ${sourceDomain}->${destDomain}: ${reason}.`);
  }
}

export class ReplayTransferError extends AnchorCCTPError {
  readonly code = 'REPLAY_TRANSFER';
  readonly remediation = 'This burn transaction has already been processed and settled. Check existing settlement records.';

  constructor(public readonly burnTxHash: string) {
    super(`Burn transaction ${burnTxHash} has already been processed.`);
  }
}

