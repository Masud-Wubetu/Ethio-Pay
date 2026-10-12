import crypto from 'node:crypto';
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
import {
  type TelebirrConfig,
  type TelebirrFabricInitParams,
  type TelebirrInitPayload,
  type TelebirrInitResponse,
  type TelebirrQueryStatusResponse,
} from './types.js';
import {
  createCanonicalString,
  signWithPrivateKey,
  verifyWithPublicKey,
  encryptWithPublicKey,
  decryptWithPrivateKey,
} from './crypto.js';

export const DEFAULT_TELEBIRR_BASE_URL = 'https://app.ethiomobilemoney.et:2121';
export const TELEBIRR_WEB_PAY_PATH = '/ammapi/payment/service-openup/toTradeWebPay';
export const TELEBIRR_QUERY_ORDER_PATH = '/ammapi/payment/service-openup/queryOrder';

/**
 * Telebirr Payment Provider Adapter implementation for Ethio-Pay.
 */
export class TelebirrAdapter implements PaymentProvider {
  public readonly name = 'telebirr';
  private config: TelebirrConfig;
  private httpClient: HttpClient;

  constructor(config: TelebirrConfig) {
    this.validateConfig(config);
    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_TELEBIRR_BASE_URL,
      timeoutMs: config.timeout ?? 15000,
      maxRetries: config.maxRetries ?? 3,
    });
  }

  /**
   * Returns current Telebirr configuration (without exposing private key).
   */
  public getConfig(): Omit<TelebirrConfig, 'privateKey'> {
    const { privateKey: _privateKey, ...safeConfig } = this.config;
    return safeConfig;
  }

  /**
   * Initializes a payment checkout session with Telebirr Fabric H5 gateway.
   */
  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.reference || req.reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'telebirr',
      });
    }

    if (typeof req.amount !== 'number' || req.amount <= 0 || Number.isNaN(req.amount)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment amount must be a positive number',
        provider: 'telebirr',
      });
    }

    const currency = (req.currency || 'ETB').toUpperCase();
    if (currency !== 'ETB') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: `Telebirr only supports ETB currency, received: ${currency}`,
        provider: 'telebirr',
      });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = String(Date.now());
    const totalAmount = req.amount.toFixed(2);

    const fabricParams: TelebirrFabricInitParams = {
      appId: this.config.appId,
      appkey: this.config.appKey,
      nonce,
      notifyUrl: req.callbackUrl || '',
      outTradeNo: req.reference,
      receiveName: req.customer?.name || 'Customer',
      returnUrl: req.returnUrl || '',
      shortCode: this.config.shortCode,
      subject: req.description || `Payment ${req.reference}`,
      timeoutExpress: '30',
      totalAmount,
      timestamp,
    };

    // 1. Generate canonical string from Fabric parameters
    const canonical = createCanonicalString(
      fabricParams as unknown as Record<string, unknown>
    );

    // 2. Sign canonical string using merchant RSA private key
    const sign = signWithPrivateKey(canonical, this.config.privateKey);

    // 3. Encrypt fabric parameters using Telebirr RSA public key
    const ussd = encryptWithPublicKey(
      JSON.stringify(fabricParams),
      this.config.publicKey
    );

    const payload: TelebirrInitPayload = {
      appid: this.config.appId,
      sign,
      ussd,
    };

    let responseData: TelebirrInitResponse;

    try {
      const response = await this.httpClient.request<TelebirrInitResponse>(
        TELEBIRR_WEB_PAY_PATH,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      responseData = response.data;
    } catch (error: unknown) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: error instanceof Error ? error.message : 'Failed to connect to Telebirr API',
        provider: 'telebirr',
        raw: error,
      });
    }

    // Telebirr indicates success via code 200 or 0
    const code = Number(responseData.code);
    if (code !== 200 && code !== 0) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: responseData.msg || `Telebirr initialization failed with code: ${responseData.code}`,
        provider: 'telebirr',
        raw: responseData,
      });
    }

    let checkoutUrl: string | undefined;
    if (typeof responseData.data === 'string') {
      checkoutUrl = responseData.data;
    } else if (responseData.data && typeof responseData.data === 'object') {
      checkoutUrl = responseData.data.toPayUrl || responseData.data.payUrl;
    }

    if (!checkoutUrl) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: 'Telebirr response missing checkout URL (toPayUrl)',
        provider: 'telebirr',
        raw: responseData,
      });
    }

    return {
      id: req.reference,
      provider: 'telebirr',
      reference: req.reference,
      checkoutUrl,
      status: Status.PENDING,
      amount: req.amount,
      currency,
      raw: responseData,
    };
  }

  /**
   * Queries payment status from Telebirr by merchant transaction reference.
   */
  public async verify(reference: string): Promise<PaymentStatus> {
    if (!reference || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference is required',
        provider: 'telebirr',
      });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = String(Date.now());

    const params = {
      appId: this.config.appId,
      appkey: this.config.appKey,
      nonce,
      outTradeNo: reference,
      shortCode: this.config.shortCode,
      timestamp,
    };

    const canonical = createCanonicalString(params);
    const sign = signWithPrivateKey(canonical, this.config.privateKey);
    const ussd = encryptWithPublicKey(JSON.stringify(params), this.config.publicKey);

    const payload = {
      appid: this.config.appId,
      sign,
      ussd,
    };

    let responseData: TelebirrQueryStatusResponse;
    try {
      const response = await this.httpClient.request<TelebirrQueryStatusResponse>(
        TELEBIRR_QUERY_ORDER_PATH,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      responseData = response.data;
    } catch (error: unknown) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: error instanceof Error ? error.message : 'Failed to query Telebirr transaction status',
        provider: 'telebirr',
        raw: error,
      });
    }

    const code = Number(responseData.code);
    if (code !== 200 && code !== 0) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: responseData.msg || `Telebirr status query failed with code: ${responseData.code}`,
        provider: 'telebirr',
        raw: responseData,
      });
    }

    const data = responseData.data || {};
    const rawStatus = (data.tradeStatus || '').toUpperCase();
    let status: Status = Status.PENDING;

    if (rawStatus === 'SUCCESS' || rawStatus === 'TRADE_SUCCESS' || rawStatus === 'COMPLETED') {
      status = Status.SUCCEEDED;
    } else if (rawStatus === 'FAILED' || rawStatus === 'TRADE_CLOSED' || rawStatus === 'CLOSED') {
      status = Status.FAILED;
    } else if (rawStatus === 'EXPIRED') {
      status = Status.EXPIRED;
    }

    const amount = Number(data.totalAmount || 0);

    return {
      id: data.tradeNo || reference,
      provider: 'telebirr',
      reference,
      status,
      amount,
      currency: 'ETB',
      raw: responseData,
    };
  }

  /**
   * Verifies incoming Telebirr webhook request signatures against Telebirr's public key.
   */
  public verifyWebhook(rawBody: string, headers: WebhookHeaders): void {
    if (!rawBody || typeof rawBody !== 'string' || rawBody.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Webhook raw body must be a non-empty string',
        provider: 'telebirr',
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON webhook payload received from Telebirr',
        provider: 'telebirr',
      });
    }

    // Determine signature from body or headers
    const signature =
      (payload.sign as string) ||
      (headers['x-telebirr-signature'] as string) ||
      (headers['signature'] as string);

    if (!signature) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Missing Telebirr webhook signature',
        provider: 'telebirr',
      });
    }

    // Format A: payload has 'response' field (encrypted string)
    if (typeof payload.response === 'string') {
      const isValid = verifyWithPublicKey(payload.response, signature, this.config.publicKey);
      if (!isValid) {
        throw new PaymentError({
          code: PaymentErrorCode.INVALID_SIGNATURE,
          message: 'Invalid Telebirr encrypted webhook signature',
          provider: 'telebirr',
        });
      }
      return;
    }

    // Format B: payload fields are plain JSON
    const canonical = createCanonicalString(payload);
    const isValid = verifyWithPublicKey(canonical, signature, this.config.publicKey);

    if (!isValid) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_SIGNATURE,
        message: 'Invalid Telebirr webhook signature',
        provider: 'telebirr',
      });
    }
  }

  /**
   * Parses raw webhook body into a normalized PaymentEvent.
   */
  public parseWebhook(rawBody: string, _headers?: WebhookHeaders): PaymentEvent {
    if (!rawBody || typeof rawBody !== 'string') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Webhook raw body must be a non-empty string',
        provider: 'telebirr',
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON webhook payload received from Telebirr',
        provider: 'telebirr',
      });
    }

    // If payload contains encrypted response, decrypt it
    if (typeof payload.response === 'string') {
      try {
        const decryptedJson = decryptWithPrivateKey(payload.response, this.config.privateKey);
        payload = JSON.parse(decryptedJson);
      } catch (err: unknown) {
        throw new PaymentError({
          code: PaymentErrorCode.PROVIDER_ERROR,
          message: 'Failed to decrypt Telebirr webhook response block',
          provider: 'telebirr',
          raw: err,
        });
      }
    }

    const reference = String(payload.outTradeNo || payload.reference || '');
    if (!reference) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Missing transaction reference in Telebirr webhook payload',
        provider: 'telebirr',
        raw: payload,
      });
    }

    const rawStatus = String(payload.tradeStatus || payload.status || '').toUpperCase();
    let status: Status = Status.PENDING;
    let eventType: PaymentEventType = 'payment.succeeded';

    if (rawStatus === 'SUCCESS' || rawStatus === 'TRADE_SUCCESS' || rawStatus === 'COMPLETED') {
      status = Status.SUCCEEDED;
      eventType = 'payment.succeeded';
    } else if (rawStatus === 'EXPIRED') {
      status = Status.EXPIRED;
      eventType = 'payment.expired';
    } else {
      status = Status.FAILED;
      eventType = 'payment.failed';
    }

    const amount = Number(payload.totalAmount || payload.amount || 0);
    const tradeNo = String(payload.tradeNo || payload.transactionNo || reference);
    const occurredAt = String(payload.tradeDate || new Date().toISOString());

    return {
      id: tradeNo,
      type: eventType,
      provider: 'telebirr',
      reference,
      amount,
      currency: 'ETB',
      status,
      occurredAt,
      raw: payload,
    };
  }

  private validateConfig(config: TelebirrConfig): void {
    if (!config) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr configuration is required',
        provider: 'telebirr',
      });
    }
    if (!config.appId) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr appId is required',
        provider: 'telebirr',
      });
    }
    if (!config.appKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr appKey is required',
        provider: 'telebirr',
      });
    }
    if (!config.shortCode) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr shortCode is required',
        provider: 'telebirr',
      });
    }
    if (!config.publicKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr publicKey is required',
        provider: 'telebirr',
      });
    }
    if (!config.privateKey) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Telebirr privateKey is required',
        provider: 'telebirr',
      });
    }
  }
}
