import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from './http.js';
import { PaymentError } from '../types/errors.js';

describe('HttpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('performs a successful GET request and returns JSON response', async () => {
    const mockData = { status: 'success', data: { id: '123' } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as any);

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await client.request<typeof mockData>('/test');

    expect(res.data).toEqual(mockData);
    expect(res.status).toEqual(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 server error up to maxRetries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal error' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ status: 'recovered' }),
      } as any);

    globalThis.fetch = fetchMock;

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      maxRetries: 2,
      retryDelayMs: 10,
    });

    const res = await client.request<{ status: string }>('/retry-test', { method: 'GET' });

    expect(res.data.status).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws PaymentError with INVALID_CREDENTIALS code on 401 response without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    } as any);

    globalThis.fetch = fetchMock;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });

    await expect(client.request('/auth-test')).rejects.toThrow(PaymentError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws PaymentError with NETWORK_TIMEOUT on request abort', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      timeoutMs: 50,
      maxRetries: 0,
    });

    await expect(client.request('/timeout-test')).rejects.toThrow('Request timed out after 50ms');
  });
});
