import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { EthiopianPayments, createIdempotencyMiddleware } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { TelebirrAdapter } from '@ethio-pay/telebirr';

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

// 3. Configure Unified Ethio-Pay SDK with multiple providers
export const sdk = new EthiopianPayments({
  environment: 'sandbox',
  providers: [chapaAdapter, telebirrAdapter],
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

// -------------------------------------------------------------
// Application JSON API Endpoints
// -------------------------------------------------------------
app.use(express.json());

// Multi-provider checkout initialization
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { provider = 'chapa', amount, currency, reference, customer } = req.body;
    const selectedProvider = String(provider).toLowerCase();

    const callbackUrl =
      selectedProvider === 'telebirr'
        ? `http://localhost:${PORT}/api/webhooks/telebirr`
        : `http://localhost:${PORT}/api/webhooks/chapa`;

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
        <title>Ethio-Pay Multi-Provider Demo</title>
        <style>
          :root { --primary: #2563eb; --telebirr: #0284c7; --chapa: #059669; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; display: flex; justify-content: center; }
          .container { width: 100%; max-width: 540px; }
          .header { text-align: center; margin-bottom: 2rem; }
          .badge { display: inline-block; background: #1e293b; border: 1px solid #334155; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; color: #38bdf8; margin-bottom: 0.5rem; }
          h1 { margin: 0; font-size: 1.8rem; font-weight: 700; color: #f8fafc; }
          p.subtitle { color: #94a3b8; font-size: 0.95rem; margin-top: 0.5rem; }
          .form-card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 1.75rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4); }
          .field { margin-bottom: 1.25rem; }
          label { display: block; font-size: 0.85rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
          input, select { width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #334155; border-radius: 0.5rem; padding: 0.75rem 1rem; color: #f8fafc; font-size: 1rem; }
          input:focus, select:focus { outline: none; border-color: var(--primary); }
          .provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; }
          .provider-card { border: 2px solid #334155; border-radius: 0.75rem; padding: 1rem; cursor: pointer; text-align: center; transition: all 0.2s; background: #0f172a; }
          .provider-card.selected { border-color: #38bdf8; background: rgba(56, 189, 248, 0.08); }
          .provider-title { font-weight: 700; font-size: 1.1rem; }
          .provider-sub { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }
          .btn-pay { width: 100%; padding: 0.9rem; background: var(--primary); color: #fff; font-size: 1.05rem; font-weight: 600; border: none; border-radius: 0.5rem; cursor: pointer; transition: background 0.2s; }
          .btn-pay:hover { opacity: 0.92; }
          .meta-info { margin-top: 1.5rem; padding: 1rem; border-radius: 0.5rem; background: #0f172a; border: 1px dashed #334155; font-size: 0.8rem; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">Ethio-Pay Demo Store</span>
            <h1>Multi-Provider Checkout</h1>
            <p class="subtitle">Experience unified payments with Chapa & Telebirr side-by-side.</p>
          </div>

          <div class="form-card">
            <label>Select Payment Provider</label>
            <div class="provider-grid">
              <div id="card-chapa" class="provider-card selected" onclick="selectProvider('chapa')">
                <div class="provider-title" style="color: #34d399;">Chapa</div>
                <div class="provider-sub">Cards & Mobile Wallets</div>
              </div>
              <div id="card-telebirr" class="provider-card" onclick="selectProvider('telebirr')">
                <div class="provider-title" style="color: #38bdf8;">Telebirr</div>
                <div class="provider-sub">Fabric H5 / USSD Quick PIN</div>
              </div>
            </div>

            <div class="field">
              <label>Amount (ETB)</label>
              <input type="number" id="amount" value="350" min="1" />
            </div>

            <div class="field">
              <label>Customer Name</label>
              <input type="text" id="customerName" value="Abebe Bikila" />
            </div>

            <div class="field">
              <label>Phone Number</label>
              <input type="text" id="phoneNumber" value="0911234567" />
            </div>

            <button class="btn-pay" id="payBtn" onclick="initiatePayment()">Proceed to Checkout →</button>

            <div class="meta-info">
              <strong>Active Webhook Endpoints:</strong><br />
              • Chapa: <code>POST /api/webhooks/chapa</code> (HMAC-SHA256)<br />
              • Telebirr: <code>POST /api/webhooks/telebirr</code> (RSA-SHA256)<br />
              • Idempotency Middleware Active: Duplicate prevention enabled
            </div>
          </div>
        </div>

        <script>
          let currentProvider = 'chapa';

          function selectProvider(provider) {
            currentProvider = provider;
            document.getElementById('card-chapa').classList.toggle('selected', provider === 'chapa');
            document.getElementById('card-telebirr').classList.toggle('selected', provider === 'telebirr');
            document.getElementById('payBtn').innerText = provider === 'telebirr' ? 'Pay with Telebirr →' : 'Pay with Chapa →';
          }

          async function initiatePayment() {
            const btn = document.getElementById('payBtn');
            btn.disabled = true;
            btn.innerText = 'Initializing Payment Session...';

            try {
              const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  provider: currentProvider,
                  amount: Number(document.getElementById('amount').value),
                  customer: {
                    name: document.getElementById('customerName').value,
                    phoneNumber: document.getElementById('phoneNumber').value,
                    email: 'customer@example.com'
                  }
                })
              });
              const data = await res.json();
              if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
              } else {
                alert('Error initializing checkout: ' + (data.message || 'Unknown error'));
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
