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
  CbeBirrConfig,
  CbeBirrInitResponse,
  CbeBirrQueryResponse,
} from './types.js';

export const DEFAULT_CBEBIRR_BASE_URL = 'https://api.cbebirr.et:8443';

/**
 * Commercial Bank of Ethiopia (CBE Birr) Payment Provider Adapter.
 */
export class CbeBirrAdapter implements PaymentProvider {
  public readonly name = 'cbebirr';
  private config: CbeBirrConfig;
  private httpClient: HttpClient;

  constructor(config: CbeBirrConfig) {
    if (!config?.tillCode || !config?.apiKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'CBE Birr tillCode and apiKey are required',
        provider: 'cbebirr',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_CBEBIRR_BASE_URL,
      timeoutMs: config.timeout ?? 15000,
      maxRetries: config.maxRetries ?? 3,
    });
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.reference || req.reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'cbebirr',
      });
    }

    if (typeof req.amount !== 'number' || req.amount <= 0 || Number.isNaN(req.amount)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment amount must be a positive number',
        provider: 'cbebirr',
      });
    }

    const payload = {
      tillCode: this.config.tillCode,
      shortCode: this.config.shortCode,
      reference: req.reference,
      amount: req.amount,
      currency: (req.currency || 'ETB').toUpperCase(),
      customerPhone: req.customer?.phoneNumber,
      customerName: req.customer?.name,
      returnUrl: req.returnUrl,
      callbackUrl: req.callbackUrl,
      remarks: req.description || `CBE Birr payment for ${req.reference}`,
    };

    try {
      const response = await this.httpClient.request<CbeBirrInitResponse>(
        '/cbe/payment/v1/checkout',
        {
          method: 'POST',
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const checkoutUrl =
        response.data.checkoutUrl ||
        response.data.paymentUrl ||
        `${this.config.baseUrl || DEFAULT_CBEBIRR_BASE_URL}/checkout/${encodeURIComponent(req.reference)}`;

      return {
        id: req.reference,
        provider: 'cbebirr',
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
        message: (err as Error).message || 'CBE Birr payment initialization failed',
        provider: 'cbebirr',
        raw: err,
      });
    }
  }

  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Transaction reference is required for verification',
        provider: 'cbebirr',
      });
    }

    try {
      const response = await this.httpClient.request<CbeBirrQueryResponse>(
        `/cbe/payment/v1/query/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': this.config.apiKey,
          },
        }
      );

      const raw = response.data;
      const rawStatus = (raw.transactionStatus || raw.status || '').toUpperCase();

      let status: Status = Status.PENDING;
      if (rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || rawStatus === 'PAID') {
        status = Status.SUCCEEDED;
      } else if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') {
        status = Status.FAILED;
      } else if (rawStatus === 'EXPIRED') {
        status = Status.EXPIRED;
      }

      return {
        id: String(raw.transactionId || reference),
        provider: 'cbebirr',
        reference: String(raw.orderId || reference),
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
        message: (err as Error).message || 'CBE Birr query order failed',
        provider: 'cbebirr',
        raw: err,
      });
    }
  }

  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Raw body is required for CBE Birr webhook verification',
        provider: 'cbebirr',
      });
    }

    const secretKey = this.config.secretHash || this.config.apiKey;
    let signatureHeader: string | undefined;

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-cbebirr-signature' || lower === 'cbebirr-signature') {
        signatureHeader = Array.isArray(value) ? value[0] : value;
        break;
      }
    }

    if (!signatureHeader) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing CBE Birr webhook signature header (x-cbebirr-signature)',
        provider: 'cbebirr',
      });
    }

    const expectedHash = createHmac('sha256', secretKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expectedHash, 'utf-8');
    const actualBuffer = Buffer.from(signatureHeader, 'utf-8');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Invalid CBE Birr webhook signature',
        provider: 'cbebirr',
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
        message: 'Failed to parse CBE Birr webhook body as JSON',
        provider: 'cbebirr',
        raw: err,
      });
    }

    const reference = payload.reference || payload.orderId || payload.billReference;
    if (!reference) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Missing reference in CBE Birr webhook payload',
        provider: 'cbebirr',
        raw: payload,
      });
    }

    const rawStatus = String(payload.status || payload.transactionStatus || '').toUpperCase();
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
      id: String(payload.cbeTransactionId || payload.transactionId || reference),
      type: eventType,
      provider: 'cbebirr',
      reference,
      amount: Number(payload.amount || 0),
      currency: payload.currency || 'ETB',
      status,
      occurredAt: payload.timestamp || new Date().toISOString(),
      raw: payload,
    };
  }
}

