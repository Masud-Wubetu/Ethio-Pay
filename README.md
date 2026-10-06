# 🇪🇹 Ethio-Pay: Unified Payment SDK & Local Webhook Simulator

> **Unofficial Community Project.** Not affiliated with Chapa, Telebirr, CBE Birr, or any bank.

Ethio-Pay is a modern TypeScript/Node.js monorepo providing:
1. **Unified Payment SDK (`@ethio-pay/core`, `@ethio-pay/chapa`)**: A single clean API to initialize payments, verify statuses, and process HMAC-signed webhooks across Ethiopian payment providers.
2. **Local Webhook Simulator CLI (`@ethio-pay/sandbox`)**: A local dev tool (`ethio-pay-sandbox`) that emulates payment gateways with a web dashboard, signed webhooks, and failure/attack edge-case scenarios.

---

## 📦 Packages in this Monorepo

| Package | Version | Description |
|---|---|---|
| [`@ethio-pay/core`](./packages/core) | `0.1.0` | Core domain types, `PaymentProvider` contract, `HttpClient` with retry/backoff, and `Idempotency` middleware |
| [`@ethio-pay/chapa`](./packages/chapa) | `0.1.0` | Chapa Payment Provider Adapter implementation |
| [`@ethio-pay/sandbox`](./packages/sandbox) | `0.1.0` | Local Webhook Simulator server & `ethio-pay-sandbox` CLI binary |
| [`@ethio-pay/example-express`](./examples/express) | `0.1.0` | Express reference application showing end-to-end SDK & webhook integration |

---

## 🚀 5-Minute Quickstart

### 1. Install Packages

```bash
npm install @ethio-pay/core @ethio-pay/chapa
```

### 2. Initialize SDK Client

```typescript
import { EthiopianPayments } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';

// Configure Chapa adapter
const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY!,
  secretHash: process.env.CHAPA_SECRET_HASH!,
});

// Configure Ethio-Pay client
const sdk = new EthiopianPayments({
  providers: [chapa],
});
```

### 3. Create a Payment Session

```typescript
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
  returnUrl: 'https://my-store.com/success',
  callbackUrl: 'https://my-store.com/api/webhooks/chapa',
});

// Redirect customer to checkout URL
console.log('Checkout URL:', session.checkoutUrl);
```

### 4. Verify Payment Status & Process Webhooks

```typescript
import express from 'express';
import { createIdempotencyMiddleware } from '@ethio-pay/core';

const app = express();

// Use express.text to keep raw body for signature verification
app.post(
  '/api/webhooks/chapa',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(), // Prevents duplicate delivery
  (req, res) => {
    const rawBody = req.body;
    const headers = req.headers;

    // 1. Constant-time HMAC-SHA256 signature verification
    sdk.webhooks.verify('chapa', rawBody, headers);

    // 2. Parse normalized PaymentEvent
    const event = sdk.webhooks.parse('chapa', rawBody, headers);

    if (event.type === 'payment.succeeded') {
      console.log(`Payment ${event.reference} of ${event.amount} ETB succeeded!`);
      // Fulfill customer order
    }

    return res.status(200).json({ status: 'success' });
  }
);
```

---

## 🛠️ Local Webhook Simulator CLI (`ethio-pay-sandbox`)

Develop and test webhooks locally on your laptop **without live keys or internet access**:

```bash
npx ethio-pay-sandbox --target http://localhost:3000/api/webhooks/chapa --provider chapa
```

1. Opens an interactive checkout dashboard at `http://localhost:4040/checkout/:reference`.
2. Includes buttons to trigger **Pay Success**, **Pay Failed**, **Cancel Order**, and **Let Expire**.
3. Supports edge-case security testing: **Tampered HMAC Signatures**, **Delayed Webhooks**, **Duplicate Replays**, and **Live Key Guards**.

---

## 📊 Status & Error Code Reference

### Unified Status Enum
- `PENDING`: Payment initiated, awaiting customer checkout action.
- `SUCCEEDED`: Payment completed successfully.
- `FAILED`: Payment failed or rejected.
- `EXPIRED`: Payment session expired.
- `REFUNDED`: Payment refunded.

### Typed Error Codes (`PaymentError`)
- `INVALID_CREDENTIALS`: Authentication or API key failed.
- `INVALID_SIGNATURE`: Webhook signature check failed (HMAC mismatch).
- `VALIDATION_ERROR`: Input validation failed before remote call (e.g. amount ≤ 0).
- `NETWORK_TIMEOUT`: Network call exceeded 15s timeout limit.
- `DUPLICATE_REFERENCE`: Transaction reference already exists.
- `PROVIDER_ERROR`: Downstream provider error response.

---

## 🧪 Testing & Verification

Run the unit and end-to-end integration test suites:

```bash
pnpm test
```

Build all packages:

```bash
pnpm build
```

---

## 📜 License & Disclaimer

Distributed under the [MIT License](./LICENSE).

*Disclaimer: This SDK is an independent, community-driven project created to empower developers building e-commerce and fintech apps in Ethiopia. It is not officially endorsed by or affiliated with Chapa, Telebirr, CBE, or any financial institution. Merchant API keys are never collected, logged, or stored on external servers.*
