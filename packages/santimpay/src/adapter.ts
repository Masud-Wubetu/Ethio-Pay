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
  SantimPayConfig,
  SantimPayInitResponse,
  SantimPayStatusResponse,
} from './types.js';

export const DEFAULT_SANTIMPAY_BASE_URL = 'https://services.santimpay.com';

/**
 * SantimPay Payment Provider Adapter.
 */
export class SantimPayAdapter implements PaymentProvider {
  public readonly name = 'santimpay';
  private config: SantimPayConfig;
  private httpClient: HttpClient;

  constructor(config: SantimPayConfig) {
    if (!config?.merchantId || !config?.authToken) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'SantimPay merchantId and authToken are required',
        provider: 'santimpay',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_SANTIMPAY_BASE_URL,
      timeoutMs: config.timeout ?? 15000,
      maxRetries: config.maxRetries ?? 3,
    });
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.reference || req.reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'santimpay',
      });
    }

    if (typeof req.amount !== 'number' || req.amount <= 0 || Number.isNaN(req.amount)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment amount must be a positive number',
        provider: 'santimpay',
      });
    }

    const payload = {
      id: req.reference,
      amount: req.amount,
      paymentReason: req.description || `Payment for ${req.reference}`,
      merchantId: this.config.merchantId,
      phoneNumber: req.customer?.phoneNumber,
      successRedirectUrl: req.returnUrl,
      failureRedirectUrl: req.returnUrl,
      notifyUrl: req.callbackUrl,
    };

    try {
      const response = await this.httpClient.request<SantimPayInitResponse>(
        '/api/v1/gateway/initiate-payment',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const checkoutUrl = response.data.paymentUrl || response.data.url;
      if (!checkoutUrl) {
        throw new PaymentError({
          code: PaymentErrorCode.PROVIDER_ERROR,
          message: response.data.message || 'SantimPay initialization failed (missing paymentUrl)',
          provider: 'santimpay',
          httpStatus: response.status,
          raw: response.data,
        });
      }

      return {
        id: req.reference,
        provider: 'santimpay',
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
        message: (err as Error).message || 'SantimPay initialization network failure',
        provider: 'santimpay',
        raw: err,
      });
    }
  }

  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Transaction reference is required for verification',
        provider: 'santimpay',
      });
    }

    try {
      const response = await this.httpClient.request<SantimPayStatusResponse>(
        `/api/v1/gateway/payment-status/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.authToken}`,
          },
        }
      );

      const raw = response.data;
      const rawStatus = (raw.paymentStatus || raw.transactionStatus || raw.status || '').toUpperCase();

      let status: Status = Status.PENDING;
      if (rawStatus === 'COMPLETED' || rawStatus === 'SUCCESS' || rawStatus === 'PAID') {
        status = Status.SUCCEEDED;
      } else if (rawStatus === 'FAILED' || rawStatus === 'CANCELLED') {
        status = Status.FAILED;
      } else if (rawStatus === 'EXPIRED') {
        status = Status.EXPIRED;
      }

      return {
        id: raw.id || reference,
        provider: 'santimpay',
        reference: raw.reference || reference,
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
        message: (err as Error).message || 'SantimPay status query failed',
        provider: 'santimpay',
        raw: err,
      });
    }
  }

  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Raw body is required for SantimPay webhook verification',
        provider: 'santimpay',
      });
    }

    const signingKey = this.config.clientSecret || this.config.authToken;
    let signatureHeader: string | undefined;

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-santimpay-signature' || lower === 'santimpay-signature') {
        signatureHeader = Array.isArray(value) ? value[0] : value;
        break;
      }
    }

    if (!signatureHeader) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing SantimPay webhook signature header (x-santimpay-signature)',
        provider: 'santimpay',
      });
    }

    const expectedHash = createHmac('sha256', signingKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expectedHash, 'utf-8');
    const actualBuffer = Buffer.from(signatureHeader, 'utf-8');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Invalid SantimPay webhook signature',
        provider: 'santimpay',
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
        message: 'Failed to parse SantimPay webhook body as JSON',
        provider: 'santimpay',
        raw: err,
      });
    }

    const reference = payload.reference || payload.id || payload.thirdPartyId;
    if (!reference) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Missing transaction reference in SantimPay webhook payload',
        provider: 'santimpay',
        raw: payload,
      });
    }

    const rawStatus = String(payload.status || payload.paymentStatus || '').toUpperCase();
    let status: Status = Status.PENDING;
    let eventType: PaymentEventType = 'payment.succeeded';

    if (rawStatus === 'COMPLETED' || rawStatus === 'SUCCESS' || rawStatus === 'PAID') {
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
      id: String(payload.txnId || payload.id || reference),
      type: eventType,
      provider: 'santimpay',
      reference,
      amount: Number(payload.amount || 0),
      currency: payload.currency || 'ETB',
      status,
      occurredAt: payload.paymentDate || new Date().toISOString(),
      raw: payload,
    };
  }
}

