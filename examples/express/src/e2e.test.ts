import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { EthiopianPayments, createIdempotencyMiddleware } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { SandboxServer } from '@ethio-pay/sandbox';

describe('End-to-End Integration (SDK + ChapaAdapter + Sandbox + Express App)', () => {
  let sandboxInstance: SandboxServer;
  let sandboxHttpServer: Server;
  let merchantHttpServer: Server;

  let SANDBOX_PORT: number;
  let MERCHANT_PORT: number;
  const SECRET_HASH = 'e2e_secret_hash_999';

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

    // 2. Start Express Merchant App on ephemeral port
    const app = express();
    const chapaAdapter = new ChapaAdapter({
      secretKey: 'CHASECK_TEST-999',
      secretHash: SECRET_HASH,
      baseUrl: `http://localhost:${SANDBOX_PORT}`,
    });

    const sdk = new EthiopianPayments({
      environment: 'sandbox',
      providers: [chapaAdapter],
    });

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
            message: 'Webhook processed',
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

    app.use(express.json());

    app.post('/api/checkout', async (req: Request, res: Response) => {
      try {
        const session = await sdk.initialize({
          provider: 'chapa',
          amount: Number(req.body.amount) || 100,
          currency: 'ETB',
          reference: req.body.reference || 'E2E-REF-1',
          customer: { name: 'Abebe Bikila', email: 'abebe@example.com' },
          callbackUrl: `http://localhost:${MERCHANT_PORT}/api/webhooks/chapa`,
        });

        return res.json({
          status: 'success',
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

  it('completes full payment lifecycle from initialize -> payment action -> signed webhook delivery (200 OK)', async () => {
    // 1. Merchant app initializes checkout
    const checkoutRes = await fetch(`http://localhost:${MERCHANT_PORT}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500, reference: 'E2E-ORDER-101' }),
    });

    const checkoutData = (await checkoutRes.json()) as any;
    expect(checkoutRes.status).toBe(200);
    expect(checkoutData.checkoutUrl).toContain('/checkout/E2E-ORDER-101');

    // 2. Simulate user clicking "Pay Success" on checkout UI
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-ORDER-101',
        status: 'SUCCEEDED',
      }),
    });

    const triggerData = (await triggerRes.json()) as any;
    expect(triggerRes.status).toBe(200);
    expect(triggerData.responseStatus).toBe(200);

    // 3. Verify simulator status API
    const verifyRes = await fetch(`http://localhost:${SANDBOX_PORT}/v1/transaction/verify/E2E-ORDER-101`, {
      headers: { Authorization: 'Bearer CHASECK_TEST-999' },
    });
    const verifyData = (await verifyRes.json()) as any;
    expect(verifyData.data.status).toBe('success');
  });

  it('intercepts duplicate webhook replay with Idempotency middleware', async () => {
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-ORDER-101',
        status: 'SUCCEEDED',
      }),
    });

    const triggerData = (await triggerRes.json()) as any;
    expect(triggerRes.status).toBe(200);
    expect(triggerData.responseStatus).toBe(200);

    const logRecord = sandboxInstance.webhookLogs[0];
    expect(logRecord.responseBody).toContain('"idempotent":true');
  });

  it('rejects tampered webhook signature with HTTP 400', async () => {
    const triggerRes = await fetch(`http://localhost:${SANDBOX_PORT}/api/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: 'E2E-TAMPERED-REF',
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
});
