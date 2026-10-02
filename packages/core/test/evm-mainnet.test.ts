import {
  planBurn,
  executeBurn,
  EVM_MAINNET_MESSENGER,
  MAINNET_CHAIN_IDS,
  MAINNET_USDC_BY_CHAIN_ID,
  messengerForChain,
  usdcForChain,
} from '../src/evm/burn.js';

const FWD = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T';
const DEST = 'GCX2EQXSPCHMBSEGYZRVTZWOIDRXWRWYEFRTCNVOZPYXE4QEFPKNUF3V';

describe('mainnet messenger registry', () => {
  test('mainnet messenger differs from testnet singleton', () => {
    expect(EVM_MAINNET_MESSENGER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(EVM_MAINNET_MESSENGER.toLowerCase()).not.toBe(
      '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    );
  });

  test('MAINNET_CHAIN_IDS covers Base/Ethereum/Arbitrum/OP/Avalanche/Polygon', () => {
    for (const id of [1, 43114, 10, 42161, 8453, 137]) {
      expect(MAINNET_CHAIN_IDS.has(id)).toBe(true);
    }
    // testnet ids must never leak into the mainnet allowlist
    for (const id of [84532, 421614, 11155111, 43113]) {
      expect(MAINNET_CHAIN_IDS.has(id)).toBe(false);
    }
  });

  test('usdcForChain returns native USDC for known mainnet chains', () => {
    expect(usdcForChain(8453)).toBe(MAINNET_USDC_BY_CHAIN_ID[8453]);
    expect(usdcForChain(1)).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('usdcForChain throws for unknown chain without explicit token', () => {
    expect(() => usdcForChain(999999)).toThrow(/no known mainnet USDC/i);
  });

  test('messengerForChain: mainnet resolves V2 messenger, testnet resolves legacy', () => {
    expect(messengerForChain(8453, 'mainnet')).toBe(EVM_MAINNET_MESSENGER);
    expect(messengerForChain(84532, 'testnet')).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('planBurn mainnet Base defaults to mainnet messenger + Base USDC', () => {
    const plan = planBurn({
      amount: 1_000_000n,
      stellarDestination: DEST,
      forwarderContractId: FWD,
      maxFee: 130n,
      network: 'mainnet',
      chainId: 8453,
    });
    expect(plan.messenger).toBe(EVM_MAINNET_MESSENGER);
    expect(plan.burnToken.toLowerCase()).toBe(
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    );
  });

  test('planBurn mainnet unknown chain without explicit addresses throws', () => {
    expect(() =>
      planBurn({
        amount: 1_000_000n,
        stellarDestination: DEST,
        forwarderContractId: FWD,
        maxFee: 130n,
        network: 'mainnet',
        chainId: 999999,
      }),
    ).toThrow(/no known mainnet USDC/i);
  });

  test('planBurn mainnet missing chainId throws unless both addresses explicit', () => {
    expect(() =>
      planBurn({
        amount: 1_000_000n,
        stellarDestination: DEST,
        forwarderContractId: FWD,
        maxFee: 130n,
        network: 'mainnet',
      }),
    ).toThrow(/chainId is required on mainnet/i);
    const explicit = planBurn({
      amount: 1_000_000n,
      stellarDestination: DEST,
      forwarderContractId: FWD,
      maxFee: 130n,
      network: 'mainnet',
      burnToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      messenger: EVM_MAINNET_MESSENGER,
    });
    expect(explicit.messenger).toBe(EVM_MAINNET_MESSENGER);
  });

  test('planBurn testnet default unchanged (no silent mainnet switch)', () => {
    const plan = planBurn({
      amount: 1_000_000n,
      stellarDestination: DEST,
      forwarderContractId: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
      maxFee: 5000n,
    });
    expect(plan.messenger.toLowerCase()).toBe(
      '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    );
  });

  test('executeBurn mainnet allows 8453, rejects testnet 84532', async () => {
    const plan = planBurn({
      amount: 1_000_000n,
      stellarDestination: DEST,
      forwarderContractId: FWD,
      maxFee: 130n,
      network: 'mainnet',
      chainId: 8453,
    });
    const fakes = (chainId: number) => ({
      publicClient: {
        getChainId: async () => chainId,
        getBalance: async () => 10n ** 16n,
        readContract: async () => 5_000_000n,
        waitForTransactionReceipt: async () => ({ status: 'success' }),
      },
      walletClient: { writeContract: async () => '0xdeadbeef' as `0x${string}` },
      account: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    });
    const ok = fakes(8453);
    const r = await executeBurn({
      ...ok,
      plan,
      expectedChainId: 8453,
      network: 'mainnet',
    });
    expect(r.burnTxHash).toBe('0xdeadbeef');

    const bad = fakes(84532);
    await expect(
      executeBurn({ ...bad, plan, expectedChainId: 84532, network: 'mainnet' }),
    ).rejects.toThrow(/EVM_CHAIN_PIN/);
  });
});
