import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SantimPayAdapter } from './adapter.js';
import { PaymentError, Status } from '@ethio-pay/core';

describe('SantimPayAdapter', () => {
  const merchantId = 'MERCHANT-SANTIM-101';
  const authToken = 'SANTAUTH_TEST_TOKEN_999';
  const clientSecret = 'my_santimpay_secret_hash';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initializes transaction and maps to PaymentSession', async () => {
    const mockPaymentUrl = 'https://checkout.santimpay.com/pay/SAN-12345';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'success',
        paymentUrl: mockPaymentUrl,
      }),
    } as any);

    const adapter = new SantimPayAdapter({ merchantId, authToken });
    const session = await adapter.initialize({
      provider: 'santimpay',
      amount: 450,
      currency: 'ETB',
      reference: 'TX-SAN-1',
      customer: { phoneNumber: '0911000000' },
    });

    expect(session.checkoutUrl).toBe(mockPaymentUrl);
    expect(session.status).toBe(Status.PENDING);
    expect(session.reference).toBe('TX-SAN-1');
  });

  it('queries transaction status and normalizes to Status.SUCCEEDED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'success',
        paymentStatus: 'COMPLETED',
        amount: 450,
        currency: 'ETB',
        reference: 'TX-SAN-1',
      }),
    } as any);

    const adapter = new SantimPayAdapter({ merchantId, authToken });
    const paymentStatus = await adapter.verify('TX-SAN-1');

    expect(paymentStatus.status).toBe(Status.SUCCEEDED);
    expect(paymentStatus.amount).toBe(450);
  });

  it('verifies SantimPay HMAC webhook signature', () => {
    const adapter = new SantimPayAdapter({ merchantId, authToken, clientSecret });
    const rawBody = JSON.stringify({
      id: 'TX-SAN-1',
      reference: 'TX-SAN-1',
      amount: 450,
      status: 'COMPLETED',
    });

    const validSig = createHmac('sha256', clientSecret).update(rawBody).digest('hex');

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-santimpay-signature': validSig })
    ).not.toThrow();

    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-santimpay-signature': 'invalid_sig' })
    ).toThrow(PaymentError);
  });

  it('parses SantimPay webhook payload into PaymentEvent', () => {
    const adapter = new SantimPayAdapter({ merchantId, authToken });
    const rawBody = JSON.stringify({
      reference: 'TX-SAN-1',
      amount: 450,
      status: 'COMPLETED',
      txnId: 'SAN-TXN-999',
    });

    const event = adapter.parseWebhook(rawBody);
    expect(event.reference).toBe('TX-SAN-1');
    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.amount).toBe(450);
  });
});

