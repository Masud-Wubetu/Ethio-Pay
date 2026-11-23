import { HttpClient, PaymentError, PaymentErrorCode } from '@ethio-pay/core';
import type { SmsProvider, SendSmsRequest, SendSmsResult } from '../types.js';

export interface AfroMessageConfig {
  token: string;
  senderId?: string;
  identifierId?: string;
  baseUrl?: string;
  timeout?: number;
}

export const DEFAULT_AFROMESSAGE_BASE_URL = 'https://api.afromessage.com';

/**
 * AfroMessage SMS Gateway Adapter for Ethiopia.
 */
export class AfroMessageAdapter implements SmsProvider {
  public readonly name = 'afromessage';
  private config: AfroMessageConfig;
  private httpClient: HttpClient;

  constructor(config: AfroMessageConfig) {
    if (!config?.token) {
      throw new PaymentError({
        code: PaymentErrorCode.INVALID_CREDENTIALS,
        message: 'AfroMessage token is required',
        provider: 'afromessage',
      });
    }

    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || DEFAULT_AFROMESSAGE_BASE_URL,
      timeoutMs: config.timeout ?? 10000,
    });
  }

  public async send(req: SendSmsRequest): Promise<SendSmsResult> {
    const payload = {
      to: req.to,
      message: req.message,
      sender: req.senderId || this.config.senderId,
      from: this.config.identifierId,
    };

    const res = await this.httpClient.request<any>('/api/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const isSuccess = res.data?.acknowledge === 'success' || res.data?.status === 'success';
    if (!isSuccess && res.status >= 400) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: res.data?.response?.message || 'AfroMessage dispatch failed',
        provider: 'afromessage',
        raw: res.data,
      });
    }

    return {
      success: true,
      messageId: res.data?.response?.id || `afro_${Date.now()}`,
      provider: 'afromessage',
      raw: res.data,
    };
  }
}

