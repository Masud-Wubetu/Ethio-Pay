import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { CbeBirrAdapter } from './adapter.js';
import { PaymentError, Status } from '@ethio-pay/core';

describe('CbeBirrAdapter', () => {
  const tillCode = 'TILL-99901';
  const apiKey = 'CBE_API_KEY_SECRET';
  const secretHash = 'cbe_webhook_secret_hash';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initializes CBE Birr transaction and maps to PaymentSession', async () => {
    const mockCheckoutUrl = 'https://api.cbebirr.et:8443/checkout/CBE-ORDER-101';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        code: 200,
        checkoutUrl: mockCheckoutUrl,
      }),
    } as any);

    const adapter = new CbeBirrAdapter({ tillCode, apiKey });
    const session = await adapter.initialize({
      provider: 'cbebirr',
      amount: 1200,
      currency: 'ETB',
      reference: 'CBE-ORDER-101',
      customer: { phoneNumber: '0912000000', name: 'Almaz Ayana' },
    });

    expect(session.checkoutUrl).toBe(mockCheckoutUrl);
    expect(session.status).toBe(Status.PENDING);
    expect(session.reference).toBe('CBE-ORDER-101');
  });

  it('queries CBE Birr order status and normalizes to Status.SUCCEEDED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        code: 200,
        transactionStatus: 'COMPLETED',
        amount: 1200,
        orderId: 'CBE-ORDER-101',
        transactionId: 'CBE-TXN-888',
      }),
    } as any);

    const adapter = new CbeBirrAdapter({ tillCode, apiKey });
    const paymentStatus = await adapter.verify('CBE-ORDER-101');

    expect(paymentStatus.status).toBe(Status.SUCCEEDED);
    expect(paymentStatus.amount).toBe(1200);
    expect(paymentStatus.reference).toBe('CBE-ORDER-101');
  });

  it('verifies CBE Birr HMAC webhook signature', () => {
    const adapter = new CbeBirrAdapter({ tillCode, apiKey, secretHash });
    const rawBody = JSON.stringify({
      orderId: 'CBE-ORDER-101',
      amount: 1200,
      status: 'SUCCESS',
    });

    const validSig = createHmac('sha256', secretHash).update(rawBody).digest('hex');

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-cbebirr-signature': validSig })
    ).not.toThrow();

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-cbebirr-signature': 'invalid_sig' })
    ).toThrow(PaymentError);
  });

  it('parses CBE Birr webhook payload into PaymentEvent', () => {
    const adapter = new CbeBirrAdapter({ tillCode, apiKey });
    const rawBody = JSON.stringify({
      orderId: 'CBE-ORDER-101',
      amount: 1200,
      status: 'SUCCESS',
      cbeTransactionId: 'CBE-TXN-888',
    });

    const event = adapter.parseWebhook(rawBody);
    expect(event.reference).toBe('CBE-ORDER-101');
    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.amount).toBe(1200);
  });
});

