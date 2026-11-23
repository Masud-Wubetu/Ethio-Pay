import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryIdempotencyStore,
  RedisIdempotencyStore,
  createIdempotencyMiddleware,
  extractIdempotencyKey,
} from './idempotency.js';

describe('InMemoryIdempotencyStore', () => {
  it('stores and retrieves idempotency keys', () => {
    const store = new InMemoryIdempotencyStore();
    expect(store.has('tx-100')).toBe(false);

    store.set('tx-100', true);
    expect(store.has('tx-100')).toBe(true);
  });

  it('respects TTL expiration', async () => {
    const store = new InMemoryIdempotencyStore();
    store.set('tx-short', true, 20); // 20ms TTL

    expect(store.has('tx-short')).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(store.has('tx-short')).toBe(false);
  });
});

describe('createIdempotencyMiddleware', () => {
  it('passes through new non-duplicate requests and records key on 200 OK response', async () => {
    const store = new InMemoryIdempotencyStore();
    const middleware = createIdempotencyMiddleware(store);

    const req = {
      body: { tx_ref: 'ORDER-999' },
      headers: {},
    };

    const statusCode = 200;
    const res: any = {
      statusCode,
      status: (code: number) => {
        res.statusCode = code;
        return res;
      },
      json: vi.fn(),
    };

    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Simulate route handler calling res.json(...)
    res.json({ status: 'success' });
    expect(store.has('ORDER-999')).toBe(true);
  });

  it('intercepts duplicate requests and responds with 200 OK idempotent status', async () => {
    const store = new InMemoryIdempotencyStore();
    store.set('ORDER-999', true);

    const middleware = createIdempotencyMiddleware(store);

    const req = {
      body: { tx_ref: 'ORDER-999' },
      headers: {},
    };

    const res: any = {
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent: true })
    );
  });
});

describe('RedisIdempotencyStore', () => {
  it('stores and checks idempotency keys with mock Redis client', async () => {
    const memory = new Map<string, string>();
    const mockRedis = {
      get: vi.fn(async (key: string) => memory.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => {
        memory.set(key, val);
        return 'OK';
      }),
    };

    const store = new RedisIdempotencyStore({
      client: mockRedis,
      keyPrefix: 'test:idemp:',
      defaultTtlMs: 3600000,
    });

    expect(await store.has('TX-100')).toBe(false);
    await store.set('TX-100', { processed: true });

    expect(mockRedis.set).toHaveBeenCalledWith(
      'test:idemp:TX-100',
      JSON.stringify({ processed: true }),
      'EX',
      3600
    );
    expect(await store.has('TX-100')).toBe(true);

    const val = await store.get('TX-100');
    expect(val).toEqual({ processed: true });
  });

  it('throws if Redis client is missing', () => {
    expect(() => new RedisIdempotencyStore({} as any)).toThrowError();
  });
});

describe('extractIdempotencyKey', () => {
  it('extracts key from x-idempotency-key header', () => {
    const key = extractIdempotencyKey({ 'X-Idempotency-Key': 'IDEMP-123' }, null);
    expect(key).toBe('IDEMP-123');
  });

  it('extracts key from Chapa tx_ref and Telebirr outTradeNo', () => {
    expect(extractIdempotencyKey({}, { tx_ref: 'CHAPA-REF' })).toBe('CHAPA-REF');
    expect(extractIdempotencyKey({}, { outTradeNo: 'TB-REF' })).toBe('TB-REF');
    expect(extractIdempotencyKey({}, JSON.stringify({ tradeNo: 'TB-NO' }))).toBe('TB-NO');
  });
});
