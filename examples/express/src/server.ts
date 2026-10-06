import express, { type Request, type Response } from 'express';
import { EthiopianPayments, createIdempotencyMiddleware } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';

const app = express();
const PORT = process.env.PORT || 3000;
const SANDBOX_URL = process.env.SANDBOX_URL || 'http://localhost:4040';

// 1. Configure Chapa adapter pointing to sandbox server
const chapaAdapter = new ChapaAdapter({
  secretKey: 'CHASECK_TEST-12345',
  secretHash: 'sandbox_secret_hash_123',
  baseUrl: SANDBOX_URL,
});

// 2. Configure Ethio-Pay SDK
const sdk = new EthiopianPayments({
  environment: 'sandbox',
  providers: [chapaAdapter],
});

// 3. Webhook Endpoint with raw body parsing and idempotency middleware
app.post(
  '/api/webhooks/chapa',
  express.text({ type: '*/*' }),
  createIdempotencyMiddleware(),
  (req: Request, res: Response) => {
    try {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const headers = req.headers as Record<string, string | string[] | undefined>;

      // Signature verification (throws PaymentError if invalid or tampered)
      sdk.webhooks.verify('chapa', rawBody, headers);

      // Parse normalized PaymentEvent
      const event = sdk.webhooks.parse('chapa', rawBody, headers);

      console.log(
        `[Merchant App] Verified webhook event: ${event.type} for reference ${event.reference}`
      );

      if (event.type === 'payment.succeeded') {
        console.log(
          `[Merchant App] 🎉 Payment ${event.reference} of ${event.amount} ${event.currency} succeeded! Fulfilling order...`
        );
      } else if (event.type === 'payment.failed') {
        console.log(`[Merchant App] ❌ Payment ${event.reference} failed.`);
      }

      return res.status(200).json({
        status: 'success',
        message: 'Webhook processed successfully',
        reference: event.reference,
      });
    } catch (err: any) {
      console.error(`[Merchant App] Webhook error: ${err.message}`);
      return res.status(err.httpStatus || 400).json({
        status: 'failed',
        message: err.message,
      });
    }
  }
);

// Standard JSON parser for application API endpoints
app.use(express.json());

// Checkout Initialization API
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { amount, currency, reference, customer } = req.body;

    const session = await sdk.initialize({
      provider: 'chapa',
      amount: Number(amount) || 100,
      currency: currency || 'ETB',
      reference: reference || `ORD-${Date.now()}`,
      customer: customer || {
        name: 'Abebe Bikila',
        email: 'abebe@example.com',
        phoneNumber: '0911234567',
      },
      returnUrl: 'http://localhost:3000/success',
      callbackUrl: 'http://localhost:3000/api/webhooks/chapa',
    });

    return res.json({
      status: 'success',
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
  res.send('<h1>Payment Successful!</h1><p>Thank you for your order.</p>');
});

app.listen(PORT, () => {
  console.log(`
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   🛒  Express Merchant Application Running                │
│                                                           │
│   • Merchant Server:  http://localhost:${PORT}             │
│   • Checkout Route:   POST http://localhost:${PORT}/api/checkout
│   • Webhook Route:    POST http://localhost:${PORT}/api/webhooks/chapa
│                                                           │
└───────────────────────────────────────────────────────────┘
`);
});
