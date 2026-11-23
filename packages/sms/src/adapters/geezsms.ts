import { HttpClient, PaymentError, PaymentErrorCode } from '@ethio-pay/core';
import type { SmsProvider, SendSmsRequest, SendSmsResult } from '../types.js';

export interface GeezSmsConfig {
  token: string;
  shortCode?: string;
  baseUrl?: string;
  timeout?: number;
}

export const DEFAULT_GEEZSMS_BASE_URL = 'https://api.geezsms.com';

/**
 * GeeZ SMS Gateway Adapter for Ethiopia.
 */
export class GeezSmsAdapter implements SmsProvider {
  public readonly name = 'geezsms';
  private config: GeezSmsConfig;
  private httpClient: HttpClient;

  constructor(config: GeezSmsConfig) {
    if (!config?.token) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'GeeZ SMS token is required',
        provider: 'geezsms',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_GEEZSMS_BASE_URL,
      timeoutMs: config.timeout ?? 10000,
    });
  }

  public async send(req: SendSmsRequest): Promise<SendSmsResult> {
    const payload = {
      token: this.config.token,
      phone: req.to,
      msg: req.message,
      shortcode: req.senderId || this.config.shortCode,
    };

    const res = await this.httpClient.request<any>('/api/v1/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const isSuccess = res.data?.status === 'success' || res.data?.code === 200;
    if (!isSuccess && res.status >= 400) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: res.data?.message || 'GeeZ SMS dispatch failed',
        provider: 'geezsms',
        raw: res.data,
      });
    }

    return {
      success: true,
      messageId: String(res.data?.msg_id || `geez_${Date.now()}`),
      provider: 'geezsms',
      raw: res.data,
    };
  }
}

