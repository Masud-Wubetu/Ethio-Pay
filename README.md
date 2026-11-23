# 🇪🇹 Ethio-Pay: Unified Payment SDK & Local Webhook Simulator

> **Unofficial Community Project.** Not affiliated with Chapa, Telebirr, CBE Birr, or any bank.

Ethio-Pay is a modern TypeScript/Node.js monorepo providing:
1. **Unified Payment SDK (`@ethio-pay/core`, `@ethio-pay/chapa`)**: A single clean API to initialize payments, verify statuses, and process HMAC-signed webhooks across Ethiopian payment providers.
2. **Local Webhook Simulator CLI (`@ethio-pay/sandbox`)**: A local dev tool (`ethio-pay-sandbox`) that emulates payment gateways with a web dashboard, signed webhooks, and failure/attack edge-case scenarios.

---

## 📦 Packages in this Monorepo

| Package | Version | Description |
|---|---|---|
| [`ethio-pay`](./packages/ethio-pay) | `0.1.0` | Umbrella package re-exporting core client and all official adapters |
| [`@ethio-pay/core`](./packages/core) | `0.1.0` | Core domain types, `PaymentProvider` contract, `HttpClient` with retry/backoff, and `Idempotency` middleware |
| [`@ethio-pay/chapa`](./packages/chapa) | `0.1.0` | Chapa Payment Provider Adapter implementation |
| [`@ethio-pay/telebirr`](./packages/telebirr) | `0.1.0` | Telebirr Fabric & H5 Payment Provider Adapter implementation |
| [`@ethio-pay/santimpay`](./packages/santimpay) | `0.1.0` | SantimPay Payment Provider Adapter implementation |
| [`@ethio-pay/cbebirr`](./packages/cbebirr) | `0.1.0` | CBE Birr (Commercial Bank of Ethiopia) Payment Provider Adapter |
| [`@ethio-pay/arifpay`](./packages/arifpay) | `0.1.0` | ArifPay Payment Provider Adapter implementation |
| [`@ethio-pay/awashbirr`](./packages/awashbirr) | `0.1.0` | Awash Birr (Awash Bank) Payment Provider Adapter implementation |
| [`@ethio-pay/sms`](./packages/sms) | `0.1.0` | Resilient Ethiopian SMS & OTP engine with automatic gateway failover (AfroMessage, GeeZ SMS, Ethio Telecom) |
| [`@ethio-pay/sandbox`](./packages/sandbox) | `0.1.0` | Local Webhook Simulator server & `ethio-pay-sandbox` CLI binary |
| [`@ethio-pay/example-express`](./examples/express) | `0.1.0` | Express reference application showing end-to-end SDK & webhook integration |
| [`@ethio-pay/example-nextjs`](./examples/nextjs) | `0.1.0` | Next.js App Router reference webhook handler (`route.ts`) |

---

## 🎯 Positioning: Where Payment Aggregators Stop and Ethio-Pay Begins

Payment aggregators (like Chapa or ArifPay) solve transaction collection, not developer reliability or infrastructure. **Ethio-Pay is not a competitor to payment gateways**; think of gateways as the underlying financial pipes (like Stripe or AWS), while **Ethio-Pay is the developer experience, reliability, and failover layer built on top** (like Resend, Sentry, or PostHog).

| Pain Point | What Aggregators Do | What Ethio-Pay Solves |
|---|---|---|
| **SMS & OTP Delivery** | **Nothing**. Aggregators are payments only. | **Unified SMS Engine**: Unifies AfroMessage, GeeZ SMS, and Ethio Telecom with automatic cascading failover if one gateway drops an OTP SMS. |
| **Direct Bank / Wallet APIs** | Charges a transaction fee (~2%–3.5%) on every payment. High-volume merchants often move to direct Telebirr or CBE APIs to save fees. | **Zero-Rewrite Interface**: Use the exact same TypeScript code interface whether routing through Chapa, ArifPay, or direct Telebirr/CBE—no application rewrites needed when switching rails. |
| **Webhook Debugging & Local Testing** | Fires a basic webhook. If the developer's server is down or they are developing on localhost, debugging is painful. | **Offline Sandbox Simulator**: Complete local mock dashboard, signed webhook dispatcher, attack lab (replay attacks, tampered signatures, delay injection), and payload inspector. |
| **Multi-Gateway Failover** | If a gateway's checkout or a specific bank rail has downtime, customer checkout fails. | **Automated Multi-Gateway Failover**: Automatically cascades payment sessions to ArifPay, Telebirr, or CBE if the primary gateway returns 500 or times out. |

---

## 🚀 5-Minute Quickstart

### 1. Install Package

```bash
# All-in-one package (recommended):
npm install ethio-pay

# Or modular packages:
npm install @ethio-pay/core @ethio-pay/chapa @ethio-pay/telebirr
```

### 2. Initialize SDK Client

```typescript
import { EthiopianPayments, ChapaAdapter, TelebirrAdapter } from 'ethio-pay';

// 1. Configure Chapa adapter (HMAC-SHA256)
const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY!,
  secretHash: process.env.CHAPA_SECRET_HASH!,
});

// 2. Configure Telebirr adapter (RSA-OAEP & RSA-SHA256)
const telebirr = new TelebirrAdapter({
  appId: process.env.TELEBIRR_APP_ID!,
  appKey: process.env.TELEBIRR_APP_KEY!,
  shortCode: process.env.TELEBIRR_SHORT_CODE!,
  publicKey: process.env.TELEBIRR_PUBLIC_KEY!, // Telebirr server public key
  privateKey: process.env.MERCHANT_PRIVATE_KEY!, // Merchant RSA private key
});

// 3. Configure Unified Ethio-Pay client with both providers
const sdk = new EthiopianPayments({
  providers: [chapa, telebirr],
});
```

### 3. Create a Payment Session

```typescript
// Seamlessly route to Chapa or Telebirr by provider name
const session = await sdk.initialize({
  provider: 'telebirr', // or 'chapa'
  amount: 250,
  currency: 'ETB',
  reference: `TX-${Date.now()}`,
  customer: {
    name: 'Abebe Bikila',
    email: 'abebe@example.com',
    phoneNumber: '0911234567',
  },
  returnUrl: 'https://my-store.com/success',
  callbackUrl: 'https://my-store.com/api/webhooks/telebirr',
});

// Redirect customer to checkout URL
console.log('Checkout URL:', session.checkoutUrl);
```

### 4. Verify Payment Status & Process Webhooks

```typescript
import express from 'express';
import { createIdempotencyMiddleware } from '@ethio-pay/core';

const app = express();

// Chapa Webhook Receiver (HMAC-SHA256)
app.post(
  '/api/webhooks/chapa',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(), // Prevents duplicate delivery
  (req, res) => {
    const rawBody = req.body;
    const headers = req.headers;

    // 1. Constant-time HMAC signature verification
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

// Telebirr Webhook Receiver (RSA-SHA256)
app.post(
  '/api/webhooks/telebirr',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(),
  (req, res) => {
    const rawBody = req.body;
    const headers = req.headers;

    // 1. Asymmetric RSA digital signature verification
    sdk.webhooks.verify('telebirr', rawBody, headers);

    // 2. Parse normalized PaymentEvent
    const event = sdk.webhooks.parse('telebirr', rawBody, headers);

    if (event.type === 'payment.succeeded') {
      console.log(`Telebirr Payment ${event.reference} of ${event.amount} ETB succeeded!`);
      // Fulfill customer order
    }

    return res.status(200).json({ code: 0, msg: 'success' });
  }
);
```

### 5. Resilient SMS & OTP Delivery with Gateway Cascading

```typescript
import { EthiopianSms, AfroMessageAdapter, GeezSmsAdapter } from 'ethio-pay';

const sms = new EthiopianSms({
  // Automatic cascade: if AfroMessage fails or drops, immediately fall back to GeeZ SMS
  providers: [
    new AfroMessageAdapter({ token: process.env.AFROMESSAGE_TOKEN! }),
    new GeezSmsAdapter({ token: process.env.GEEZSMS_TOKEN! }),
  ],
});

// 1. Dispatch critical transaction SMS with automatic failover
await sms.send({
  to: '0911234567',
  message: 'Your payment of 450 ETB was successfully received.',
});

// 2. Generate and dispatch secure 6-digit OTP
const otp = await sms.sendOtp('0911234567', {
  length: 6,
  ttlSeconds: 300, // 5 min expiry
});

// 3. Verify user-submitted OTP (constant-time verification)
const isValid = sms.verifyOtp('0911234567', userSubmittedCode);
```

---

## 🛠️ Local Webhook Simulator CLI (`ethio-pay-sandbox`)

Develop and test webhooks locally on your laptop **without live keys or internet access**:

```bash
# Simulate Telebirr Fabric gateway & RSA webhooks
npx ethio-pay-sandbox --provider telebirr --target http://localhost:3000/api/webhooks/telebirr

# Or simulate Chapa gateway & HMAC webhooks
npx ethio-pay-sandbox --provider chapa --target http://localhost:3000/api/webhooks/chapa
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
