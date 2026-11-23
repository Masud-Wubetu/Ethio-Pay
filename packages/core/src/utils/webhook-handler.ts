import type { EthiopianPayments } from '../client.js';
import type { PaymentEvent } from '../types/models.js';
import { PaymentError } from '../types/errors.js';
import {
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  extractIdempotencyKey,
} from './idempotency.js';

export interface WebhookHandlerOptions {
  sdk: EthiopianPayments;
  provider?: string;
  idempotencyStore?: IdempotencyStore;
  onSuccess?: (event: PaymentEvent) => Promise<void> | void;
  onFailure?: (event: PaymentEvent) => Promise<void> | void;
  onEvent?: (event: PaymentEvent) => Promise<void> | void;
}

const defaultStore = new InMemoryIdempotencyStore();

/**
 * Universal Web Standard webhook handler.
 * Compatible with Next.js (App Router route.ts), Remix, SvelteKit, Cloudflare Workers, and standard Web fetch Request/Response.
 */
export async function handleWebWebhook(
  request: Request,
  options: WebhookHandlerOptions
): Promise<Response> {
  const store = options.idempotencyStore ?? defaultStore;

  try {
    const rawBody = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((val, key) => {
      headers[key.toLowerCase()] = val;
    });

    // Detect provider from options, headers, or request URL
    const provider = (
      options.provider ||
      headers['x-ethiopay-provider'] ||
      (request.url.includes('telebirr') ? 'telebirr' : 'chapa')
    ).toLowerCase();

    // Idempotency check before processing
    const idempotencyKey = extractIdempotencyKey(headers, rawBody);
    if (idempotencyKey) {
      const alreadyProcessed = await store.has(idempotencyKey);
      if (alreadyProcessed) {
        return new Response(
          JSON.stringify({
            status: 'success',
            message: 'Event already processed (Idempotent replay ignored)',
            idempotent: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Cryptographic signature verification
    options.sdk.webhooks.verify(provider, rawBody, headers);

    // Parse normalized payment event
    const event = options.sdk.webhooks.parse(provider, rawBody, headers);

    // Record idempotency on verified event
    if (idempotencyKey) {
      await Promise.resolve(store.set(idempotencyKey, true));
    }

    // Invoke user callbacks
    if (options.onEvent) {
      await options.onEvent(event);
    }
    if (event.type === 'payment.succeeded' && options.onSuccess) {
      await options.onSuccess(event);
    } else if (event.type === 'payment.failed' && options.onFailure) {
      await options.onFailure(event);
    }

    const responseBody =
      provider === 'telebirr'
        ? { code: 0, msg: 'success', status: 'success', reference: event.reference }
        : { status: 'success', message: 'Webhook processed successfully', reference: event.reference };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const httpStatus = err instanceof PaymentError ? err.httpStatus || 400 : 400;
    const errorBody = {
      status: 'failed',
      message: err.message || 'Webhook verification failed',
      code: err instanceof PaymentError ? err.code : 'WEBHOOK_ERROR',
    };

    return new Response(JSON.stringify(errorBody), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

