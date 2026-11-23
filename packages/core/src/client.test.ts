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

  it('automatically falls back to fallbackProvider when primary provider throws an outage error', async () => {
    const failingPrimary: PaymentProvider = {
      name: 'chapa',
      initialize: vi.fn().mockRejectedValue(new Error('Chapa 503 Service Unavailable')),
      verify: vi.fn(),
      verifyWebhook: vi.fn(),
      parseWebhook: vi.fn(),
    };

    const healthyFallback: PaymentProvider = {
      name: 'telebirr',
      initialize: vi.fn().mockResolvedValue({
        id: 'telebirr-session-99',
        provider: 'telebirr',
        reference: 'TX-FAILOVER-1',
        checkoutUrl: 'https://telebirr.et/pay/99',
        status: 'PENDING',
        amount: 200,
        currency: 'ETB',
        raw: {},
      }),
      verify: vi.fn(),
      verifyWebhook: vi.fn(),
      parseWebhook: vi.fn(),
    };

    const sdk = new EthiopianPayments({
      providers: [failingPrimary, healthyFallback],
    });

    const session = await sdk.initialize({
      provider: 'chapa',
      fallbackProviders: ['telebirr'],
      amount: 200,
      currency: 'ETB',
      reference: 'TX-FAILOVER-1',
    });

    expect(failingPrimary.initialize).toHaveBeenCalled();
    expect(healthyFallback.initialize).toHaveBeenCalled();
    expect(session.provider).toBe('telebirr');
    expect(session.checkoutUrl).toBe('https://telebirr.et/pay/99');
  });

  it('uses defaultFallbackProviders when configured on client level', async () => {
    const failingPrimary: PaymentProvider = {
      name: 'primary',
      initialize: vi.fn().mockRejectedValue(new Error('Gateway Down')),
      verify: vi.fn(),
      verifyWebhook: vi.fn(),
      parseWebhook: vi.fn(),
    };

    const healthyBackup: PaymentProvider = {
      name: 'backup',
      initialize: vi.fn().mockResolvedValue({
        id: 'backup-session',
        provider: 'backup',
        reference: 'TX-DEF-1',
        checkoutUrl: 'https://backup.et/pay',
        status: 'PENDING',
        amount: 150,
        currency: 'ETB',
        raw: {},
      }),
      verify: vi.fn(),
      verifyWebhook: vi.fn(),
      parseWebhook: vi.fn(),
    };

    const sdk = new EthiopianPayments({
      providers: [failingPrimary, healthyBackup],
      defaultFallbackProviders: ['backup'],
    });

    const session = await sdk.initialize({
      provider: 'primary',
      amount: 150,
      currency: 'ETB',
      reference: 'TX-DEF-1',
    });

    expect(session.provider).toBe('backup');
  });
});
