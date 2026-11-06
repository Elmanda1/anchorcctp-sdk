import { StrKey } from '@stellar/stellar-sdk';
import { encodeFunctionData } from 'viem';
import { buildCctpForwarderHookData, contractStrkeyToBytes32 } from '../src/evm/hook.js';
import { MESSENGER_ABI } from '../src/evm/burn.js';

const FWD = 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ';
const DEST = 'GCX2EQXSPCHMBSEGYZRVTZWOIDRXWRWYEFRTCNVOZPYXE4QEFPKNUF3V';
// med25519 (M...) form of DEST with muxed id 0 — needed because the plan's
// 52-char M... literal has an invalid checksum and never reaches the muxed branch.
const DEST_MUXED = 'MCX2EQXSPCHMBSEGYZRVTZWOIDRXWRWYEFRTCNVOZPYXE4QEFPKNUAAAAAAAAAAAABFBI';

describe('contractStrkeyToBytes32', () => {
  test('decodes testnet forwarder to 0x bytes32', () => {
    const got = contractStrkeyToBytes32(FWD);
    expect(got).toMatch(/^0x[0-9a-f]{64}$/);
    expect(got).toBe(`0x${Buffer.from(StrKey.decodeContract(FWD)).toString('hex')}`);
  });
  test('rejects G... account strkey', () => {
    expect(() => contractStrkeyToBytes32(DEST)).toThrow('Invalid contract strkey');
  });
});

describe('buildCctpForwarderHookData', () => {
  it('encodes G... to Circle layout: 24 zero bytes, u32be version 0, u32be len, strkey utf8', () => {
    const out = buildCctpForwarderHookData('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    const bytes = Buffer.from(out.slice(2), 'hex');
    expect(bytes.length).toBe(32 + 56);
    expect(bytes.subarray(0, 24).every((b) => b === 0)).toBe(true);
    expect(bytes.readUInt32BE(24)).toBe(0);
    expect(bytes.readUInt32BE(28)).toBe(56);
    expect(bytes.subarray(32).toString('utf8')).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });

  test('encodes C... contract recipient to the same utf8 layout', () => {
    const bytes = Buffer.from(buildCctpForwarderHookData(FWD).slice(2), 'hex');
    expect(bytes.length).toBe(32 + 56);
    expect(bytes.readUInt32BE(24)).toBe(0);
    expect(bytes.readUInt32BE(28)).toBe(56);
    expect(bytes.subarray(32).toString('utf8')).toBe(FWD);
  });

  test('encodes muxed M... recipient to the Circle utf8 layout (length 69)', () => {
    const out = buildCctpForwarderHookData(DEST_MUXED);
    const bytes = Buffer.from(out.slice(2), 'hex');
    expect(bytes.length).toBe(32 + 69);
    expect(bytes.subarray(0, 24).every((b) => b === 0)).toBe(true);
    expect(bytes.readUInt32BE(24)).toBe(0); // version 0
    expect(bytes.readUInt32BE(28)).toBe(69); // length 69
    expect(bytes.subarray(32).toString('utf8')).toBe(DEST_MUXED);
  });

  test('rejects garbage recipient (fund-loss guard)', () => {
    expect(() => buildCctpForwarderHookData('NOT_AN_ADDRESS')).toThrow('Invalid forward recipient');
  });

  test('O3 round-trip: encodeFunctionData → decode hookData bytes (no double-encode)', () => {
    const hookData = buildCctpForwarderHookData(DEST);
    const fakeMint = '0x' + '01'.repeat(32) as `0x${string}`;
    const fakeCaller = '0x' + '01'.repeat(32) as `0x${string}`;
    const burnToken = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
    const messenger = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`;

    const calldata = encodeFunctionData({
      abi: MESSENGER_ABI,
      functionName: 'depositForBurnWithHook',
      args: [1n, 27, fakeMint, burnToken, fakeCaller, 5000n, 1000, hookData],
    });

    const hex = calldata.slice(2); // strip 0x
    // calldata = 4-byte selector + ABI head (8×32) + tail
    // Selector: hex[0..8], Head: hex[8..520], Tail: hex[520..]
    const selectorEnd = 8; // 4 bytes = 8 hex chars
    const headSlot7Offset = selectorEnd + 7 * 64; // param 7 offset slot
    const offsetHex = hex.slice(headSlot7Offset, headSlot7Offset + 64);
    const offsetFromHead = Number(BigInt('0x' + offsetHex)); // relative to head start

    const tailStart = selectorEnd + offsetFromHead * 2;
    const lenHex = hex.slice(tailStart, tailStart + 64);
    const dataLen = Number(BigInt('0x' + lenHex));
    const dataHex = hex.slice(tailStart + 64, tailStart + 64 + dataLen * 2);
    const decodedBytes = ('0x' + dataHex) as `0x${string}`;

    expect(decodedBytes).toBe(hookData);
    expect(dataLen).toBe(32 + 56); // Circle layout: 32-byte header + 56-char strkey utf8
  });
});
