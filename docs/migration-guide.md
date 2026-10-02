# Migration Guide: Integrating AnchorCCTP into Existing Anchor Infrastructure

This guide walks through migrating existing Stellar anchor backend services from legacy custodial bridging rails or manual deposits to the unified AnchorCCTP SDK.

---

## 1. Overview & Architecture Transition

### Legacy Flow
Previously, anchors accepting cross-chain USDC relied on:
- Custodial EVM hot wallets monitoring Ethereum/Base logs.
- Centralized exchange rebalancing or third-party bridge APIs.
- Custom database schemas for each external chain.

### AnchorCCTP Native Flow
With AnchorCCTP:
- Direct 1:1 burn-and-mint settlement using Circle's Iris protocol across 30 chains.
- Universal domain routing with deterministic address translation.
- Single unified SDK interface (`receive()`) with built-in replay protection and decimal math.

---

## 2. Step-by-Step Migration

### Step 1: Install AnchorCCTP Packages

```bash
npm install @anchor-cctp/core
# Optional CLI for DevOps and ops verification
npm install -g @anchor-cctp/cli
```

### Step 2: Publish CCTP Metadata to `stellar.toml`

Run the CLI `init` command to append CCTP capabilities to your anchor's `stellar.toml`:

```bash
# Testnet issuer shown; mainnet: --usdc-issuer GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
anchor-cctp init \
  --domain 27 \
  --usdc-issuer GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --output ./public/.well-known/stellar.toml
```

This advertises your Soroban forwarder address and supported CCTP source chains to cross-chain wallets.

### Step 3: Replace Backend Ingestion Logic

Replace custom multi-chain listeners with the AnchorCCTP client:

```ts
// BEFORE: Bespoke multi-chain listeners and conversion math
// ... custom web3 listeners, decimal dividing, manual minting ...

// AFTER: Single AnchorCCTP Client
import { createAnchorCCTP } from '@anchor-cctp/core';

const anchorCctp = createAnchorCCTP({
  dustCollectorAddress: process.env.ANCHOR_DUST_COLLECTOR,
  trustline: {
    allowCreation: true,
    spendCapXlm: 2,
  },
  signer: async (xdr: string) => {
    // Delegate to your anchor's Soroban sponsor signing service / KMS
    return await signWithKms(xdr);
  },
});

// Process incoming CCTP deposit
export async function handleCctpDeposit(burnTxHash: string, sourceDomain: number, userStellarAddress: string) {
  try {
    const settlement = await anchorCctp.receive({
      burnTxHash,
      sourceDomain,
      destinationAddress: userStellarAddress,
    });

    console.log(`Successfully credited ${settlement.amount} stroops via tx ${settlement.txHash}`);
    return settlement;
  } catch (error) {
    console.error(`CCTP settlement failed: [${error.code}] ${error.message}`);
    throw error;
  }
}
```

### Step 4: Decimal & Dust Handling Alignment

Ensure your internal accounting ledger reflects 7-decimal Stroop quantities ($1 \text{ USDC} = 10,000,000 \text{ stroops}$):
- Incoming 6-decimal amounts are automatically multiplied by 10.
- Any fractional sub-stroop dust is automatically routed to your configured `dustCollectorAddress`.

---

## 3. Compatibility Matrix

| Feature | Legacy Rails | AnchorCCTP SDK |
|---|---|---|
| **Supported Chains** | 1–3 custom integrations | 30 CCTP chains out of the box |
| **Finality Time** | 10–30 mins (bridge dependent) | Circle Iris finality (~1–3 mins) |
| **Trust Model** | Custodial / Bridge multi-sig | Circle native mint + Soroban contract |
| **Replay Protection**| Custom DB tracking | Built-in cryptographic idempotency |
| **Error Handling** | Unstandardized exceptions | Typed `AnchorCCTPError` with remediations |
