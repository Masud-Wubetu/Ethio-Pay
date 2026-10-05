import { describe, it, expect, vi } from 'vitest';
import { EthiopianPayments } from './client.js';
import type { PaymentProvider } from './types/provider.js';
import { PaymentError } from './types/errors.js';

describe('EthiopianPayments Client', () => {
  const mockProvider: PaymentProvider = {
    name: 'chapa',
    initialize: vi.fn().mockResolvedValue({
      id: 'session-123',
      provider: 'chapa',
      reference: 'TX-100',
      checkoutUrl: 'https://checkout.chapa.co/123',
      status: 'PENDING',
      amount: 100,
      currency: 'ETB',
      raw: {},
    }),
    verify: vi.fn().mockResolvedValue({
      id: 'session-123',
      provider: 'chapa',
      reference: 'TX-100',
      status: 'SUCCEEDED',
      amount: 100,
      currency: 'ETB',
      raw: {},
    }),
    verifyWebhook: vi.fn(),
    parseWebhook: vi.fn().mockReturnValue({
      id: 'evt-1',
      type: 'payment.succeeded',
      provider: 'chapa',
      reference: 'TX-100',
      amount: 100,
      currency: 'ETB',
      status: 'SUCCEEDED',
      occurredAt: '2026-10-05T00:00:00Z',
      raw: {},
    }),
  };

  it('registers provider and initializes payment', async () => {
    const sdk = new EthiopianPayments({ providers: [mockProvider] });
    const session = await sdk.initialize({
      provider: 'chapa',
      amount: 100,
      currency: 'ETB',
      reference: 'TX-100',
    });

    expect(session.checkoutUrl).toBe('https://checkout.chapa.co/123');
    expect(mockProvider.initialize).toHaveBeenCalledTimes(1);
  });

  it('routes verify call to registered provider', async () => {
    const sdk = new EthiopianPayments({ providers: [mockProvider] });
    const status = await sdk.verify('chapa', 'TX-100');

    expect(status.status).toBe('SUCCEEDED');
    expect(mockProvider.verify).toHaveBeenCalledWith('TX-100');
  });

  it('routes webhook verification and parsing', () => {
    const sdk = new EthiopianPayments({ providers: [mockProvider] });
    sdk.webhooks.verify('chapa', '{"status":"success"}', { 'x-chapa-signature': 'abc' });
    expect(mockProvider.verifyWebhook).toHaveBeenCalledWith('{"status":"success"}', {
      'x-chapa-signature': 'abc',
    });

    const event = sdk.webhooks.parse('chapa', '{"status":"success"}');
    expect(event.type).toBe('payment.succeeded');
  });

  it('throws PaymentError when provider is not registered', async () => {
    const sdk = new EthiopianPayments();
    await expect(
      sdk.initialize({
        provider: 'telebirr',
        amount: 50,
        currency: 'ETB',
        reference: 'TX-999',
      })
    ).rejects.toThrow(PaymentError);
  });
});
