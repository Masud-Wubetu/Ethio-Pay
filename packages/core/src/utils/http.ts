import { PaymentError } from '../types/errors.js';

export interface HttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retry?: boolean;
  maxRetries?: number;
}

/**
 * Resilient HTTP client with default 15s timeout, automatic exponential backoff retry for network/5xx errors.
 */
export class HttpClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl || '';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 300;
  }

  public async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<{ data: T; status: number; headers: Headers }> {
    const url = this.baseUrl
      ? `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
      : path;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const method = (options.method || 'GET').toUpperCase();
    const shouldRetry = options.retry ?? (method === 'GET');
    const maxRetries = options.maxRetries ?? (shouldRetry ? this.maxRetries : 0);

    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!response.ok) {
          const is5xx = response.status >= 500 && response.status < 600;
          if (is5xx && shouldRetry && attempt < maxRetries) {
            attempt++;
            await this.sleep(this.retryDelayMs * Math.pow(2, attempt - 1));
            continue;
          }

          let responseData: unknown;
          try {
            responseData = await response.json();
          } catch {
            responseData = await response.text();
          }

          throw new PaymentError({
            code:
              response.status === 401 || response.status === 403
                ? 'INVALID_CREDENTIALS'
                : 'PROVIDER_ERROR',
            message: `HTTP request failed with status ${response.status}`,
            provider: 'http',
            httpStatus: response.status,
            raw: responseData,
          });
        }

        const data = (await response.json()) as T;
        return { data, status: response.status, headers: response.headers };
      } catch (err: unknown) {
        if (err instanceof PaymentError) {
          throw err;
        }

        const errorObj = err as Error;
        const isTimeout = errorObj.name === 'AbortError';
        const isNetworkError =
          errorObj.name === 'FetchError' ||
          errorObj.name === 'TypeError' ||
          isTimeout;

        if (isNetworkError && shouldRetry && attempt < maxRetries) {
          attempt++;
          await this.sleep(this.retryDelayMs * Math.pow(2, attempt - 1));
          continue;
        }

        throw new PaymentError({
          code: isTimeout ? 'NETWORK_TIMEOUT' : 'PROVIDER_ERROR',
          message: isTimeout
            ? `Request timed out after ${timeout}ms`
            : errorObj.message || 'Network call failed',
          provider: 'http',
          raw: err,
        });
      }
    }

    throw new PaymentError({
      code: 'PROVIDER_ERROR',
      message: 'Request failed after maximum retries',
      provider: 'http',
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
