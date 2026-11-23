import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  HttpClient,
  PaymentError,
  PaymentErrorCode,
  Status,
  type PaymentProvider,
  type InitRequest,
  type PaymentSession,
  type PaymentStatus,
  type PaymentEvent,
  type PaymentEventType,
  type WebhookHeaders,
} from '@ethio-pay/core';
import type {
  ArifPayConfig,
  ArifPaySessionResponse,
  ArifPayStatusResponse,
} from './types.js';

export const DEFAULT_ARIFPAY_BASE_URL = 'https://gateway.arifpay.net';

/**
 * ArifPay Payment Provider Adapter.
 */
export class ArifPayAdapter implements PaymentProvider {
  public readonly name = 'arifpay';
  private config: ArifPayConfig;
  private httpClient: HttpClient;

  constructor(config: ArifPayConfig) {
    if (!config?.apiKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'ArifPay apiKey is required',
        provider: 'arifpay',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_ARIFPAY_BASE_URL,
      timeoutMs: config.timeout ?? 15000,
      maxRetries: config.maxRetries ?? 3,
    });
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.reference || req.reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'arifpay',
      });
    }

    if (typeof req.amount !== 'number' || req.amount <= 0 || Number.isNaN(req.amount)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment amount must be a positive number',
        provider: 'arifpay',
      });
    }

    const payload = {
      cancelUrl: req.returnUrl,
      errorUrl: req.returnUrl,
      notifyUrl: req.callbackUrl,
      successUrl: req.returnUrl,
      paymentMethods: ['TELEBIRR', 'CBEBIRR', 'AWASH', 'CARD'],
      items: [
        {
          name: req.description || `Order ${req.reference}`,
          quantity: 1,
          price: req.amount,
          description: req.description || req.reference,
        },
      ],
      beneficiaries: [
        {
          accountNumber: req.reference,
          bank: 'CBE',
          amount: req.amount,
        },
      ],
    };

    try {
      const response = await this.httpClient.request<ArifPaySessionResponse>(
        '/api/sandbox/checkout/session',
        {
          method: 'POST',
          headers: {
            'x-arifpay-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const data = response.data?.data;
      const checkoutUrl = data?.paymentUrl || data?.checkoutUrl || `${this.config.baseUrl || DEFAULT_ARIFPAY_BASE_URL}/checkout/${encodeURIComponent(req.reference)}`;

      return {
        id: data?.sessionId || req.reference,
        provider: 'arifpay',
        reference: req.reference,
        checkoutUrl,
        status: Status.PENDING,
        amount: req.amount,
        currency: req.currency || 'ETB',
        raw: response.data,
      };
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        throw err;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: (err as Error).message || 'ArifPay checkout initialization failed',
        provider: 'arifpay',
        raw: err,
      });
    }
  }

  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Transaction reference is required for verification',
        provider: 'arifpay',
      });
    }

    try {
      const response = await this.httpClient.request<ArifPayStatusResponse>(
        `/api/sandbox/checkout/session/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            'x-arifpay-key': this.config.apiKey,
          },
        }
      );

      const raw = response.data?.data || (response.data as any);
      const rawStatus = (raw.transactionStatus || raw.status || '').toUpperCase();

      let status: Status = Status.PENDING;
      if (rawStatus === 'SUCCESS' || rawStatus === 'PAID' || rawStatus === 'COMPLETED') {
        status = Status.SUCCEEDED;
      } else if (rawStatus === 'FAILED' || rawStatus === 'CANCELLED') {
        status = Status.FAILED;
      } else if (rawStatus === 'EXPIRED') {
        status = Status.EXPIRED;
      }

      return {
        id: raw.sessionId || reference,
        provider: 'arifpay',
        reference: raw.orderId || reference,
        status,
        amount: raw.totalAmount ? Number(raw.totalAmount) : 0,
        currency: 'ETB',
        raw: response.data,
      };
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        throw err;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: (err as Error).message || 'ArifPay verification failed',
        provider: 'arifpay',
        raw: err,
      });
    }
  }

  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Raw body is required for ArifPay webhook verification',
        provider: 'arifpay',
      });
    }

    const secret = this.config.secretKey || this.config.apiKey;
    let signatureHeader: string | undefined;

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-arifpay-signature' || lower === 'arifpay-signature') {
        signatureHeader = Array.isArray(value) ? value[0] : value;
        break;
      }
    }

    if (!signatureHeader) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing ArifPay webhook signature header (x-arifpay-signature)',
        provider: 'arifpay',
      });
    }

    const expectedHash = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expectedHash, 'utf-8');
    const actualBuffer = Buffer.from(signatureHeader, 'utf-8');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Invalid ArifPay webhook signature',
        provider: 'arifpay',
      });
    }
  }

  public parseWebhook(rawBody: string, _headers?: WebhookHeaders): PaymentEvent {
    let payload: Record<string, any>;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch (err: unknown) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Failed to parse ArifPay webhook body as JSON',
        provider: 'arifpay',
        raw: err,
      });
    }

    const reference = payload.orderId || payload.reference || payload.sessionId;
    if (!reference) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Missing reference in ArifPay webhook payload',
        provider: 'arifpay',
        raw: payload,
      });
    }

    const rawStatus = String(payload.status || payload.transactionStatus || '').toUpperCase();
    let status: Status = Status.PENDING;
    let eventType: PaymentEventType = 'payment.succeeded';

    if (rawStatus === 'SUCCESS' || rawStatus === 'PAID' || rawStatus === 'COMPLETED') {
      status = Status.SUCCEEDED;
      eventType = 'payment.succeeded';
    } else if (rawStatus === 'EXPIRED') {
      status = Status.EXPIRED;
      eventType = 'payment.expired';
    } else {
      status = Status.FAILED;
      eventType = 'payment.failed';
    }

    return {
      id: String(payload.sessionId || payload.id || reference),
      type: eventType,
      provider: 'arifpay',
      reference,
      amount: Number(payload.totalAmount || payload.amount || 0),
      currency: 'ETB',
      status,
      occurredAt: payload.timestamp || new Date().toISOString(),
      raw: payload,
    };
  }
}

