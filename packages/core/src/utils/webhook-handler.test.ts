import { describe, it, expect, vi } from 'vitest';
import { EthiopianPayments } from '../client.js';
import { handleWebWebhook } from './webhook-handler.js';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { Status } from '../types/status.js';

describe('handleWebWebhook (Web Standard / Next.js Webhook Handler)', () => {
  const mockProvider = {
    name: 'testprovider',
    initialize: vi.fn(),
    verify: vi.fn(),
    verifyWebhook: vi.fn(),
    parseWebhook: vi.fn().mockReturnValue({
      id: 'EVT-1',
      type: 'payment.succeeded',
      provider: 'testprovider',
      reference: 'ORDER-101',
      amount: 400,
      currency: 'ETB',
      status: Status.SUCCEEDED,
      occurredAt: '2026-11-24T00:00:00Z',
      raw: {},
    }),
  };

  const sdk = new EthiopianPayments({
    providers: [mockProvider],
  });

  it('successfully processes valid webhook and dispatches onSuccess callback', async () => {
    let callbackTriggered = false;
    const req = new Request('https://example.com/api/webhooks/testprovider', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-signature': 'sig123',
      },
      body: JSON.stringify({
        reference: 'ORDER-101',
        amount: 400,
      }),
    });

    const response = await handleWebWebhook(req, {
      sdk,
      provider: 'testprovider',
      onSuccess: async (event) => {
        expect(event.reference).toBe('ORDER-101');
        callbackTriggered = true;
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('success');
    expect(body.reference).toBe('ORDER-101');
    expect(callbackTriggered).toBe(true);
    expect(mockProvider.verifyWebhook).toHaveBeenCalled();
  });

  it('intercepts duplicate webhook delivery using idempotency store', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('ORDER-DUPLICATE', true);

    const req = new Request('https://example.com/api/webhooks/testprovider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'ORDER-DUPLICATE' }),
    });

    const response = await handleWebWebhook(req, {
      sdk,
      provider: 'testprovider',
      idempotencyStore: store,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.idempotent).toBe(true);
    expect(body.message).toContain('already processed');
  });

  it('returns HTTP 400 when signature verification fails', async () => {
    const failingProvider = {
      name: 'failingprovider',
      initialize: vi.fn(),
      verify: vi.fn(),
      verifyWebhook: vi.fn().mockImplementation(() => {
        throw new Error('Invalid signature');
      }),
      parseWebhook: vi.fn(),
    };

    const failingSdk = new EthiopianPayments({
      providers: [failingProvider],
    });

    const req = new Request('https://example.com/api/webhooks/failingprovider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'ORDER-FAIL' }),
    });

    const response = await handleWebWebhook(req, {
      sdk: failingSdk,
      provider: 'failingprovider',
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe('failed');
    expect(body.message).toBe('Invalid signature');
  });
});

