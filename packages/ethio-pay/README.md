# `ethio-pay`

[![npm version](https://img.shields.io/npm/v/ethio-pay.svg)](https://www.npmjs.com/package/ethio-pay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Unified Payment SDK and Webhook Simulator for Ethiopian payment providers (Chapa, Telebirr, CBE Birr).

The `ethio-pay` umbrella package bundles `@ethio-pay/core` and all official payment provider adapters into a single, convenient installation.

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

## 🚀 Quickstart

```typescript
import { EthiopianPayments, ChapaAdapter } from 'ethio-pay';

// 1. Configure provider adapters
const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY!,
  secretHash: process.env.CHAPA_SECRET_HASH!,
});

// 2. Initialize the unified client
const sdk = new EthiopianPayments({
  providers: [chapa],
});

// 3. Create a payment checkout session
const session = await sdk.initialize({
  provider: 'chapa',
  amount: 250,
  currency: 'ETB',
  reference: `TX-${Date.now()}`,
  customer: {
    name: 'Abebe Bikila',
    email: 'abebe@example.com',
    phoneNumber: '0911234567',
  },
  returnUrl: 'https://my-store.com/checkout/success',
  callbackUrl: 'https://my-store.com/api/webhooks/chapa',
});

console.log('Redirect user to checkout:', session.checkoutUrl);
```

---

## 🛡️ Webhook Verification & Processing

```typescript
import express from 'express';
import { EthiopianPayments, ChapaAdapter, createIdempotencyMiddleware } from 'ethio-pay';

const app = express();
const sdk = new EthiopianPayments({
  providers: [
    new ChapaAdapter({
      secretKey: process.env.CHAPA_SECRET_KEY!,
      secretHash: process.env.CHAPA_SECRET_HASH!,
    }),
  ],
});

app.post(
  '/api/webhooks/chapa',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(), // Prevents duplicate delivery
  (req, res) => {
    // 1. Constant-time HMAC-SHA256 signature verification
    sdk.webhooks.verify('chapa', req.body, req.headers);

    // 2. Parse normalized event
    const event = sdk.webhooks.parse('chapa', req.body, req.headers);

    if (event.type === 'payment.succeeded') {
      console.log(`Payment confirmed: ${event.reference} for ${event.amount} ETB`);
    }

    return res.status(200).json({ status: 'success' });
  }
);
```

---

## 📚 Monorepo Packages

If you prefer lightweight modular imports, you can also install individual packages:

* [`@ethio-pay/core`](https://www.npmjs.com/package/@ethio-pay/core) - Core domain types, HTTP client, HMAC verification, and middleware
* [`@ethio-pay/chapa`](https://www.npmjs.com/package/@ethio-pay/chapa) - Chapa adapter implementation
* [`@ethio-pay/sandbox`](https://www.npmjs.com/package/@ethio-pay/sandbox) - Local payment simulator & dashboard CLI (`ethio-pay-sandbox`)

---

## 📄 License

MIT © [Ethio-Pay Contributors](https://github.com/Masud-Wubetu/Ethio-Pay)
