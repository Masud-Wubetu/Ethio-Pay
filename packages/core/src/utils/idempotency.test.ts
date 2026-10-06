import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryIdempotencyStore,
  createIdempotencyMiddleware,
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

    let statusCode = 200;
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
