import { PaymentError, PaymentErrorCode } from '../types/errors.js';

export interface IdempotencyStore {
  has(key: string): Promise<boolean> | boolean;
  set(key: string, value: unknown, ttlMs?: number): Promise<void> | void;
  get?(key: string): Promise<unknown> | unknown;
}

/**
 * Default in-memory implementation of IdempotencyStore with TTL support.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  public has(key: string): boolean {
    const item = this.store.get(key);
    if (!item) return false;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  public set(key: string, value: unknown, ttlMs: number = 86400000): void {
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  public get(key: string): unknown {
    if (!this.has(key)) return undefined;
    return this.store.get(key)?.value;
  }
}

/**
 * Creates Express middleware to enforce idempotency on incoming webhook requests.
 * Prevents double-fulfillment of duplicate webhooks.
 */
export function createIdempotencyMiddleware(
  store: IdempotencyStore = new InMemoryIdempotencyStore()
) {
  return async (req: any, res: any, next: any) => {
    try {
      let key = req.headers && req.headers['x-idempotency-key'];

      if (!key) {
        if (typeof req.body === 'object' && req.body !== null) {
          key = req.body.tx_ref || req.body.reference || req.body.data?.tx_ref;
        } else if (typeof req.body === 'string') {
          try {
            const parsed = JSON.parse(req.body);
            key = parsed.tx_ref || parsed.reference || parsed.data?.tx_ref;
          } catch {
            // ignore
          }
        }
      }

      if (!key || typeof key !== 'string') {
        return next();
      }

      const isProcessed = await store.has(key);
      if (isProcessed) {
        return res.status(200).json({
          status: 'success',
          message: 'Event already processed (Idempotent replay ignored)',
          idempotent: true,
        });
      }

      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          Promise.resolve(store.set(key, true)).catch(() => {});
        }
        return originalJson(body);
      };

      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}
