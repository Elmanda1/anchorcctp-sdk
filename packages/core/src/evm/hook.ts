import { StrKey } from '@stellar/stellar-sdk';

export function contractStrkeyToBytes32(strkey: string): `0x${string}` {
  if (!StrKey.isValidContract(strkey)) {
    throw new Error(`Invalid contract strkey: ${strkey}`);
  }
  return `0x${Buffer.from(StrKey.decodeContract(strkey)).toString('hex')}`;
}

// Circle's CctpForwarder expects hookData as:
// 24 zero magic bytes │ u32be version (0 = utf8 strkey) │ u32be length L │ L bytes utf8 strkey.
export function buildCctpForwarderHookData(forwardRecipientStrkey: string): `0x${string}` {
  const kind = StrKey.isValidEd25519PublicKey(forwardRecipientStrkey)
    ? 'ed25519'
    : StrKey.isValidContract(forwardRecipientStrkey)
      ? 'contract'
      : StrKey.isValidMed25519PublicKey(forwardRecipientStrkey)
        ? 'med25519'
        : null;

  if (!kind) {
    throw new Error(`Invalid forward recipient: ${forwardRecipientStrkey}`);
  }

  const recipientBytes = Buffer.from(forwardRecipientStrkey, 'utf8');
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24);
  hookData.writeUInt32BE(recipientBytes.length, 28);
  recipientBytes.copy(hookData, 32);
  return `0x${hookData.toString('hex')}`;
}
