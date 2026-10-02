import { parseAbi } from 'viem';
import { buildCctpForwarderHookData, contractStrkeyToBytes32 } from './hook.js';
import { MAX_CCTP_AMOUNT } from '../decimals/index.js';

export const EVM_TESTNET_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`;
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
/**
 * Mainnet TokenMessengerV2 — single CREATE2 address on every V2 EVM chain.
 * Source: `circlefin/cctp-go` `chains.go` (mirrors Circle docs contract table).
 */
export const EVM_MAINNET_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as `0x${string}`;
/** Native USDC per mainnet chainId. Unichain omitted: upstream lists a testnet chainId for it — add when confirmed. */
export const MAINNET_USDC_BY_CHAIN_ID: Readonly<Record<number, `0x${string}`>> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  5115: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  146: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
  480: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
  1329: '0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1',
  50: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  998: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  57073: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  98865: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};
/** F1-mainnet: mirror of TESTNET_CHAIN_IDS — testnet ids never admitted here. */
export const MAINNET_CHAIN_IDS = new Set(Object.keys(MAINNET_USDC_BY_CHAIN_ID).map(Number));

/** Native mainnet USDC for a chainId, or typed throw naming the chain. */
export function usdcForChain(chainId: number): `0x${string}` {
  const usdc = MAINNET_USDC_BY_CHAIN_ID[chainId];
  if (!usdc) throw new BurnError('INVALID_BURN_AMOUNT', `no known mainnet USDC for chainId=${chainId} — pass burnToken explicitly.`);
  return usdc;
}

/** Messenger by network: mainnet V2 singleton (allowlisted), testnet legacy singleton. */
export function messengerForChain(chainId: number, network: 'testnet' | 'mainnet'): `0x${string}` {
  if (network === 'mainnet') {
    if (!MAINNET_CHAIN_IDS.has(chainId)) {
      throw new BurnError('EVM_CHAIN_PIN', `chainId=${chainId} refused (not in mainnet allowlist).`);
    }
    return EVM_MAINNET_MESSENGER;
  }
  return EVM_TESTNET_MESSENGER;
}
export const STELLAR_DOMAIN = 27;
/** F1: testnet allowlist — every other chainId is refused before any write. */
export const TESTNET_CHAIN_IDS = new Set([84532, 421614, 11155111, 43113]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const MESSENGER_ABI = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) returns (uint64)',
]);

export interface BurnPlan {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  destinationCaller: `0x${string}`;
  burnToken: `0x${string}`;
  messenger: `0x${string}`;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData: `0x${string}`;
}

/** Circle CCTP finality tiers: Fast settles at threshold 1000, Standard at 2000. */
export const FINALITY_THRESHOLD_FAST = 1000;
export const FINALITY_THRESHOLD_STANDARD = 2000;

export interface PlanBurnParams {
  amount: bigint;
  stellarDestination: string;
  forwarderContractId: string;
  burnToken?: `0x${string}`;
  messenger?: `0x${string}`;
  /**
   * REQUIRED — no default. Fee values must come from Circle's fee API
   * (`GET /v2/burn/USDC/fees/{source}/{dest}`) via `resolveMaxFee`, never guessed.
   */
  maxFee?: bigint;
  /** Finality tier to request. Defaults to `'fast'` (threshold 1000). */
  transferMode?: 'fast' | 'standard';
  /** Burn network. Defaults `'testnet'` — mainnet needs explicit `chainId`. */
  network?: 'testnet' | 'mainnet';
  /**
   * EVM chainId for address/messenger resolution. Optional on testnet
   * (Base Sepolia defaults); required on mainnet so the right native USDC
   * is selected and no testnet address leaks across networks.
   */
  chainId?: number;
}

/** Pure: every EVM arg for a Stellar-bound burn. No network, no keys. */
export function planBurn(params: PlanBurnParams): BurnPlan {
  if (typeof params.amount !== 'bigint' || params.amount <= 0n) {
    throw new BurnError('INVALID_BURN_AMOUNT', `Amount must be > 0n, received ${params.amount}.`);
  }
  if (params.amount > MAX_CCTP_AMOUNT) {
    throw new BurnError('INVALID_BURN_AMOUNT', `Amount ${params.amount} exceeds MAX_CCTP_AMOUNT (${MAX_CCTP_AMOUNT}).`);
  }
  const network = params.network ?? 'testnet';
  if (network === 'mainnet' && params.chainId === undefined
    && (params.burnToken === undefined || params.messenger === undefined)) {
    throw new BurnError('INVALID_BURN_AMOUNT', 'chainId is required on mainnet unless both burnToken and messenger are explicit.');
  }
  const burnToken = params.burnToken
    ?? (network === 'mainnet' ? usdcForChain(params.chainId as number) : BASE_SEPOLIA_USDC);
  const messenger = params.messenger
    ?? (network === 'mainnet'
      ? messengerForChain(params.chainId as number, 'mainnet')
      : EVM_TESTNET_MESSENGER);
  if (!ADDRESS_RE.test(burnToken) || /^0x0+$/.test(burnToken)) throw new BurnError('INVALID_BURN_AMOUNT', `Invalid burnToken: ${burnToken}`);
  if (!ADDRESS_RE.test(messenger) || /^0x0+$/.test(messenger)) throw new BurnError('INVALID_BURN_AMOUNT', `Invalid messenger: ${messenger}`);
  if (params.maxFee === undefined) {
    throw new BurnError(
      'INVALID_BURN_AMOUNT',
      'maxFee is required — fetch it from GET /v2/burn/USDC/fees/{source}/{dest} and pass resolveMaxFee(amount, minimumFeeBps). Refusing to guess.'
    );
  }
  const maxFee = params.maxFee;
  if (maxFee > params.amount) throw new BurnError('INVALID_BURN_AMOUNT', `maxFee exceeds amount: ${maxFee} > ${params.amount}`);
  const mode = params.transferMode ?? 'fast';
  if (mode !== 'fast' && mode !== 'standard') {
    throw new BurnError('INVALID_BURN_AMOUNT', `transferMode must be 'fast'|'standard', got ${mode}`);
  }
  const fwd = contractStrkeyToBytes32(params.forwarderContractId);
  return {
    amount: params.amount,
    destinationDomain: STELLAR_DOMAIN,
    mintRecipient: fwd,
    destinationCaller: fwd,
    burnToken,
    messenger,
    maxFee,
    minFinalityThreshold: mode === 'fast' ? FINALITY_THRESHOLD_FAST : FINALITY_THRESHOLD_STANDARD,
    hookData: buildCctpForwarderHookData(params.stellarDestination),
  };
}

/**
 * Converts a fee-API `minimumFee` in basis points (a **ratio**, e.g. `1.3`) to
 * base-6 subunits with **ceiling**, using exact integer arithmetic only so no
 * amount ever passes through a float. Throws when the fee eats the amount.
 */
export function resolveMaxFee(amount: bigint, minimumFeeBps: number): bigint {
  if (!Number.isFinite(minimumFeeBps) || minimumFeeBps < 0) {
    throw new BurnError('INVALID_BURN_AMOUNT', `minimumFeeBps must be a non-negative number, got ${minimumFeeBps}`);
  }
  // Exact integer path: tenths of a bp keeps `1.3` exact (amount * bps / 10000, ceiling).
  const scaled = BigInt(Math.round(minimumFeeBps * 10));
  const result = (amount * scaled + 100_000n - 1n) / 100_000n;
  if (result > amount) throw new BurnError('INVALID_BURN_AMOUNT', `maxFee exceeds amount: ${result} > ${amount}`);
  return result;
}

export interface BurnClients {
  publicClient: {
    getChainId(): Promise<number>;
    getBalance(a: { address: `0x${string}` }): Promise<bigint>;
    readContract(a: unknown): Promise<unknown>;
    waitForTransactionReceipt(a: { hash: `0x${string}`; timeout: number }): Promise<{ status: string }>;
  };
  walletClient: {
    writeContract(a: unknown): Promise<`0x${string}`>;
  };
  account: `0x${string}` | { address: `0x${string}` };
}

export interface ExecuteBurnParams extends BurnClients {
  plan: BurnPlan;
  expectedChainId: number;
  /** Must match the plan's network. Defaults `'testnet'` — mainnet pins MAINNET_CHAIN_IDS. */
  network?: 'testnet' | 'mainnet';
}

export class BurnError extends Error {
  constructor(
    readonly code: 'EVM_CHAIN_PIN' | 'INSUFFICIENT_GAS' | 'INSUFFICIENT_USDC' | 'APPROVE_FAILED' | 'BURN_FAILED' | 'INVALID_BURN_AMOUNT',
    message: string
  ) {
    super(`${code}: ${message}`);
  }
}

/** Executes approve-if-needed + depositForBurnWithHook. Throws BurnError with actionable code. */
export async function executeBurn(params: ExecuteBurnParams): Promise<{ burnTxHash: `0x${string}` }> {
  const { publicClient, walletClient, account: rawAccount, plan, expectedChainId, network = 'testnet' } = params;
  const account = typeof rawAccount === 'string' ? rawAccount : rawAccount.address;
  const chainId = await publicClient.getChainId();
  const allowlist = network === 'mainnet' ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;
  if (chainId !== expectedChainId || !allowlist.has(chainId)) {
    throw new BurnError('EVM_CHAIN_PIN', `chainId=${chainId} refused (expected ${expectedChainId}, ${network} allowlist only).`);
  }
  if ((await publicClient.getBalance({ address: account })) === 0n) {
    throw new BurnError('INSUFFICIENT_GAS', 'EVM account has zero native balance.');
  }
  const balance = (await publicClient.readContract({
    address: plan.burnToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })) as bigint;
  if (balance < plan.amount) {
    throw new BurnError('INSUFFICIENT_USDC', `balance=${balance} < amount=${plan.amount}.`);
  }
  const allowance = (await publicClient.readContract({
    address: plan.burnToken, abi: ERC20_ABI, functionName: 'allowance', args: [account, plan.messenger],
  })) as bigint;
  if (allowance < plan.amount) {
    const approveHash = await walletClient.writeContract({
      address: plan.burnToken, abi: ERC20_ABI, functionName: 'approve',
      args: [plan.messenger, plan.amount], ...(typeof rawAccount === 'object' ? { account: rawAccount } : { account }),
    });
    const approveRcpt = await publicClient
      .waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 })
      .catch(() => ({ status: 'timeout' }));
    if (approveRcpt.status !== 'success') throw new BurnError('APPROVE_FAILED', `receipt=${approveRcpt.status}.`);
  }
  const burnTxHash = await walletClient.writeContract({
    address: plan.messenger, abi: MESSENGER_ABI, functionName: 'depositForBurnWithHook',
    args: [plan.amount, plan.destinationDomain, plan.mintRecipient, plan.burnToken,
      plan.destinationCaller, plan.maxFee, plan.minFinalityThreshold, plan.hookData],
    ...(typeof rawAccount === 'object' ? { account: rawAccount } : { account }),
  });
  const burnRcpt = await publicClient
    .waitForTransactionReceipt({ hash: burnTxHash, timeout: 120_000 })
    .catch(() => ({ status: 'timeout' }));
  if (burnRcpt.status !== 'success') throw new BurnError('BURN_FAILED', `receipt=${burnRcpt.status}.`);
  return { burnTxHash };
}
