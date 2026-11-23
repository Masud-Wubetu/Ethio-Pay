import { HttpClient, PaymentError, PaymentErrorCode } from '@ethio-pay/core';
import type { SmsProvider, SendSmsRequest, SendSmsResult } from '../types.js';

export interface EthioTelecomSmsConfig {
  username: string;
  password: string;
  senderId?: string;
  baseUrl?: string;
  timeout?: number;
}

export const DEFAULT_ETHIO_TELECOM_SMS_BASE_URL = 'https://bulksms.ethiotelecom.et:8443';

/**
 * Ethio Telecom Direct Bulk SMS Gateway Adapter.
 */
export class EthioTelecomSmsAdapter implements SmsProvider {
  public readonly name = 'ethiotelecom';
  private config: EthioTelecomSmsConfig;
  private httpClient: HttpClient;

  constructor(config: EthioTelecomSmsConfig) {
    if (!config?.username || !config?.password) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'Ethio Telecom username and password are required',
        provider: 'ethiotelecom',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_ETHIO_TELECOM_SMS_BASE_URL,
      timeoutMs: config.timeout ?? 10000,
    });
  }

  public async send(req: SendSmsRequest): Promise<SendSmsResult> {
    const payload = {
      username: this.config.username,
      password: this.config.password,
      msisdn: req.to,
      message: req.message,
      sender: req.senderId || this.config.senderId,
    };

    const res = await this.httpClient.request<any>('/api/v1/sms/single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const isSuccess = res.data?.statusCode === '0' || res.data?.status === 'SUCCESS' || res.status === 200;
    if (!isSuccess && res.status >= 400) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: res.data?.statusMessage || 'Ethio Telecom SMS dispatch failed',
        provider: 'ethiotelecom',
        raw: res.data,
      });
    }

    return {
      success: true,
      messageId: String(res.data?.messageId || `ethiotel_${Date.now()}`),
      provider: 'ethiotelecom',
      raw: res.data,
    };
  }
}

