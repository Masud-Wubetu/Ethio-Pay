import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { AwashBirrAdapter } from './adapter.js';
import { PaymentError, Status } from '@ethio-pay/core';

describe('AwashBirrAdapter', () => {
  const merchantId = 'AWASH-MERCHANT-88';
  const passKey = 'awash_passkey_test';
  const secretHash = 'awash_webhook_secret_hash';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initializes transaction and maps to PaymentSession', async () => {
    const mockCheckoutUrl = 'https://api.awashbank.com:9443/checkout/AW-101';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        statusCode: 200,
        checkoutUrl: mockCheckoutUrl,
      }),
    } as any);

    const adapter = new AwashBirrAdapter({ merchantId, passKey });
    const session = await adapter.initialize({
      provider: 'awashbirr',
      amount: 900,
      currency: 'ETB',
      reference: 'AW-101',
    });

    expect(session.checkoutUrl).toBe(mockCheckoutUrl);
    expect(session.status).toBe(Status.PENDING);
    expect(session.reference).toBe('AW-101');
  });

  it('queries transaction status and normalizes to Status.SUCCEEDED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        statusCode: 200,
        status: 'SUCCESS',
        amount: 900,
        reference: 'AW-101',
        transactionId: 'AW-TXN-777',
      }),
    } as any);

    const adapter = new AwashBirrAdapter({ merchantId, passKey });
    const paymentStatus = await adapter.verify('AW-101');

    expect(paymentStatus.status).toBe(Status.SUCCEEDED);
    expect(paymentStatus.amount).toBe(900);
  });

  it('verifies Awash Birr HMAC webhook signature', () => {
    const adapter = new AwashBirrAdapter({ merchantId, passKey, secretHash });
    const rawBody = JSON.stringify({
      reference: 'AW-101',
      amount: 900,
      status: 'SUCCESS',
    });

    const validSig = createHmac('sha256', secretHash).update(rawBody).digest('hex');

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-awashbirr-signature': validSig })
    ).not.toThrow();

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-awashbirr-signature': 'invalid_sig' })
    ).toThrow(PaymentError);
  });

  it('parses Awash Birr webhook payload into PaymentEvent', () => {
    const adapter = new AwashBirrAdapter({ merchantId, passKey });
    const rawBody = JSON.stringify({
      reference: 'AW-101',
      amount: 900,
      status: 'SUCCESS',
      transactionId: 'AW-TXN-777',
    });

    const event = adapter.parseWebhook(rawBody);
    expect(event.reference).toBe('AW-101');
    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.amount).toBe(900);
  });
});

