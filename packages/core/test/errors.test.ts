import {
  InvalidDomainError,
  InvalidAmountError,
  AttestationTimeoutError,
  TrustlineMissingError,
  MintFailedError,
  MintUnconfirmedError,
  TrustlineCreationError,
  ReplayTransferError,
  AttestationVerificationError,
  ForwarderContractError,
  InvalidConfigError,
} from '../src/index';
import type { SorobanTransport } from '../src/index';

describe('Typed Error Classes', () => {
  it('InvalidDomainError stores domainId and code', () => {
    const err = new InvalidDomainError(999);
    expect(err.code).toBe('INVALID_DOMAIN');
    expect(err.domainId).toBe(999);
    expect(err.remediation).toContain('supported sourceDomain');
    expect(err.message).toContain('999');
  });

  it('InvalidAmountError stores code and remediation', () => {
    const err = new InvalidAmountError('Amount too low');
    expect(err.code).toBe('INVALID_AMOUNT');
    expect(err.remediation).toContain('BigInt');
    expect(err.message).toBe('Amount too low');
  });

  it('AttestationTimeoutError stores transaction context', () => {
    const err = new AttestationTimeoutError('0x123', 5000);
    expect(err.code).toBe('ATTESTATION_TIMEOUT');
    expect(err.burnTxHash).toBe('0x123');
    expect(err.elapsedTimeMs).toBe(5000);
    expect(err.remediation).toContain('pollTimeoutMs');
  });

  it('TrustlineMissingError stores destination address', () => {
    const err = new TrustlineMissingError('GBBD47...');
    expect(err.code).toBe('TRUSTLINE_MISSING');
    expect(err.destinationAddress).toBe('GBBD47...');
    expect(err.remediation).toContain('allowTrustlineCreation');
  });

  it('MintFailedError carries burnTxHash + remediation', () => {
    const e = new MintFailedError('0xabc', 'revert');
    expect(e.code).toBe('MINT_FAILED');
    expect(e.burnTxHash).toBe('0xabc');
    expect(e.reason).toBe('revert');
    expect(e.remediation).toContain('mint');
    expect(e.message).toContain('0xabc');

    const eNoReason = new MintFailedError('0xabc');
    expect(eNoReason.reason).toBeUndefined();
  });

  it('TrustlineCreationError + ReplayTransferError have codes', () => {
    const tcErr = new TrustlineCreationError('GBX', 'fee too low');
    expect(tcErr.code).toBe('TRUSTLINE_CREATION_FAILED');
    expect(tcErr.destinationAddress).toBe('GBX');
    expect(tcErr.reason).toBe('fee too low');
    expect(tcErr.remediation).toBeDefined();

    const tcErrNoReason = new TrustlineCreationError('GBX');
    expect(tcErrNoReason.reason).toBeUndefined();

    const rpErr = new ReplayTransferError('0xabc');
    expect(rpErr.code).toBe('REPLAY_TRANSFER');
    expect(rpErr.burnTxHash).toBe('0xabc');
    expect(rpErr.remediation).toBeDefined();
  });

  it('MintUnconfirmedError carries both hashes and a distinct code (B3)', () => {
    const e = new MintUnconfirmedError('0xabc', 'deadbeef');
    expect(e.code).toBe('MINT_UNCONFIRMED');
    expect(e.burnTxHash).toBe('0xabc');
    expect(e.mintTxHash).toBe('deadbeef');
    expect(e.message).toContain('deadbeef');
    expect(e.message).toMatch(/unconfirmed/i);
    expect(e.remediation).toContain('explorer');
  });

  it('SorobanTransport is importable from the package entrypoint (B3/B4 seam)', () => {
    const transport: SorobanTransport = {
      simulateTransaction: async () => ({}),
      assembleTransaction: (xdr: string) => xdr,
      sendTransaction: async (signed: string) => ({ status: 'PENDING', hash: signed }),
      getTransaction: async () => ({ status: 'SUCCESS' }),
    };
    expect(typeof transport.simulateTransaction).toBe('function');
    expect(typeof transport.assembleTransaction).toBe('function');
    expect(typeof transport.sendTransaction).toBe('function');
    expect(typeof transport.getTransaction).toBe('function');
  });

  it('AttestationVerificationError + ForwarderContractError have codes', () => {
    const a = new AttestationVerificationError('0xabc', 'bad shape');
    expect(a.code).toBe('ATTESTATION_VERIFICATION_FAILED');
    expect(a.burnTxHash).toBe('0xabc');
    expect(a.remediation).toBeDefined();

    const f = new ForwarderContractError('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'build failed');
    expect(f.code).toBe('FORWARDER_CONTRACT_ERROR');
    expect(f.remediation).toBeDefined();
  });

  it('InvalidConfigError message is network-agnostic (no hardcoded testnet)', () => {
    const e = new InvalidConfigError('STELLAR_NETWORK must be "testnet" or "mainnet"');
    expect(e.code).toBe('INVALID_CONFIG');
    expect(e.message).toContain('STELLAR_NETWORK must be "testnet" or "mainnet"');
    expect(e.message.toLowerCase()).not.toContain('testnet config');
    expect(e.remediation.toLowerCase()).not.toContain('testnet.public.json');
  });
});

