import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { EthiopianPayments, createIdempotencyMiddleware } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { TelebirrAdapter } from '@ethio-pay/telebirr';
import { CbeBirrAdapter } from '@ethio-pay/cbebirr';
import { ArifPayAdapter } from '@ethio-pay/arifpay';
import { SantimPayAdapter } from '@ethio-pay/santimpay';
import { AwashBirrAdapter } from '@ethio-pay/awashbirr';

export const app = express();
const PORT = process.env.PORT || 3000;
const SANDBOX_URL = process.env.SANDBOX_URL || 'http://localhost:4040';

// 1. Configure Chapa adapter pointing to local sandbox or live gateway
export const chapaAdapter = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY || 'CHASECK_TEST-12345',
  secretHash: process.env.CHAPA_SECRET_HASH || 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

// 2. Generate or load merchant RSA keypair for Telebirr
const merchantKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Ephemeral fallback gateway key if running without live sandbox
const fallbackGatewayKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Configure Telebirr adapter pointing to local sandbox
export let telebirrAdapter = new TelebirrAdapter({
  appId: process.env.TELEBIRR_APP_ID || 'TEST_APP_ID',
  appKey: process.env.TELEBIRR_APP_KEY || 'TEST_APP_KEY',
  shortCode: process.env.TELEBIRR_SHORT_CODE || '10001',
  publicKey: process.env.TELEBIRR_PUBLIC_KEY || fallbackGatewayKeys.publicKey,
  privateKey: process.env.TELEBIRR_PRIVATE_KEY || merchantKeys.privateKey,
  baseUrl: SANDBOX_URL,
});

// 3. Configure CBE Birr, ArifPay, SantimPay, and Awash Birr adapters
export const cbeBirrAdapter = new CbeBirrAdapter({
  tillCode: process.env.CBEBIRR_TILL_CODE || '001',
  apiKey: process.env.CBEBIRR_API_KEY || 'test_cbe_key_123',
  secretHash: process.env.CBEBIRR_SECRET_HASH || 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

export const arifPayAdapter = new ArifPayAdapter({
  apiKey: process.env.ARIFPAY_API_KEY || 'test_arifpay_key_123',
  secretKey: process.env.ARIFPAY_SECRET_KEY || 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

export const santimPayAdapter = new SantimPayAdapter({
  merchantId: process.env.SANTIMPAY_MERCHANT_ID || 'test_merchant_id',
  authToken: process.env.SANTIMPAY_AUTH_TOKEN || 'test_token_123',
  clientSecret: process.env.SANTIMPAY_CLIENT_SECRET || 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

export const awashBirrAdapter = new AwashBirrAdapter({
  merchantId: process.env.AWASHBIRR_MERCHANT_ID || 'test_awash_merchant',
  passKey: process.env.AWASHBIRR_PASS_KEY || 'test_passkey_123',
  secretHash: process.env.AWASHBIRR_SECRET_HASH || 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

// 4. Configure Unified Ethio-Pay SDK with all 6 providers + smart failover
export const sdk = new EthiopianPayments({
  environment: 'sandbox',
  providers: [
    chapaAdapter,
    telebirrAdapter,
    cbeBirrAdapter,
    arifPayAdapter,
    santimPayAdapter,
    awashBirrAdapter,
  ],
  defaultFallbackProviders: ['telebirr', 'arifpay'],
});

// Sync ephemeral RSA public key from the running sandbox server
export async function syncSandboxTelebirrPublicKey(sandboxUrl = SANDBOX_URL): Promise<boolean> {
  if (process.env.TELEBIRR_PUBLIC_KEY) return true;
  try {
    const res = await fetch(`${sandboxUrl}/api/telebirr/public-key`);
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data?.publicKey) {
        telebirrAdapter = new TelebirrAdapter({
          appId: process.env.TELEBIRR_APP_ID || 'TEST_APP_ID',
          appKey: process.env.TELEBIRR_APP_KEY || 'TEST_APP_KEY',
          shortCode: process.env.TELEBIRR_SHORT_CODE || '10001',
          publicKey: data.publicKey,
          privateKey: process.env.TELEBIRR_PRIVATE_KEY || merchantKeys.privateKey,
          baseUrl: sandboxUrl,
        });
        sdk.registerProvider(telebirrAdapter);
        return true;
      }
    }
  } catch {
    // Sandbox not started yet or not reachable
  }
  return false;
}

// -------------------------------------------------------------
// Webhook Receivers with Raw Body Parsing & Idempotency
// -------------------------------------------------------------

// Chapa Webhook Endpoint
app.post(
  '/api/webhooks/chapa',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(),
  (req: Request, res: Response) => {
    try {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const headers = req.headers as Record<string, string | string[] | undefined>;

      // HMAC signature verification
      sdk.webhooks.verify('chapa', rawBody, headers);

      // Parse normalized PaymentEvent
      const event = sdk.webhooks.parse('chapa', rawBody, headers);

      console.log(
        `[Merchant App] Verified Chapa webhook: ${event.type} for reference ${event.reference}`
      );

      if (event.type === 'payment.succeeded') {
        console.log(
          `[Merchant App] 🎉 Chapa payment ${event.reference} of ${event.amount} ${event.currency} succeeded! Fulfilling order...`
        );
      } else if (event.type === 'payment.failed') {
        console.log(`[Merchant App] ❌ Chapa payment ${event.reference} failed.`);
      }

      return res.status(200).json({
        status: 'success',
        message: 'Chapa webhook processed successfully',
        reference: event.reference,
      });
    } catch (err: any) {
      console.error(`[Merchant App] Chapa webhook error: ${err.message}`);
      return res.status(err.httpStatus || 400).json({
        status: 'failed',
        message: err.message,
      });
    }
  }
);

// Telebirr Webhook Endpoint
app.post(
  '/api/webhooks/telebirr',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(),
  (req: Request, res: Response) => {
    try {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const headers = req.headers as Record<string, string | string[] | undefined>;

      // RSA signature verification
      sdk.webhooks.verify('telebirr', rawBody, headers);

      // Parse normalized PaymentEvent
      const event = sdk.webhooks.parse('telebirr', rawBody, headers);

      console.log(
        `[Merchant App] Verified Telebirr webhook: ${event.type} for reference ${event.reference}`
      );

      if (event.type === 'payment.succeeded') {
        console.log(
          `[Merchant App] 🎉 Telebirr payment ${event.reference} of ${event.amount} ${event.currency} succeeded! Fulfilling order...`
        );
      } else if (event.type === 'payment.failed') {
        console.log(`[Merchant App] ❌ Telebirr payment ${event.reference} failed.`);
      }

      return res.status(200).json({
        code: 0,
        msg: 'success',
        status: 'success',
        message: 'Telebirr webhook processed successfully',
        reference: event.reference,
      });
    } catch (err: any) {
      console.error(`[Merchant App] Telebirr webhook error: ${err.message}`);
      return res.status(err.httpStatus || 400).json({
        code: 400,
        msg: err.message,
        status: 'failed',
        message: err.message,
      });
    }
  }
);

// Generic Multi-Provider Webhook Endpoint
app.post(
  '/api/webhooks/:provider',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(),
  (req: Request, res: Response) => {
    const provider = req.params.provider.toLowerCase();
    try {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const headers = req.headers as Record<string, string | string[] | undefined>;

      // Signature verification
      sdk.webhooks.verify(provider, rawBody, headers);

      // Parse normalized PaymentEvent
      const event = sdk.webhooks.parse(provider, rawBody, headers);

      console.log(
        `[Merchant App] Verified ${provider} webhook: ${event.type} for reference ${event.reference}`
      );

      if (event.type === 'payment.succeeded') {
        console.log(
          `[Merchant App] 🎉 ${provider} payment ${event.reference} of ${event.amount} ${event.currency} succeeded! Fulfilling order...`
        );
      } else if (event.type === 'payment.failed') {
        console.log(`[Merchant App] ❌ ${provider} payment ${event.reference} failed.`);
      }

      return res.status(200).json({
        code: 0,
        status: 'success',
        message: `${provider} webhook processed successfully`,
        reference: event.reference,
      });
    } catch (err: any) {
      console.error(`[Merchant App] ${provider} webhook error: ${err.message}`);
      return res.status(err.httpStatus || 400).json({
        code: 400,
        status: 'failed',
        message: err.message,
      });
    }
  }
);

// -------------------------------------------------------------
// Application JSON API Endpoints
// -------------------------------------------------------------
app.use(express.json());

// Multi-provider checkout initialization
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { provider = 'chapa', amount, currency, reference, customer } = req.body;
    const selectedProvider = String(provider).toLowerCase();
    const callbackUrl = `http://localhost:${PORT}/api/webhooks/${selectedProvider}`;

    const session = await sdk.initialize({
      provider: selectedProvider,
      amount: Number(amount) || 100,
      currency: currency || 'ETB',
      reference: reference || `ORD-${selectedProvider.toUpperCase()}-${Date.now()}`,
      customer: customer || {
        name: 'Abebe Bikila',
        email: 'abebe@example.com',
        phoneNumber: '0911234567',
      },
      returnUrl: `http://localhost:${PORT}/success`,
      callbackUrl,
    });

    return res.json({
      status: 'success',
      provider: session.provider,
      checkoutUrl: session.checkoutUrl,
      reference: session.reference,
    });
  } catch (err: any) {
    return res.status(400).json({
      status: 'failed',
      message: err.message,
    });
  }
});

app.get('/success', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Successful - Ethio-Pay</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #334155; text-align: center; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
          .icon { font-size: 3.5rem; margin-bottom: 1rem; }
          h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #22c55e; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          a { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #2563eb; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">🎉</div>
          <h1>Payment Successful!</h1>
          <p>Your order has been verified and fulfilled. Thank you for using Ethio-Pay!</p>
          <a href="/">← Return to Store Demo</a>
        </div>
      </body>
    </html>
  `);
});

// Interactive Multi-Provider Demo Storefront
app.get('/', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Habesha Coffee Roasters — Ethio-Pay Multi-Rail Checkout</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #2563eb;
            --bg: #070a12;
            --card-bg: rgba(18, 25, 41, 0.85);
            --border: rgba(255, 255, 255, 0.08);
            --text: #f8fafc;
            --muted: #94a3b8;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            background: radial-gradient(circle at 50% 0%, #151d30 0%, #070a12 100%);
            color: var(--text);
            min-height: 100vh;
            padding: 40px 20px;
            display: flex;
            justify-content: center;
          }
          .store-wrapper {
            width: 100%;
            max-width: 900px;
          }
          .store-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 32px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
          }
          .brand-box {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .brand-logo {
            width: 44px;
            height: 44px;
            border-radius: 12px;
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            box-shadow: 0 4px 14px rgba(217, 119, 6, 0.4);
          }
          .brand-name {
            font-size: 20px;
            font-weight: 800;
            color: #fff;
            letter-spacing: -0.02em;
          }
          .brand-sub {
            font-size: 12px;
            color: var(--muted);
          }
          .sandbox-pill {
            background: rgba(56, 189, 248, 0.1);
            border: 1px solid rgba(56, 189, 248, 0.25);
            color: #38bdf8;
            font-size: 12px;
            font-weight: 700;
            padding: 6px 14px;
            border-radius: 999px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .store-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
          }
          .card {
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 32px;
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6);
          }
          .section-title {
            font-size: 16px;
            font-weight: 800;
            color: #fff;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .product-card {
            background: rgba(10, 15, 26, 0.6);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 20px;
            display: flex;
            gap: 16px;
            align-items: center;
            margin-bottom: 20px;
          }
          .product-img {
            width: 70px;
            height: 70px;
            border-radius: 14px;
            background: linear-gradient(135deg, #78350f 0%, #451a03 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
          }
          .product-title {
            font-size: 15px;
            font-weight: 700;
            color: #fff;
          }
          .product-desc {
            font-size: 12px;
            color: var(--muted);
            margin-top: 3px;
          }
          .product-price {
            font-size: 18px;
            font-weight: 800;
            color: #34d399;
            margin-top: 6px;
          }

          /* Provider Selector Cards */
          .provider-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 24px;
          }
          .provider-card {
            background: #090e1a;
            border: 2px solid var(--border);
            border-radius: 14px;
            padding: 14px 10px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
          }
          .provider-card:hover {
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-2px);
          }
          .provider-card.selected {
            border-color: #38bdf8;
            background: rgba(56, 189, 248, 0.08);
            box-shadow: 0 0 15px rgba(56, 189, 248, 0.2);
          }
          .provider-name {
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 3px;
          }
          .provider-tag {
            font-size: 10px;
            color: var(--muted);
          }

          .field-group {
            margin-bottom: 16px;
          }
          .field-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
          }
          .field-input {
            width: 100%;
            background: #090e1a;
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 14px;
            color: #fff;
            font-size: 14px;
            font-family: inherit;
          }
          .field-input:focus {
            outline: none;
            border-color: #38bdf8;
          }

          .order-summary {
            background: rgba(10, 15, 26, 0.6);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 18px;
            margin-bottom: 24px;
          }
          .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            color: var(--muted);
            margin-bottom: 8px;
          }
          .summary-total {
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: 800;
            color: #fff;
            padding-top: 10px;
            border-top: 1px dashed var(--border);
          }

          .btn-checkout {
            width: 100%;
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            border: none;
            border-radius: 14px;
            padding: 16px;
            font-size: 16px;
            font-weight: 700;
            color: #fff;
            cursor: pointer;
            box-shadow: 0 8px 24px -4px rgba(37, 99, 235, 0.4);
            transition: all 0.2s;
          }
          .btn-checkout:hover {
            opacity: 0.94;
            transform: translateY(-1px);
          }
        </style>
      </head>
      <body>
        <div class="store-wrapper">
          <div class="store-header">
            <div class="brand-box">
              <div class="brand-logo">☕</div>
              <div>
                <div class="brand-name">Habesha Specialty Roasters</div>
                <div class="brand-sub">Addis Ababa, Ethiopia — Direct Trade Coffee</div>
              </div>
            </div>
            <div class="sandbox-pill">
              <span>●</span>
              <span>Ethio-Pay Multi-Rail Gateway Connected</span>
            </div>
          </div>

          <div class="store-grid">
            <div class="card">
              <div class="section-title">🛒 Order Items</div>
              <div class="product-card">
                <div class="product-img">☕</div>
                <div>
                  <div class="product-title">Yirgacheffe Kochere Grade 1</div>
                  <div class="product-desc">Whole Bean Roast, 500g bag</div>
                  <div class="product-price">350.00 ETB</div>
                </div>
              </div>

              <div class="order-summary">
                <div class="summary-row">
                  <span>Subtotal</span>
                  <span>350.00 ETB</span>
                </div>
                <div class="summary-row">
                  <span>Shipping (Addis Ababa)</span>
                  <span style="color:#34d399;">Free</span>
                </div>
                <div class="summary-total">
                  <span>Total Amount</span>
                  <span style="color:#34d399;">350.00 ETB</span>
                </div>
              </div>

              <div style="font-size: 12px; color: var(--muted); line-height: 1.5; background: rgba(10, 15, 26, 0.5); padding: 14px; border-radius: 12px; border: 1px solid var(--border);">
                🔒 <strong>Zero-Downtime Guarantee:</strong> Powered by Ethio-Pay automated gateway failover. If a bank rail is experiencing network downtime, your checkout seamlessly cascades to backup rails.
              </div>
            </div>

            <div class="card">
              <div class="section-title">💳 Select Payment Rail</div>
              <div class="provider-grid">
                <div id="card-chapa" class="provider-card selected" onclick="selectProvider('chapa')">
                  <div class="provider-name" style="color:#34d399;">Chapa</div>
                  <div class="provider-tag">Cards/Wallets</div>
                </div>
                <div id="card-telebirr" class="provider-card" onclick="selectProvider('telebirr')">
                  <div class="provider-name" style="color:#38bdf8;">Telebirr</div>
                  <div class="provider-tag">Fabric H5</div>
                </div>
                <div id="card-cbebirr" class="provider-card" onclick="selectProvider('cbebirr')">
                  <div class="provider-name" style="color:#c084fc;">CBE Birr</div>
                  <div class="provider-tag">Direct Bank</div>
                </div>
                <div id="card-arifpay" class="provider-card" onclick="selectProvider('arifpay')">
                  <div class="provider-name" style="color:#818cf8;">ArifPay</div>
                  <div class="provider-tag">Gateway Rail</div>
                </div>
                <div id="card-santimpay" class="provider-card" onclick="selectProvider('santimpay')">
                  <div class="provider-name" style="color:#2dd4bf;">SantimPay</div>
                  <div class="provider-tag">Direct QR</div>
                </div>
                <div id="card-awashbirr" class="provider-card" onclick="selectProvider('awashbirr')">
                  <div class="provider-name" style="color:#fb7185;">Awash Birr</div>
                  <div class="provider-tag">Awash Wallet</div>
                </div>
              </div>

              <div class="field-group">
                <label class="field-label">Customer Name</label>
                <input type="text" id="custName" class="field-input" value="Abebe Bikila" />
              </div>

              <div class="field-group">
                <label class="field-label">Mobile Phone Number</label>
                <input type="text" id="custPhone" class="field-input" value="0911234567" />
              </div>

              <button class="btn-checkout" id="payBtn" onclick="checkout()">Pay 350.00 ETB with Chapa →</button>
            </div>
          </div>
        </div>

        <script>
          let currentProvider = 'chapa';
          const providers = ['chapa', 'telebirr', 'cbebirr', 'arifpay', 'santimpay', 'awashbirr'];
          const names = {
            chapa: 'Chapa',
            telebirr: 'Telebirr',
            cbebirr: 'CBE Birr',
            arifpay: 'ArifPay',
            santimpay: 'SantimPay',
            awashbirr: 'Awash Birr'
          };

          function selectProvider(p) {
            currentProvider = p;
            providers.forEach(k => {
              const el = document.getElementById('card-' + k);
              if (el) el.classList.toggle('selected', k === p);
            });
            document.getElementById('payBtn').innerText = 'Pay 350.00 ETB with ' + (names[p] || p) + ' →';
          }

          async function checkout() {
            const btn = document.getElementById('payBtn');
            btn.disabled = true;
            btn.innerText = 'Initializing Checkout Session...';

            try {
              const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  provider: currentProvider,
                  amount: 350,
                  customer: {
                    name: document.getElementById('custName').value,
                    phoneNumber: document.getElementById('custPhone').value,
                    email: 'customer@example.com'
                  }
                })
              });
              const data = await res.json();
              if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
              } else {
                alert('Checkout Error: ' + (data.message || 'Unknown error'));
                btn.disabled = false;
                selectProvider(currentProvider);
              }
            } catch (err) {
              alert('Network error: ' + err.message);
              btn.disabled = false;
              selectProvider(currentProvider);
            }
          }
        </script>
      </body>
    </html>
  `);
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    await syncSandboxTelebirrPublicKey();
    console.log(`
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   🛒  Express Multi-Provider Merchant App Running         │
│                                                           │
│   • Demo Storefront:  http://localhost:${PORT}             │
│   • Checkout Route:   POST http://localhost:${PORT}/api/checkout
│   • Chapa Webhook:    POST http://localhost:${PORT}/api/webhooks/chapa
│   • Telebirr Webhook: POST http://localhost:${PORT}/api/webhooks/telebirr
│   • Sandbox Gateway:  ${SANDBOX_URL.padEnd(36)}│
│                                                           │
└───────────────────────────────────────────────────────────┘
`);
  });
}
