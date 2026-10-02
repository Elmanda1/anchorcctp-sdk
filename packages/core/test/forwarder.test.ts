import { translateToStellar, submitMint, buildMintAndForwardXdr, resolveForwarder, TESTNET_FORWARDER, MAINNET_FORWARDER } from '../src/forwarder/index.js';
import type { SorobanTransport } from '../src/forwarder/index.js';
import { MintFailedError, MintUnconfirmedError, ForwarderContractError, InvalidConfigError, InvalidAddressError } from '../src/errors/index.js';
import { StrKey, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

/** Valid G... sponsor used as the mint transaction source (B2: it is the only source). */
const SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x99));

/**
 * Fake Soroban transport for unit tests. By default it reports the *signed XDR*
 * as the network hash and confirms immediately, which keeps the pre-existing
 * `txHash === '<signed output>'` assertions meaningful under the new
 * "txHash is the network hash" contract (B3) without ever touching a network.
 */
function makeRpc(over: Partial<SorobanTransport> = {}): SorobanTransport {
  return {
    simulateTransaction: async () => ({}),
    assembleTransaction: (xdr: string) => xdr,
    sendTransaction: async (signedXdr: string) => ({ status: 'PENDING', hash: signedXdr }),
    getTransaction: async () => ({ status: 'SUCCESS' }),
    ...over,
  };
}

describe('Forwarder & Address Translation', () => {
  it('translateToStellar returns a G... address for a 32-byte EVM address', () => {
    const raw32 = '0x' + '11'.repeat(32);
    const g = translateToStellar(raw32);
    expect(g.startsWith('G')).toBe(true);
    expect(g.length).toBe(56);
    expect(StrKey.isValidEd25519PublicKey(g)).toBe(true);
  });

  it('translateToStellar preserves already-valid Stellar G-addresses', () => {
    // Generate a valid Stellar G address
    const sampleRaw = Buffer.alloc(32, 0x22);
    const validG = StrKey.encodeEd25519PublicKey(sampleRaw);
    expect(translateToStellar(validG)).toBe(validG);
  });

  it('translateToStellar handles 20-byte addresses padded to 32 bytes', () => {
    const raw20 = '0x' + 'aa'.repeat(20);
    const g = translateToStellar(raw20);
    expect(g.startsWith('G')).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(g)).toBe(true);
  });

  it('translateToStellar throws for invalid address inputs', () => {
    expect(() => translateToStellar('invalid-address-string')).toThrow();
    expect(() => translateToStellar(12345 as any)).toThrow();
  });

  it('submitMint delegates signing to caller callback with custom contract ID', async () => {
    let captured = '';
    let sentSigned = '';
    const signer = async (xdr: string) => {
      captured = xdr;
      return 'TX_CUSTOM';
    };
    const r = await submitMint(
      {
        message: '0x' + 'ab'.repeat(40),
        signature: '0x' + 'cd'.repeat(70),
        sourceAccount: SOURCE,
        forwarderContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      },
      signer,
      makeRpc({
        sendTransaction: async (signedXdr) => {
          sentSigned = signedXdr;
          return { status: 'PENDING', hash: 'TX_CUSTOM' };
        },
      })
    );
    // B3: txHash is the network hash reported by sendTransaction, never the XDR.
    expect(r.txHash).toBe('TX_CUSTOM');
    expect(sentSigned).toBe('TX_CUSTOM');
    expect(() => (TransactionBuilder as any).fromXDR(captured, 'TESTNET')).not.toThrow();
  });


  it('submitMint delegates signing to caller callback', async () => {
    const signer = async (xdr: string) => {
      expect(typeof xdr).toBe('string');
      return 'SIGNED_' + xdr;
    };
    const r = await submitMint(
      { message: '0x' + 'ab'.repeat(40), signature: '0x' + 'cd'.repeat(70), sourceAccount: SOURCE },
      signer,
      makeRpc()
    );
    expect(r.txHash).toMatch(/^SIGNED_/);
  });

  it('submitMint wraps signer errors in MintFailedError', async () => {
    const failingSigner = async () => {
      throw new Error('signature rejected by user');
    };
    await expect(
      submitMint(
        { message: '0x' + 'ab'.repeat(40), signature: '0x' + 'cd'.repeat(70), sourceAccount: SOURCE },
        failingSigner,
        makeRpc()
      )
    ).rejects.toThrow(MintFailedError);
  });

  it('buildMintAndForwardXdr builds parseable Stellar XDR', () => {
    const xdr = buildMintAndForwardXdr({
      message: '0x' + 'ab'.repeat(40),
      signature: '0x' + 'cd'.repeat(70),
      sourceAccount: SOURCE,
      forwarderContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    });
    expect(typeof xdr).toBe('string');
    const parsed: any = (TransactionBuilder as any).fromXDR(xdr, 'TESTNET');
    expect(parsed.source).toBe(SOURCE);
  });

  it('keeps the mint transaction valid beyond the confirmation window', () => {
    // Regression: setTimeout(30) expired the tx before submitMint's poll window
    // (DEFAULT_CONFIRM_ATTEMPTS × DEFAULT_CONFIRM_POLL_MS = 20 × 3000ms = 60s) could
    // finish. A tx that was slow to be included then died with txTOO_LATE — dropped,
    // its sequence never consumed — and was reported as MINT_UNCONFIRMED even though
    // it could never confirm. The validity window must outlive the poll window.
    const xdr = buildMintAndForwardXdr({
      message: '0x' + 'ab'.repeat(40),
      signature: '0x' + 'cd'.repeat(70),
      sourceAccount: SOURCE,
    });
    const tx: any = (TransactionBuilder as any).fromXDR(xdr, 'TESTNET');
    const confirmWindowSeconds = (20 * 3000) / 1000;
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);

    expect(maxTime).toBeGreaterThan(0);
    expect(maxTime - Math.floor(Date.now() / 1000)).toBeGreaterThan(confirmWindowSeconds);
  });

  it('submitMint passes real XDR to signer', async () => {
    let captured = '';
    const r = await submitMint(
      {
        message: '0x' + 'ab'.repeat(40),
        signature: '0x' + 'cd'.repeat(70),
        sourceAccount: SOURCE,
      },
      async (x) => {
        captured = x;
        return 'TX_REAL';
      },
      makeRpc()
    );
    expect(r.txHash).toBe('TX_REAL');
    expect(() => (TransactionBuilder as any).fromXDR(captured, 'TESTNET')).not.toThrow();
  });

  it('buildMintAndForwardXdr throws ForwarderContractError for invalid contract ID', () => {
    expect(() =>
      buildMintAndForwardXdr({
        message: '0x' + 'ab'.repeat(40),
        signature: '0x' + 'cd'.repeat(70),
        sourceAccount: SOURCE,
        forwarderContractId: 'INVALID_CONTRACT',
      })
    ).toThrow(ForwarderContractError);
  });
});

describe('Forwarder sourceSequence', () => {
  it('buildMintAndForwardXdr honors sourceSequence', () => {
    const msg = '0x' + 'ab'.repeat(32);
    const sig = '0x' + 'cd'.repeat(64);
    const xdrNoSeq = buildMintAndForwardXdr({ message: msg, signature: sig, sourceAccount: SOURCE });
    const xdrWithSeq = buildMintAndForwardXdr({ message: msg, signature: sig, sourceAccount: SOURCE, sourceSequence: '987654' });
    expect(xdrNoSeq).not.toBe(xdrWithSeq);
    const tx: any = TransactionBuilder.fromXDR(xdrWithSeq, 'Test SDF Network ; September 2015');
    expect(String(tx.sequence)).toBe('987655');
  });
});

describe('Forwarder network selection', () => {
  it('resolveForwarder returns testnet CA66.. by default and mainnet CBZL.. on request', async () => {
    expect(TESTNET_FORWARDER).toBe('CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ');
    expect(MAINNET_FORWARDER).toBe('CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T');
    expect(resolveForwarder('testnet')).toBe(TESTNET_FORWARDER);
    expect(resolveForwarder('mainnet')).toBe(MAINNET_FORWARDER);
  });
});

describe('Forwarder branch coverage', () => {
  it('translateToStellar rejects non-string input', () => {
    expect(() => translateToStellar(123 as any)).toThrow(InvalidAddressError);
  });

  it('translateToStellar rejects invalid hex with 0x prefix', () => {
    expect(() => translateToStellar('0xZZZ')).toThrow(InvalidAddressError);
  });

  it('translateToStellar rejects hex with wrong length', () => {
    expect(() => translateToStellar('0x' + 'ab'.repeat(10))).toThrow(InvalidAddressError);
  });

  it('submitMint re-throws ForwarderContractError as-is', async () => {
    await expect(
      submitMint(
        {
          message: '0x' + 'ab'.repeat(40),
          signature: '0x' + 'cd'.repeat(70),
          sourceAccount: SOURCE,
          forwarderContractId: 'INVALID_CONTRACT',
        },
        async () => 'x',
        makeRpc(),
      )
    ).rejects.toThrow(ForwarderContractError);
  });

  it('submitMint wraps non-ForwarderContractError in MintFailedError', async () => {
    const failingSigner = async () => {
      throw new Error('wallet rejected');
    };
    await expect(
      submitMint(
        { message: '0x' + 'ab'.repeat(40), signature: '0x' + 'cd'.repeat(70), sourceAccount: SOURCE },
        failingSigner,
        makeRpc(),
      )
    ).rejects.toMatchObject({ code: 'MINT_FAILED' });
  });

  it('resolveForwarder returns mainnet id starting with C', () => {
    expect(resolveForwarder('mainnet')).toMatch(/^C/);
    expect(resolveForwarder('mainnet')).not.toBe(resolveForwarder('testnet'));
  });

  it('buildMintAndForwardXdr throws ForwarderContractError on bad contract', () => {
    expect(() => buildMintAndForwardXdr({
      message: '0xab', signature: '0xcd', sourceAccount: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x33)),
      forwarderContractId: 'CINVALID',
    })).toThrow(ForwarderContractError);
  });
});

describe('M2: hexToBytes strict validation', () => {
  const src = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x33));

  it('rejects non-hex charset in message', () => {
    expect(() => buildMintAndForwardXdr({ message: '0xZZZ', signature: '0x1234', sourceAccount: src })).toThrow(ForwarderContractError);
  });

  it('rejects odd-length hex in signature', () => {
    expect(() => buildMintAndForwardXdr({ message: '0x' + 'ab'.repeat(32), signature: '0xabc', sourceAccount: src })).toThrow(ForwarderContractError);
  });
});

describe('C9: resolveForwarder requires explicit network', () => {
  it('throws InvalidConfigError when called with undefined', () => {
    expect(() => resolveForwarder(undefined)).toThrow(InvalidConfigError);
    expect(() => resolveForwarder(undefined)).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('returns correct IDs for explicit values', () => {
    expect(resolveForwarder('testnet')).toBe(TESTNET_FORWARDER);
    expect(resolveForwarder('mainnet')).toBe(MAINNET_FORWARDER);
  });
});

describe('M5/O4: translateToStellar rejects zero addresses', () => {
  it('rejects 20-byte zero address', () => {
    expect(() => translateToStellar('0x' + '00'.repeat(20))).toThrow(InvalidAddressError);
    expect(() => translateToStellar('0x' + '00'.repeat(20))).toThrow(expect.objectContaining({ code: 'INVALID_ADDRESS' }));
  });

  it('rejects 32-byte zero address', () => {
    expect(() => translateToStellar('0x' + '00'.repeat(32))).toThrow(InvalidAddressError);
    expect(() => translateToStellar('0x' + '00'.repeat(32))).toThrow(expect.objectContaining({ code: 'INVALID_ADDRESS' }));
  });
});

describe('O15: sourceAccount / sponsor param', () => {
  const sponsor = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x77));
  const msg = '0x' + 'ab'.repeat(40);
  const sig = '0x' + 'cd'.repeat(70);

  it('buildMintAndForwardXdr uses sourceAccount as tx source when provided', () => {
    const xdr = buildMintAndForwardXdr({
      message: msg,
      signature: sig,
      sourceAccount: sponsor,
    });
    const tx: any = TransactionBuilder.fromXDR(xdr, 'TESTNET');
    expect(tx.source).toBe(sponsor);
  });

  it('buildMintAndForwardXdr throws InvalidAddressError when sourceAccount absent', () => {
    expect(() =>
      buildMintAndForwardXdr({
        message: msg,
        signature: sig,
      } as any)
    ).toThrow(InvalidAddressError);
  });

  it('buildMintAndForwardXdr throws InvalidAddressError for invalid sourceAccount', () => {
    expect(() =>
      buildMintAndForwardXdr({
        message: msg,
        signature: sig,
        sourceAccount: 'INVALID_SPONSOR',
      })
    ).toThrow(InvalidAddressError);
  });
});

describe('B3+B4: submitMint broadcasts, assembles and confirms', () => {
  const mintParams = {
    message: '0x' + 'ab'.repeat(64),
    signature: '0x' + 'cd'.repeat(65),
    sourceAccount: SOURCE,
    sourceSequence: '1',
  };

  it('broadcasts and confirms: returns network hash only after SUCCESS', async () => {
    let simmedXdr = '';
    const signerSaw: string[] = [];
    const sentSigned: string[] = [];
    const rpc = makeRpc({
      simulateTransaction: async (xdr) => {
        simmedXdr = xdr;
        return { sim: true };
      },
      assembleTransaction: (xdr) => xdr + '-assembled',
      sendTransaction: async (signedXdr) => {
        sentSigned.push(signedXdr);
        return { status: 'PENDING', hash: 'deadbeef' };
      },
    });

    const r = await submitMint(
      mintParams,
      async (x) => {
        signerSaw.push(x);
        return x + '-signed';
      },
      rpc
    );

    // B4: the transaction really was simulated and the *assembled* envelope went to the signer.
    expect(() => (TransactionBuilder as any).fromXDR(simmedXdr, 'TESTNET')).not.toThrow();
    expect(signerSaw).toEqual([simmedXdr + '-assembled']);
    expect(sentSigned).toEqual([simmedXdr + '-assembled-signed']);
    // B3: txHash is the network hash — never the XDR we built, assembled or signed.
    expect(r.txHash).toBe('deadbeef');
    expect(r.txHash).not.toBe(simmedXdr);
    expect(r.txHash).not.toBe(signerSaw[0]);
  });

  it('throws MintUnconfirmedError when confirmation never arrives', async () => {
    const rpc = makeRpc({ getTransaction: async () => ({ status: 'NOT_FOUND' }) });
    await expect(
      submitMint(mintParams, async (x) => x, rpc, { maxAttempts: 2, pollIntervalMs: 0 })
    ).rejects.toThrow(/unconfirmed/i);
    await expect(
      submitMint(mintParams, async (x) => x, rpc, { maxAttempts: 2, pollIntervalMs: 0 })
    ).rejects.toMatchObject({ code: 'MINT_UNCONFIRMED' });
  });

  it('polls until SUCCESS instead of returning on the first NOT_FOUND', async () => {
    let polls = 0;
    const rpc = makeRpc({
      sendTransaction: async () => ({ status: 'PENDING', hash: 'hash-2nd' }),
      getTransaction: async () => {
        polls += 1;
        return polls === 1 ? { status: 'NOT_FOUND' } : { status: 'SUCCESS' };
      },
    });
    const r = await submitMint(mintParams, async (x) => x, rpc, { maxAttempts: 5, pollIntervalMs: 1 });
    expect(r.txHash).toBe('hash-2nd');
    expect(polls).toBe(2);
  });

  it('keeps polling when getTransaction throws a transient RPC error, then confirms', async () => {
    let polls = 0;
    const rpc = makeRpc({
      sendTransaction: async () => ({ status: 'PENDING', hash: 'hash-transient' }),
      getTransaction: async () => {
        polls += 1;
        if (polls < 3) throw new Error('fetch failed: ECONNRESET');
        return { status: 'SUCCESS' };
      },
    });
    const r = await submitMint(mintParams, async (x) => x, rpc, { maxAttempts: 5, pollIntervalMs: 0 });
    expect(r.txHash).toBe('hash-transient');
    expect(polls).toBe(3);
  });

  it('reports persistent getTransaction failures as MINT_UNCONFIRMED, not MINT_FAILED', async () => {
    const rpc = makeRpc({
      sendTransaction: async () => ({ status: 'PENDING', hash: 'deadbeef' }),
      getTransaction: async () => {
        throw new Error('fetch failed: ETIMEDOUT');
      },
    });
    const err = await submitMint(mintParams, async (x) => x, rpc, {
      maxAttempts: 3,
      pollIntervalMs: 0,
    }).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(MintFailedError);
    expect(err).toBeInstanceOf(MintUnconfirmedError);
    const unconfirmed = err as MintUnconfirmedError;
    expect(unconfirmed.code).toBe('MINT_UNCONFIRMED');
    // the broadcast hash must survive for reconciliation
    expect(unconfirmed.mintTxHash).toBe('deadbeef');
    expect(unconfirmed.message).toContain('deadbeef');
  });

  it('throws MintFailedError when send status is not PENDING', async () => {
    const rpc = makeRpc({ sendTransaction: async () => ({ status: 'ERROR' }) });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toMatchObject({
      code: 'MINT_FAILED',
    });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toThrow(/send status=ERROR/);
  });

  it('throws MintFailedError when PENDING arrives without a hash', async () => {
    const rpc = makeRpc({ sendTransaction: async () => ({ status: 'PENDING' }) });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toMatchObject({
      code: 'MINT_FAILED',
    });
  });

  it('throws MintFailedError when the network reports FAILED', async () => {
    const rpc = makeRpc({
      sendTransaction: async () => ({ status: 'PENDING', hash: 'deadbeef' }),
      getTransaction: async () => ({ status: 'FAILED' }),
    });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toMatchObject({
      code: 'MINT_FAILED',
    });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toThrow(/FAILED on network/);
  });

  it('throws MintFailedError when simulation fails (B4 fail-closed)', async () => {
    const rpc = makeRpc({
      simulateTransaction: async () => {
        throw new Error('rpc down');
      },
    });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toMatchObject({
      code: 'MINT_FAILED',
    });
    await expect(submitMint(mintParams, async (x) => x, rpc)).rejects.toThrow(/simulate: rpc down/);
  });
});

describe('B2: mint_and_forward takes exactly [message, attestation]', () => {
  it('calls mint_and_forward with exactly [message, attestation], no destination arg', () => {
    const xdr = buildMintAndForwardXdr({
      message: '0x' + 'ab'.repeat(64),
      signature: '0x' + 'cd'.repeat(65),
      sourceAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      sourceSequence: '123',
    });
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    const op = tx.operations[0] as unknown as {
      func: { invokeContract(): { functionName(): { toString(): string }; args(): unknown[] } };
    };
    const invoked = op.func.invokeContract();
    expect(invoked.functionName().toString()).toBe('mint_and_forward');
    expect(invoked.args()).toHaveLength(2);
  });
});
