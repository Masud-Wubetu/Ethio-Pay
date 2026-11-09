import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { Status, PaymentErrorCode, PaymentError } from '@ethio-pay/core';
import { TelebirrAdapter } from '@ethio-pay/telebirr';
import { SandboxServer } from './server.js';

describe('SandboxServer - Telebirr Simulation', () => {
  let sandbox: SandboxServer;
  let sandboxServer: Server;
  let merchantServer: Server;
  let sandboxPort: number;
  let merchantPort: number;

  let telebirrAdapter: TelebirrAdapter;
  let receivedWebhooks: Array<{ body: any; headers: any }> = [];

  // Generate merchant RSA keypair
  const merchantKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  beforeAll(async () => {
    // 1. Start Sandbox Server on port 0
    sandbox = new SandboxServer({
      port: 0,
      provider: 'telebirr',
    });

    await new Promise<void>((resolve) => {
      sandboxServer = sandbox.app.listen(0, () => {
        sandboxPort = (sandboxServer.address() as AddressInfo).port;
        sandbox.port = sandboxPort;
        resolve();
      });
    });

    // 2. Start Mock Merchant Webhook Receiver on port 0
    const merchantApp = express();
    merchantApp.use(express.text({ type: '*/*' }));
    merchantApp.post('/api/webhooks/telebirr', (req: Request, res: Response) => {
      receivedWebhooks.push({
        body: req.body,
        headers: req.headers,
      });
      return res.status(200).json({ code: 0, msg: 'success' });
    });

    await new Promise<void>((resolve) => {
      merchantServer = merchantApp.listen(0, () => {
        merchantPort = (merchantServer.address() as AddressInfo).port;
        sandbox.targetUrl = `http://localhost:${merchantPort}/api/webhooks/telebirr`;
        resolve();
      });
    });

    // 3. Initialize TelebirrAdapter pointing to the local Sandbox
    telebirrAdapter = new TelebirrAdapter({
      appId: 'TEST_APP_ID',
      appKey: 'TEST_APP_KEY',
      shortCode: '10001',
      publicKey: sandbox.rsaPublicKey,
      privateKey: merchantKeys.privateKey,
      baseUrl: `http://localhost:${sandboxPort}`,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => sandboxServer.close(() => resolve()));
    await new Promise<void>((resolve) => merchantServer.close(() => resolve()));
  });

  it('exposes generated RSA public and private keys and public key endpoint', async () => {
    expect(sandbox.rsaPublicKey).toBeDefined();
    expect(sandbox.rsaPrivateKey).toBeDefined();
    expect(sandbox.rsaPublicKey).toContain('-----BEGIN PUBLIC KEY-----');

    const res = await fetch(`http://localhost:${sandboxPort}/api/telebirr/public-key`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('success');
    expect(data.publicKey).toBe(sandbox.rsaPublicKey);
  });

  it('simulates Telebirr payment session initialization (toTradeWebPay)', async () => {
    const session = await telebirrAdapter.initialize({
      provider: 'telebirr',
      reference: 'TX-TB-SANDBOX-001',
      amount: 450,
      currency: 'ETB',
      customer: { name: 'Almaz Ayana', phoneNumber: '0911000000' },
      callbackUrl: `http://localhost:${merchantPort}/api/webhooks/telebirr`,
      returnUrl: 'http://localhost:3000/orders/success',
    });

    expect(session.id).toBe('TX-TB-SANDBOX-001');
    expect(session.provider).toBe('telebirr');
    expect(session.status).toBe(Status.PENDING);
    expect(session.checkoutUrl).toBe(`http://localhost:${sandboxPort}/checkout/TX-TB-SANDBOX-001`);

    const storedTx = sandbox.transactions.get('TX-TB-SANDBOX-001');
    expect(storedTx).toBeDefined();
    expect(storedTx?.amount).toBe(450);
    expect(storedTx?.provider).toBe('telebirr');
    expect(storedTx?.status).toBe('PENDING');
  });

  it('simulates Telebirr query status (queryOrder)', async () => {
    // 1. Initial status is PENDING
    const initialStatus = await telebirrAdapter.verify('TX-TB-SANDBOX-001');
    expect(initialStatus.reference).toBe('TX-TB-SANDBOX-001');
    expect(initialStatus.status).toBe(Status.PENDING);
    expect(initialStatus.provider).toBe('telebirr');

    // 2. Change transaction status in sandbox to SUCCEEDED
    const tx = sandbox.transactions.get('TX-TB-SANDBOX-001')!;
    tx.status = Status.SUCCEEDED;

    // 3. Query order again
    const updatedStatus = await telebirrAdapter.verify('TX-TB-SANDBOX-001');
    expect(updatedStatus.status).toBe(Status.SUCCEEDED);
    expect(updatedStatus.amount).toBe(450);
  });

  it('renders customer checkout HTML with Telebirr branding', async () => {
    const res = await fetch(`http://localhost:${sandboxPort}/checkout/TX-TB-SANDBOX-001`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('TELEBIRR CHECKOUT');
    expect(html).toContain('Fabric H5 Gateway');
    expect(html).toContain('Telebirr Phone Number');
    expect(html).toContain('TX-TB-SANDBOX-001');
    expect(html).toContain('Telebirr USSD / Quick PIN');
  });

  it('dispatches RSA-signed Telebirr webhook and verifies successfully with TelebirrAdapter', async () => {
    receivedWebhooks = [];

    const logRecord = await sandbox.sendWebhook('TX-TB-SANDBOX-001', Status.SUCCEEDED);

    expect(logRecord.status).toBe(Status.SUCCEEDED);
    expect(logRecord.responseStatus).toBe(200);
    expect(receivedWebhooks.length).toBe(1);

    const received = receivedWebhooks[0];
    const rawBody = received.body;
    const headers = received.headers;

    // Verify webhook signature with TelebirrAdapter using the Sandbox public key
    expect(() => telebirrAdapter.verifyWebhook(rawBody, headers)).not.toThrow();

    // Parse webhook payload
    const event = telebirrAdapter.parseWebhook(rawBody, headers);
    expect(event.reference).toBe('TX-TB-SANDBOX-001');
    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.amount).toBe(450);
  });

  it('detects tampered signature in security attack lab simulation', async () => {
    receivedWebhooks = [];

    await sandbox.sendWebhook('TX-TB-SANDBOX-001', Status.SUCCEEDED, {
      tamperSignature: true,
    });

    expect(receivedWebhooks.length).toBe(1);
    const { body, headers } = receivedWebhooks[0];

    expect(() => telebirrAdapter.verifyWebhook(body, headers)).toThrow(PaymentError);
    try {
      telebirrAdapter.verifyWebhook(body, headers);
    } catch (err: any) {
      expect(err.code).toBe(PaymentErrorCode.INVALID_SIGNATURE);
    }
  });

  it('returns error when querying non-existent transaction', async () => {
    await expect(telebirrAdapter.verify('NON_EXISTENT_REF')).rejects.toThrow(PaymentError);
  });
});
