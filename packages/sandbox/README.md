# `@ethio-pay/sandbox`

> Local Webhook Simulator CLI (`ethio-pay-sandbox`) and mock payment provider server for the Ethio-Pay SDK.

The Ethio-Pay Sandbox provides an isolated, offline environment for developers to build, test, and harden integrations against Ethiopian payment gateways (Chapa and Telebirr) without making external network calls or using live credentials.

---

## Features

- **Multi-Provider Simulation**: Emulate Chapa and Telebirr Fabric gateways locally.
- **Interactive Checkout UIs**: Responsive, branded mock checkout pages with simulated payment flows (card, mobile money, and Telebirr USSD/PIN).
- **Cryptographic Signature Verification**:
  - **Chapa**: HMAC-SHA256 signed payloads via `x-chapa-signature`.
  - **Telebirr**: RSA-SHA256 (PKCS#1 v1.5) payload signing and RSA-OAEP payload decryption.
- **Developer Control Dashboard**: Real-time webhook log inspector, latency controls, duplicate replay triggers, and security attack simulations.
- **Security Guardrails**: Rejects requests using live API keys (`CHASECK_LIVE`) and validates Host headers to prevent DNS rebinding.

---

## Installation & CLI Usage

Run directly via `npx` or install globally:

```bash
# Run with Telebirr provider
npx ethio-pay-sandbox --provider telebirr --target http://localhost:3000/api/webhooks/telebirr

# Run with Chapa provider
npx ethio-pay-sandbox --provider chapa --target http://localhost:3000/api/webhooks/chapa

# Custom port
npx ethio-pay-sandbox -p telebirr -P 4040
```

### CLI Options

| Option | Flag | Description | Default |
|---|---|---|---|
| `--provider` | `-p` | Provider adapter to emulate (`chapa`, `telebirr`) | `chapa` |
| `--target` | `-t` | Target webhook URL to deliver signed webhook events | `http://localhost:3000/api/webhooks/<provider>` |
| `--port` | `-P` | Port to run the local sandbox server on | `4040` |
| `--secret` | `-s` | Secret hash for HMAC signing (Chapa) | `sandbox_secret_hash_123` |
| `--help` | `-h` | Show help and exit | |

When launched with `--provider telebirr`, the CLI displays:
- **Developer Dashboard**: `http://127.0.0.1:4040`
- **Target URL**: The webhook receiver endpoint
- **Public Key Endpoint**: `http://127.0.0.1:4040/api/telebirr/public-key`

---

## Telebirr Simulation Deep-Dive

### 1. Ephemeral RSA Keypair Generation
Upon startup, the sandbox automatically generates a 2048-bit RSA keypair in PEM format:
- **Sandbox Public Key**: Used by your application / `TelebirrAdapter` to encrypt outgoing payload parameters (`ussd`) and verify incoming webhook signatures.
- **Sandbox Private Key**: Used by the sandbox server to decrypt incoming requests and generate valid RSA signatures for dispatched webhooks.

You can inspect or retrieve the sandbox public key dynamically:
```bash
curl http://localhost:4040/api/telebirr/public-key
```

### 2. Simulated Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/ammapi/payment/service-openup/toTradeWebPay` | Emulates Telebirr Fabric H5 payment session initialization. Automatically decrypts RSA-encrypted `ussd` payload parameters using the sandbox private key and returns a mock `toPayUrl`. |
| `POST` | `/ammapi/payment/service-openup/queryOrder` | Emulates Telebirr Fabric query status. Decrypts `ussd` payload to inspect `outTradeNo` and returns current status (`TRADE_SUCCESS`, `TRADE_CLOSED`, or `WAIT_BUYER_PAY`). |
| `GET` | `/api/telebirr/public-key` | Exposes the active sandbox RSA public key in JSON format. |
| `GET` | `/checkout/:reference` | Interactive customer checkout page with Telebirr branding and USSD simulation. |

### 3. RSA-Signed Webhook Dispatching
When a transaction status changes in the sandbox (or when triggered manually from the dashboard):
1. **Canonical String Construction**: Builds an alphabetical key-value query string from payload parameters (`msisdn`, `outTradeNo`, `totalAmount`, `tradeDate`, `tradeNo`, `tradeStatus`).
2. **RSA-SHA256 Signing**: Signs the canonical string using the sandbox RSA private key with PKCS#1 v1.5 padding and base64-encodes the signature.
3. **Delivery**: Sends an HTTP `POST` to the target webhook URL with:
   - Header: `x-telebirr-signature: <base64-signature>`
   - JSON Body: `{ ...payload, sign: "<base64-signature>" }`

### 4. Security Attack Lab Simulation
From the Developer Dashboard or API, you can trigger security test cases to verify application resiliency:
- **Tampered RSA Signature**: Injects an invalid signature hash to confirm that your `TelebirrAdapter.verifyWebhook()` correctly throws `PaymentErrorCode.INVALID_SIGNATURE`.
- **Duplicate Webhook Replay**: Dispatches the exact same webhook payload multiple times to test idempotency guards.
- **Simulated Latency**: Adds configurable network delay (e.g., 2000ms) to verify client-side timeouts.

---

## Programmatic Usage

You can also spin up the sandbox inside unit or integration tests (e.g. with Vitest):

```typescript
import { SandboxServer } from '@ethio-pay/sandbox';
import { TelebirrAdapter } from '@ethio-pay/telebirr';

// 1. Start sandbox server
const sandbox = new SandboxServer({
  port: 0,
  provider: 'telebirr',
  targetUrl: 'http://localhost:3000/api/webhooks/telebirr',
});

// 2. Initialize TelebirrAdapter with sandbox public key and local baseUrl
const telebirr = new TelebirrAdapter({
  appId: 'TEST_APP_ID',
  appKey: 'TEST_APP_KEY',
  shortCode: '10001',
  publicKey: sandbox.rsaPublicKey,
  privateKey: merchantPrivateKey,
  baseUrl: `http://localhost:${sandbox.port}`,
});

// 3. Test initialization, verification, and webhooks locally
const session = await telebirr.initialize({
  provider: 'telebirr',
  reference: 'ORD-12345',
  amount: 250,
  currency: 'ETB',
  customer: { phoneNumber: '0911000000' },
  callbackUrl: 'http://localhost:3000/api/webhooks/telebirr',
  returnUrl: 'http://localhost:3000/success',
});
```

---

## Disclaimer

*Unofficial community development tool for testing and local integration.*
