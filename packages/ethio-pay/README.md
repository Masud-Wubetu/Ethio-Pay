# `ethio-pay`

[![npm version](https://img.shields.io/npm/v/ethio-pay.svg)](https://www.npmjs.com/package/ethio-pay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Unified Payment SDK and Webhook Simulator for Ethiopian payment providers (Chapa, Telebirr, CBE Birr).

The `ethio-pay` umbrella package bundles `@ethio-pay/core` and all official payment provider adapters (`@ethio-pay/chapa`, `@ethio-pay/telebirr`) into a single, convenient installation.

---

## 📦 Installation

```bash
npm install ethio-pay
# or
pnpm add ethio-pay
# or
yarn add ethio-pay
```

---

## 🚀 Quickstart: Unified Multi-Provider Client

```typescript
import { EthiopianPayments, ChapaAdapter, TelebirrAdapter } from 'ethio-pay';

// 1. Configure Chapa Adapter
const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY!,
  secretHash: process.env.CHAPA_SECRET_HASH!,
});

// 2. Configure Telebirr Adapter (Ethio Telecom Fabric / H5)
const telebirr = new TelebirrAdapter({
  appId: process.env.TELEBIRR_APP_ID!,
  appKey: process.env.TELEBIRR_APP_KEY!,
  shortCode: process.env.TELEBIRR_SHORT_CODE!,
  publicKey: process.env.TELEBIRR_PUBLIC_KEY!,
  privateKey: process.env.TELEBIRR_PRIVATE_KEY!,
});

// 3. Initialize the unified client with all providers
const sdk = new EthiopianPayments({
  providers: [chapa, telebirr],
});

// 4. Initialize a payment session (e.g. Telebirr H5 checkout)
const telebirrSession = await sdk.initialize({
  provider: 'telebirr',
  amount: 300,
  currency: 'ETB',
  reference: `TX-TB-${Date.now()}`,
  customer: {
    name: 'Abebe Bikila',
    phoneNumber: '0911223344',
  },
  returnUrl: 'https://my-store.com/checkout/success',
  callbackUrl: 'https://my-store.com/api/webhooks/telebirr',
});

console.log('Telebirr Checkout URL:', telebirrSession.checkoutUrl);

// 5. Query status by reference
const status = await sdk.verify('telebirr', telebirrSession.reference);
console.log('Payment status:', status.status); // e.g. 'SUCCEEDED' | 'PENDING' | 'FAILED'
```

---

## 🛡️ Webhook Verification & Processing

```typescript
import express from 'express';
import { EthiopianPayments, ChapaAdapter, TelebirrAdapter, createIdempotencyMiddleware } from 'ethio-pay';

const app = express();
const sdk = new EthiopianPayments({
  providers: [
    new ChapaAdapter({
      secretKey: process.env.CHAPA_SECRET_KEY!,
      secretHash: process.env.CHAPA_SECRET_HASH!,
    }),
    new TelebirrAdapter({
      appId: process.env.TELEBIRR_APP_ID!,
      appKey: process.env.TELEBIRR_APP_KEY!,
      shortCode: process.env.TELEBIRR_SHORT_CODE!,
      publicKey: process.env.TELEBIRR_PUBLIC_KEY!,
      privateKey: process.env.TELEBIRR_PRIVATE_KEY!,
    }),
  ],
});

// Telebirr Webhook Handler
app.post(
  '/api/webhooks/telebirr',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(), // Prevents duplicate delivery
  (req, res) => {
    // 1. Digital RSA-SHA256 signature verification
    sdk.webhooks.verify('telebirr', req.body, req.headers);

    // 2. Parse normalized event
    const event = sdk.webhooks.parse('telebirr', req.body, req.headers);

    if (event.type === 'payment.succeeded') {
      console.log(`Telebirr payment confirmed: ${event.reference} for ${event.amount} ETB`);
      // Fulfill order
    }

    return res.status(200).json({ code: 0, msg: 'success' });
  }
);
```

---

## 📚 Monorepo Packages

If you prefer lightweight modular imports, you can also install individual packages:

* [`@ethio-pay/core`](https://www.npmjs.com/package/@ethio-pay/core) - Core domain types, HTTP client, HMAC verification, and middleware
* [`@ethio-pay/telebirr`](https://www.npmjs.com/package/@ethio-pay/telebirr) - Telebirr Fabric & H5 adapter implementation
* [`@ethio-pay/chapa`](https://www.npmjs.com/package/@ethio-pay/chapa) - Chapa adapter implementation
* [`@ethio-pay/sandbox`](https://www.npmjs.com/package/@ethio-pay/sandbox) - Local payment simulator & dashboard CLI (`ethio-pay-sandbox`)

---

## 📄 License

MIT © [Ethio-Pay Contributors](https://github.com/Masud-Wubetu/Ethio-Pay)
