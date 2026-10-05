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

  public verifyWebhook(_rawBody: string, _headers: WebhookHeaders): void {
    throw new Error('Not implemented yet');
  }

  public parseWebhook(_rawBody: string, _headers?: WebhookHeaders): PaymentEvent {
    throw new Error('Not implemented yet');
  }
}
