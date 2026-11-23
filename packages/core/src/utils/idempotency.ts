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

export interface RedisLikeClient {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, ...args: any[]): Promise<any> | any;
  del?(key: string): Promise<any> | any;
}

export interface RedisIdempotencyStoreOptions {
  client: RedisLikeClient;
  keyPrefix?: string;
  defaultTtlMs?: number;
}

/**
 * Production-ready Redis-backed IdempotencyStore.
 * Compatible with ioredis, node-redis, and cloud Redis clients.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private client: RedisLikeClient;
  private keyPrefix: string;
  private defaultTtlMs: number;

  constructor(options: RedisIdempotencyStoreOptions) {
    if (!options?.client) {
      throw new Error('Redis client is required for RedisIdempotencyStore');
    }
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'ethiopay:idempotency:';
    this.defaultTtlMs = options.defaultTtlMs ?? 86400000; // 24 hours
  }

  private formatKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  public async has(key: string): Promise<boolean> {
    const val = await this.client.get(this.formatKey(key));
    return val !== null && val !== undefined;
  }

  public async get(key: string): Promise<unknown> {
    const val = await this.client.get(this.formatKey(key));
    if (val === null || val === undefined) return undefined;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  public async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const redisKey = this.formatKey(key);

    if (ttl > 0) {
      const ttlSeconds = Math.ceil(ttl / 1000);
      try {
        await this.client.set(redisKey, serialized, 'EX', ttlSeconds);
      } catch {
        // Fallback for node-redis v4 options object
        await this.client.set(redisKey, serialized, { EX: ttlSeconds } as any);
      }
    } else {
      await this.client.set(redisKey, serialized);
    }
  }
}

/**
 * Extracts a normalized transaction reference or custom idempotency key from headers and payload.
 */
export function extractIdempotencyKey(
  headers: Record<string, unknown> | undefined,
  body: unknown
): string | undefined {
  let key: string | undefined;

  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'x-idempotency-key') {
        key = Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined;
        break;
      }
    }
  }

  if (!key) {
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, any>;
      key = b.tx_ref || b.reference || b.outTradeNo || b.tradeNo || b.data?.tx_ref;
    } else if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        key =
          parsed.tx_ref ||
          parsed.reference ||
          parsed.outTradeNo ||
          parsed.tradeNo ||
          parsed.data?.tx_ref;
      } catch {
        // ignore non-json strings
      }
    }
  }

  return typeof key === 'string' && key.trim() !== '' ? key.trim() : undefined;
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
      const key = extractIdempotencyKey(req.headers, req.body);

      if (!key) {
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
