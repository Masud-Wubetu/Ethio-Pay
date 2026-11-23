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
  AwashBirrConfig,
  AwashBirrInitResponse,
  AwashBirrQueryResponse,
} from './types.js';

export const DEFAULT_AWASHBIRR_BASE_URL = 'https://api.awashbank.com:9443';

/**
 * Awash Birr Payment Provider Adapter.
 */
export class AwashBirrAdapter implements PaymentProvider {
  public readonly name = 'awashbirr';
  private config: AwashBirrConfig;
  private httpClient: HttpClient;

  constructor(config: AwashBirrConfig) {
    if (!config?.merchantId || !config?.passKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Awash Birr merchantId and passKey are required',
        provider: 'awashbirr',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_AWASHBIRR_BASE_URL,
      timeoutMs: config.timeout ?? 15000,
      maxRetries: config.maxRetries ?? 3,
    });
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.reference || req.reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'awashbirr',
      });
    }

    if (typeof req.amount !== 'number' || req.amount <= 0 || Number.isNaN(req.amount)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment amount must be a positive number',
        provider: 'awashbirr',
      });
    }

    const payload = {
      merchantId: this.config.merchantId,
      reference: req.reference,
      amount: req.amount,
      currency: (req.currency || 'ETB').toUpperCase(),
      customerPhone: req.customer?.phoneNumber,
      returnUrl: req.returnUrl,
      callbackUrl: req.callbackUrl,
    };

    try {
      const response = await this.httpClient.request<AwashBirrInitResponse>(
        '/awash/payment/v1/initiate',
        {
          method: 'POST',
          headers: {
            'x-pass-key': this.config.passKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const checkoutUrl =
        response.data.checkoutUrl ||
        response.data.paymentUrl ||
        `${this.config.baseUrl || DEFAULT_AWASHBIRR_BASE_URL}/checkout/${encodeURIComponent(req.reference)}`;

      return {
        id: req.reference,
        provider: 'awashbirr',
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
        message: (err as Error).message || 'Awash Birr initialization failed',
        provider: 'awashbirr',
        raw: err,
      });
    }
  }

  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Transaction reference is required for verification',
        provider: 'awashbirr',
      });
    }

    try {
      const response = await this.httpClient.request<AwashBirrQueryResponse>(
        `/awash/payment/v1/status/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            'x-pass-key': this.config.passKey,
          },
        }
      );

      const raw = response.data;
      const rawStatus = (raw.status || '').toUpperCase();

      let status: Status = Status.PENDING;
      if (rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || rawStatus === 'PAID') {
        status = Status.SUCCEEDED;
      } else if (rawStatus === 'FAILED' || rawStatus === 'CANCELLED') {
        status = Status.FAILED;
      } else if (rawStatus === 'EXPIRED') {
        status = Status.EXPIRED;
      }

      return {
        id: String(raw.transactionId || reference),
        provider: 'awashbirr',
        reference: String(raw.reference || reference),
        status,
        amount: raw.amount ? Number(raw.amount) : 0,
        currency: raw.currency || 'ETB',
        raw,
      };
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        throw err;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: (err as Error).message || 'Awash Birr verification failed',
        provider: 'awashbirr',
        raw: err,
      });
    }
  }

  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Raw body is required for Awash Birr webhook verification',
        provider: 'awashbirr',
      });
    }

    const secret = this.config.secretHash || this.config.passKey;
    let signatureHeader: string | undefined;

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-awashbirr-signature' || lower === 'awashbirr-signature') {
        signatureHeader = Array.isArray(value) ? value[0] : value;
        break;
      }
    }

    if (!signatureHeader) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing Awash Birr webhook signature header (x-awashbirr-signature)',
        provider: 'awashbirr',
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
        message: 'Invalid Awash Birr webhook signature',
        provider: 'awashbirr',
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
        message: 'Failed to parse Awash Birr webhook body as JSON',
        provider: 'awashbirr',
        raw: err,
      });
    }

    const reference = payload.reference || payload.orderId || payload.transactionRef;
    if (!reference) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Missing reference in Awash Birr webhook payload',
        provider: 'awashbirr',
        raw: payload,
      });
    }

    const rawStatus = String(payload.status || '').toUpperCase();
    let status: Status = Status.PENDING;
    let eventType: PaymentEventType = 'payment.succeeded';

    if (rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || rawStatus === 'PAID') {
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
      id: String(payload.transactionId || reference),
      type: eventType,
      provider: 'awashbirr',
      reference,
      amount: Number(payload.amount || 0),
      currency: payload.currency || 'ETB',
      status,
      occurredAt: payload.timestamp || new Date().toISOString(),
      raw: payload,
    };
  }
}

