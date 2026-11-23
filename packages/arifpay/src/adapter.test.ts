import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ArifPayAdapter } from './adapter.js';
import { PaymentError, Status } from '@ethio-pay/core';

describe('ArifPayAdapter', () => {
  const apiKey = 'ARIFPAY_TEST_API_KEY_123';
  const secretKey = 'arifpay_secret_key_hash';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initializes transaction and maps to PaymentSession', async () => {
    const mockCheckoutUrl = 'https://gateway.arifpay.net/checkout/session/ARIF-101';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        error: false,
        data: {
          sessionId: 'ARIF-SESS-99',
          paymentUrl: mockCheckoutUrl,
        },
      }),
    } as any);

    const adapter = new ArifPayAdapter({ apiKey });
    const session = await adapter.initialize({
      provider: 'arifpay',
      amount: 600,
      currency: 'ETB',
      reference: 'ARIF-101',
    });

    expect(session.checkoutUrl).toBe(mockCheckoutUrl);
    expect(session.status).toBe(Status.PENDING);
    expect(session.reference).toBe('ARIF-101');
  });

  it('queries transaction status and normalizes to Status.SUCCEEDED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        error: false,
        data: {
          sessionId: 'ARIF-SESS-99',
          orderId: 'ARIF-101',
          transactionStatus: 'PAID',
          totalAmount: 600,
        },
      }),
    } as any);

    const adapter = new ArifPayAdapter({ apiKey });
    const paymentStatus = await adapter.verify('ARIF-101');

    expect(paymentStatus.status).toBe(Status.SUCCEEDED);
    expect(paymentStatus.amount).toBe(600);
  });

  it('verifies ArifPay HMAC webhook signature', () => {
    const adapter = new ArifPayAdapter({ apiKey, secretKey });
    const rawBody = JSON.stringify({
      orderId: 'ARIF-101',
      totalAmount: 600,
      status: 'PAID',
    });

    const validSig = createHmac('sha256', secretKey).update(rawBody).digest('hex');

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-arifpay-signature': validSig })
    ).not.toThrow();

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-arifpay-signature': 'invalid_sig' })
    ).toThrow(PaymentError);
  });

  it('parses ArifPay webhook payload into PaymentEvent', () => {
    const adapter = new ArifPayAdapter({ apiKey });
    const rawBody = JSON.stringify({
      orderId: 'ARIF-101',
      totalAmount: 600,
      status: 'PAID',
      sessionId: 'ARIF-SESS-99',
    });

    const event = adapter.parseWebhook(rawBody);
    expect(event.reference).toBe('ARIF-101');
    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.amount).toBe(600);
  });
});

