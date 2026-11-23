import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { EthiopianPayments, createIdempotencyMiddleware } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { TelebirrAdapter } from '@ethio-pay/telebirr';
import { SandboxServer } from '@ethio-pay/sandbox';

describe('End-to-End Integration (SDK + Multi-Provider Chapa & Telebirr + Sandbox + Express App)', () => {
  let sandboxInstance: SandboxServer;
  let sandboxHttpServer: Server;
  let merchantHttpServer: Server;

  let SANDBOX_PORT: number;
  let MERCHANT_PORT: number;
  const SECRET_HASH = 'e2e_secret_hash_999';

  // Generate merchant RSA keys for Telebirr
  const merchantKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  beforeAll(async () => {
    // 1. Start Sandbox Simulator on ephemeral port
    sandboxInstance = new SandboxServer({
      port: 0,
      secretHash: SECRET_HASH,
    });

    await new Promise<void>((resolve) => {
      sandboxHttpServer = sandboxInstance.app.listen(0, () => {
        SANDBOX_PORT = (sandboxHttpServer.address() as AddressInfo).port;
        sandboxInstance.port = SANDBOX_PORT;
        resolve();
      });
    });

    // 2. Start Express Merchant App with multi-provider SDK
    const app = express();

    const chapaAdapter = new ChapaAdapter({
      secretKey: 'CHASECK_TEST-999',
      secretHash: SECRET_HASH,
      baseUrl: `http://localhost:${SANDBOX_PORT}`,
    });

    const telebirrAdapter = new TelebirrAdapter({
      appId: 'TEST_APP_ID',
      appKey: 'TEST_APP_KEY',
      shortCode: '10001',
      publicKey: sandboxInstance.rsaPublicKey,
      privateKey: merchantKeys.privateKey,
      baseUrl: `http://localhost:${SANDBOX_PORT}`,
    });

    const sdk = new EthiopianPayments({
      environment: 'sandbox',
      providers: [chapaAdapter, telebirrAdapter],
    });

    // Chapa Webhook Receiver
    app.post(
      '/api/webhooks/chapa',
      express.text({ type: '*/*' }),
      createIdempotencyMiddleware(),
      (req: Request, res: Response) => {
        try {
          const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          const headers = req.headers as Record<string, string | string[] | undefined>;

          sdk.webhooks.verify('chapa', rawBody, headers);
          const event = sdk.webhooks.parse('chapa', rawBody, headers);

          return res.status(200).json({
            status: 'success',
            message: 'Chapa webhook processed',
            reference: event.reference,
          });
        } catch (err: any) {
          return res.status(err.httpStatus || 400).json({
            status: 'failed',
            message: err.message,
          });
        }
      }
    );

    // Telebirr Webhook Receiver
    app.post(
      '/api/webhooks/telebirr',
      express.text({ type: '*/*' }),
      createIdempotencyMiddleware(),
      (req: Request, res: Response) => {
        try {
          const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          const headers = req.headers as Record<string, string | string[] | undefined>;

          sdk.webhooks.verify('telebirr', rawBody, headers);
          const event = sdk.webhooks.parse('telebirr', rawBody, headers);

          return res.status(200).json({
            code: 0,
            msg: 'success',
            status: 'success',
            message: 'Telebirr webhook processed',
            reference: event.reference,
          });
        } catch (err: any) {
          return res.status(err.httpStatus || 400).json({
            code: 400,
            msg: err.message,
            status: 'failed',
            message: err.message,
          });
        }
      }
    );

    app.use(express.json());

    // Multi-Provider Checkout Initialization
    app.post('/api/checkout', async (req: Request, res: Response) => {
      try {
        const provider = (req.body.provider || 'chapa').toLowerCase();
        const callbackUrl =
          provider === 'telebirr'
            ? `http://localhost:${MERCHANT_PORT}/api/webhooks/telebirr`
            : `http://localhost:${MERCHANT_PORT}/api/webhooks/chapa`;

        const session = await sdk.initialize({
          provider,
          amount: Number(req.body.amount) || 100,
          currency: 'ETB',
          reference: req.body.reference || `E2E-REF-${Date.now()}`,
          customer: { name: 'Abebe Bikila', email: 'abebe@example.com', phoneNumber: '0911234567' },
          callbackUrl,
        });

        return res.json({
          status: 'success',
          provider: session.provider,
          checkoutUrl: session.checkoutUrl,
          reference: session.reference,
        });
      } catch (err: any) {
        return res.status(400).json({ status: 'failed', message: err.message });
      }
    });

    await new Promise<void>((resolve) => {
      merchantHttpServer = app.listen(0, () => {
        MERCHANT_PORT = (merchantHttpServer.address() as AddressInfo).port;
        sandboxInstance.targetUrl = `http://localhost:${MERCHANT_PORT}/api/webhooks/chapa`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => sandboxHttpServer?.close(() => resolve()));
    await new Promise<void>((resolve) => merchantHttpServer?.close(() => resolve()));
  });

  // -----------------------------------------------------------------
  // Chapa Tests
  // -----------------------------------------------------------------
  it('completes Chapa payment lifecycle from initialize -> trigger -> signed HMAC webhook delivery', async () => {
    // 1. Merchant initializes checkout with Chapa
    const checkoutRes = await fetch(`http://localhost:${MERCHANT_PORT}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'chapa', amount: 500, reference: 'E2E-ORDER-CHAPA-1' }),
    });

    const checkoutData = (await checkoutRes.json()) as any;
    expect(checkoutRes.status).toBe(200);
    expect(checkoutData.provider).toBe('chapa');
    expect(checkoutData.checkoutUrl).toContain('/checkout/E2E-ORDER-CHAPA-1');

    // 2. Simulate user payment action via sandbox trigger
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-ORDER-CHAPA-1',
        status: 'SUCCEEDED',
      }),
    });

    const triggerData = (await triggerRes.json()) as any;
    expect(triggerRes.status).toBe(200);
    expect(triggerData.responseStatus).toBe(200);

    // 3. Verify simulator status API
    const verifyRes = await fetch(
      `http://localhost:${SANDBOX_PORT}/v1/transaction/verify/E2E-ORDER-CHAPA-1`,
      {
        headers: { Authorization: 'Bearer CHASECK_TEST-999' },
      }
    );
    const verifyData = (await verifyRes.json()) as any;
    expect(verifyData.data.status).toBe('success');
  });

  it('intercepts duplicate Chapa webhook replay with Idempotency middleware', async () => {
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-ORDER-CHAPA-1',
        status: 'SUCCEEDED',
      }),
    });

    const triggerData = (await triggerRes.json()) as any;
    expect(triggerRes.status).toBe(200);
    expect(triggerData.responseStatus).toBe(200);

    const logRecord = sandboxInstance.webhookLogs[0];
    expect(logRecord.responseBody).toContain('"idempotent":true');
  });

  it('rejects tampered Chapa webhook signature with HTTP 400', async () => {
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-TAMPERED-CHAPA',
        status: 'SUCCEEDED',
        tamperSignature: true,
      }),
    });

    const triggerData = (await triggerRes.json()) as any;
    expect(triggerRes.status).toBe(200);
    expect(triggerData.responseStatus).toBe(400);

    const logRecord = sandboxInstance.webhookLogs[0];
    expect(logRecord.responseBody).toContain('Invalid webhook signature');
  });

  // -----------------------------------------------------------------
  // Telebirr Tests
  // -----------------------------------------------------------------
  it('completes Telebirr payment lifecycle from initialize -> trigger -> RSA-signed webhook delivery', async () => {
    // 1. Merchant initializes checkout with Telebirr
    const checkoutRes = await fetch(`http://localhost:${MERCHANT_PORT}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'telebirr', amount: 750, reference: 'E2E-ORDER-TB-1' }),
    });

    const checkoutData = (await checkoutRes.json()) as any;
    expect(checkoutRes.status).toBe(200);
    expect(checkoutData.provider).toBe('telebirr');
    expect(checkoutData.checkoutUrl).toContain('/checkout/E2E-ORDER-TB-1');

    // 2. Dispatch RSA-signed Telebirr webhook to /api/webhooks/telebirr
    const logRecord = await sandboxInstance.sendTelebirrWebhook(
      'E2E-ORDER-TB-1',
      'SUCCEEDED' as any,
      {
        targetUrl: `http://localhost:${MERCHANT_PORT}/api/webhooks/telebirr`,
      }
    );

    expect(logRecord.responseStatus).toBe(200);
    expect(logRecord.responseBody).toContain('"msg":"success"');
  });

  it('intercepts duplicate Telebirr webhook replay with Idempotency middleware', async () => {
    const logRecord = await sandboxInstance.sendTelebirrWebhook(
      'E2E-ORDER-TB-1',
      'SUCCEEDED' as any,
      {
        targetUrl: `http://localhost:${MERCHANT_PORT}/api/webhooks/telebirr`,
      }
    );

    expect(logRecord.responseStatus).toBe(200);
    expect(logRecord.responseBody).toContain('"idempotent":true');
  });

  it('rejects tampered Telebirr RSA signature with HTTP 400', async () => {
    const logRecord = await sandboxInstance.sendTelebirrWebhook(
      'E2E-TAMPERED-TB',
      'SUCCEEDED' as any,
      {
        targetUrl: `http://localhost:${MERCHANT_PORT}/api/webhooks/telebirr`,
        tamperSignature: true,
      }
    );

    expect(logRecord.responseStatus).toBe(400);
    expect(logRecord.responseBody).toContain('Invalid Telebirr webhook signature');
  });
});
