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

export interface ChapaAdapterOptions {
  secretKey: string;
  secretHash?: string;
  baseUrl?: string;
}

/**
 * Chapa Payment Provider Adapter.
 */
export class ChapaAdapter implements PaymentProvider {
  public readonly name = 'chapa';
  private secretKey: string;
  private secretHash?: string;
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(options: ChapaAdapterOptions) {
    if (!options.secretKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Chapa secretKey is required',
        provider: 'chapa',
      });
    }

    this.secretKey = options.secretKey;
    this.secretHash = options.secretHash;
    this.baseUrl = options.baseUrl || 'https://api.chapa.co';
    this.httpClient = new HttpClient({ baseUrl: this.baseUrl });
  }

  public getSecretHash(): string | undefined {
    return this.secretHash;
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    const names = (req.customer?.name || '').trim().split(' ');
    const firstName = names[0] || 'Customer';
    const lastName = names.slice(1).join(' ') || 'User';

    const payload = {
      amount: String(req.amount),
      currency: req.currency.toUpperCase(),
      email: req.customer?.email || `customer-${req.reference}@example.com`,
      first_name: firstName,
      last_name: lastName,
      phone_number: req.customer?.phoneNumber,
      tx_ref: req.reference,
      callback_url: req.callbackUrl,
      return_url: req.returnUrl,
      customization: req.description
        ? { title: req.description, description: req.description }
        : undefined,
      meta: req.metadata,
    };

    try {
      const response = await this.httpClient.request<{
        status: string;
        message: string;
        data?: { checkout_url?: string };
      }>('/v1/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.data.status !== 'success' || !response.data.data?.checkout_url) {
        throw new PaymentError({
          code: PaymentErrorCode.PROVIDER_ERROR,
          message: response.data.message || 'Failed to initialize Chapa transaction',
          provider: 'chapa',
          httpStatus: response.status,
          raw: response.data,
        });
      }

      return {
        id: req.reference,
        provider: 'chapa',
        reference: req.reference,
        checkoutUrl: response.data.data.checkout_url,
        status: Status.PENDING,
        amount: req.amount,
        currency: req.currency,
        raw: response.data,
      };
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        throw err;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: (err as Error).message || 'Chapa initialization failed',
        provider: 'chapa',
        raw: err,
      });
    }
  }

  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || typeof reference !== 'string' || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Transaction reference is required for verification',
        provider: 'chapa',
      });
    }

    try {
      const response = await this.httpClient.request<{
        status: string;
        message: string;
        data?: {
          status?: string;
          amount?: number | string;
          currency?: string;
          tx_ref?: string;
          reference?: string;
        };
      }>(`/v1/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      const rawData = response.data.data;
      const rawStatus = (rawData?.status || response.data.status || '').toLowerCase();

      let status: Status = Status.PENDING;
      if (rawStatus === 'success' || rawStatus === 'succeeded') {
        status = Status.SUCCEEDED;
      } else if (rawStatus === 'failed') {
        status = Status.FAILED;
      } else if (rawStatus === 'expired') {
        status = Status.EXPIRED;
      }

      return {
        id: rawData?.reference || reference,
        provider: 'chapa',
        reference: rawData?.tx_ref || reference,
        status,
        amount: rawData?.amount ? Number(rawData.amount) : 0,
        currency: rawData?.currency || 'ETB',
        raw: response.data,
      };
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        throw err;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: (err as Error).message || 'Chapa verification failed',
        provider: 'chapa',
        raw: err,
      });
    }
  }

  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Raw body is required for webhook signature verification',
        provider: 'chapa',
      });
    }

    const keyToUse = this.secretHash || this.secretKey;
    if (!keyToUse) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Chapa secretHash or secretKey is required to verify webhooks',
        provider: 'chapa',
      });
    }

    let signatureHeader: string | undefined;
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-chapa-signature' || lower === 'chapa-signature') {
        signatureHeader = Array.isArray(value) ? value[0] : value;
        break;
      }
    }

    if (!signatureHeader) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing webhook signature header (x-chapa-signature)',
        provider: 'chapa',
      });
    }

    const computedHash = createHmac('sha256', keyToUse).update(rawBody).digest('hex');

    const expectedBuffer = Buffer.from(computedHash, 'utf-8');
    const actualBuffer = Buffer.from(signatureHeader, 'utf-8');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Invalid webhook signature',
        provider: 'chapa',
      });
    }
  }

  public parseWebhook(rawBody: string, _headers?: WebhookHeaders): PaymentEvent {
    let payload: any;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON payload in webhook body',
        provider: 'chapa',
      });
    }

    const txRef = payload.tx_ref || payload.reference || payload.data?.tx_ref;
    const rawStatus = (payload.status || payload.data?.status || 'success').toLowerCase();

    let status: Status = Status.PENDING;
    let type: PaymentEventType = 'payment.succeeded';

    if (rawStatus === 'success' || rawStatus === 'succeeded') {
      status = Status.SUCCEEDED;
      type = 'payment.succeeded';
    } else if (rawStatus === 'failed') {
      status = Status.FAILED;
      type = 'payment.failed';
    } else if (rawStatus === 'expired') {
      status = Status.EXPIRED;
      type = 'payment.expired';
    } else if (rawStatus === 'refunded') {
      status = Status.REFUNDED;
      type = 'payment.refunded';
    }

    return {
      id: payload.reference || payload.id || txRef || 'unknown',
      type,
      provider: 'chapa',
      reference: txRef || 'unknown',
      amount: payload.amount
        ? Number(payload.amount)
        : payload.data?.amount
        ? Number(payload.data.amount)
        : 0,
      currency: payload.currency || payload.data?.currency || 'ETB',
      status,
      occurredAt: payload.created_at || new Date().toISOString(),
      raw: payload,
    };
  }
}
