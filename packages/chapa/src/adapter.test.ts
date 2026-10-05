import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ChapaAdapter } from './adapter.js';
import { PaymentError, Status } from '@ethio-pay/core';

describe('ChapaAdapter', () => {
  const secretKey = 'CHASECK_TEST-1234567890';
  const secretHash = 'my_secret_hash_123';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initializes transaction and maps to PaymentSession', async () => {
    const mockCheckoutUrl = 'https://checkout.chapa.co/checkout/payment/12345';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'success',
        message: 'Hosted Link',
        data: { checkout_url: mockCheckoutUrl },
      }),
    } as any);

    const adapter = new ChapaAdapter({ secretKey });
    const session = await adapter.initialize({
      provider: 'chapa',
      amount: 250,
      currency: 'ETB',
      reference: 'TX-CHAPA-1',
      customer: {
        name: 'Abebe Bikila',
        email: 'abebe@example.com',
        phoneNumber: '0911234567',
      },
    });

    expect(session.checkoutUrl).toBe(mockCheckoutUrl);
    expect(session.status).toBe(Status.PENDING);
    expect(session.reference).toBe('TX-CHAPA-1');
  });

  it('verifies transaction status and normalizes success to Status.SUCCEEDED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'success',
        message: 'Payment details',
        data: {
          status: 'success',
          amount: 250,
          currency: 'ETB',
          tx_ref: 'TX-CHAPA-1',
          reference: '123456',
        },
      }),
    } as any);

    const adapter = new ChapaAdapter({ secretKey });
    const paymentStatus = await adapter.verify('TX-CHAPA-1');

    expect(paymentStatus.status).toBe(Status.SUCCEEDED);
    expect(paymentStatus.amount).toBe(250);
    expect(paymentStatus.reference).toBe('TX-CHAPA-1');
  });

  it('verifies webhook HMAC-SHA256 signature correctly', () => {
    const adapter = new ChapaAdapter({ secretKey, secretHash });
    const rawBody = JSON.stringify({
      event: 'charge.success',
      tx_ref: 'TX-CHAPA-1',
      amount: '250',
      currency: 'ETB',
      status: 'success',
    });

    const validSignature = createHmac('sha256', secretHash).update(rawBody).digest('hex');

    // Should pass without throwing
    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-chapa-signature': validSignature })
    ).not.toThrow();

    // Should throw INVALID_SIGNATURE for invalid signature
    expect(() =>
      adapter.verifyWebhook(rawBody, { 'x-chapa-signature': 'invalid_signature_hash' })
    ).toThrowError(PaymentError);
  });

  it('parses webhook payload into normalized PaymentEvent', () => {
    const adapter = new ChapaAdapter({ secretKey });
    const rawBody = JSON.stringify({
      event: 'charge.success',
      tx_ref: 'TX-CHAPA-1',
      amount: '250',
      currency: 'ETB',
      status: 'success',
      created_at: '2026-10-04T00:00:00Z',
    });

    const event = adapter.parseWebhook(rawBody);

    expect(event.type).toBe('payment.succeeded');
    expect(event.status).toBe(Status.SUCCEEDED);
    expect(event.reference).toBe('TX-CHAPA-1');
    expect(event.amount).toBe(250);
  });
});
