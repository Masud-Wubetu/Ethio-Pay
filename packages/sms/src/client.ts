import crypto from 'node:crypto';
import { PaymentError, PaymentErrorCode } from '@ethio-pay/core';
import type {
  SmsProvider,
  EthiopianSmsOptions,
  SendSmsRequest,
  SendSmsResult,
  SendOtpOptions,
  SendOtpResult,
} from './types.js';

interface OtpRecord {
  code: string;
  expiresAt: number;
}

/**
 * Resilient Ethiopian SMS & OTP engine with automatic multi-gateway cascading.
 * Supports AfroMessage, GeeZ SMS, and Ethio Telecom.
 */
export class EthiopianSms {
  private providers: SmsProvider[];
  private defaultSenderId?: string;
  private otpStore = new Map<string, OtpRecord>();

  constructor(options: EthiopianSmsOptions) {
    if (!options?.providers || options.providers.length === 0) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'EthiopianSms requires at least one configured SmsProvider',
        provider: 'sms',
      });
    }

    this.providers = options.providers;
    this.defaultSenderId = options.defaultSenderId;
  }

  /**
   * Dispatches SMS message with automated cascading failover across configured gateways.
   */
  public async send(req: SendSmsRequest): Promise<SendSmsResult> {
    if (!req.to || req.to.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Recipient phone number (to) is required',
        provider: 'sms',
      });
    }

    if (!req.message || req.message.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'SMS message text is required',
        provider: 'sms',
      });
    }

    const payload: SendSmsRequest = {
      to: req.to.trim(),
      message: req.message,
      senderId: req.senderId || this.defaultSenderId,
      templateId: req.templateId,
    };

    let lastError: any;

    for (const provider of this.providers) {
      try {
        const result = await provider.send(payload);
        return result;
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[Ethio-Pay SMS Cascade] Gateway '${provider.name}' failed to deliver SMS: ${err.message}. Trying next provider...`
        );
      }
    }

    throw new PaymentError({
      code: PaymentErrorCode.PROVIDER_ERROR,
      message: `All configured SMS gateways failed. Last error: ${lastError?.message}`,
      provider: 'sms',
      raw: lastError,
    });
  }

  /**
   * Generates a cryptographically secure numeric OTP and dispatches it via resilient SMS.
   */
  public async sendOtp(phone: string, options: SendOtpOptions = {}): Promise<SendOtpResult> {
    const length = options.length ?? 6;
    const ttlSeconds = options.ttlSeconds ?? 300; // 5 minutes default
    const template = options.template ?? 'Your verification code is {code}. Valid for 5 minutes.';

    // Generate cryptographically secure numeric code
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    const otpCode = String(crypto.randomInt(min, max + 1));

    const message = template.replace('{code}', otpCode);
    const expiresAt = Date.now() + ttlSeconds * 1000;

    // Dispatch via cascading failover
    const smsResult = await this.send({
      to: phone,
      message,
      senderId: options.senderId,
    });

    // Save to memory store
    this.otpStore.set(phone.trim(), {
      code: otpCode,
      expiresAt,
    });

    return {
      success: true,
      phone: phone.trim(),
      provider: smsResult.provider,
      messageId: smsResult.messageId,
      expiresAt,
    };
  }

  /**
   * Constant-time OTP verification. Invalidates code on success.
   */
  public verifyOtp(phone: string, code: string): boolean {
    const cleanPhone = phone.trim();
    const cleanCode = code.trim();

    const record = this.otpStore.get(cleanPhone);
    if (!record) {
      return false;
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanPhone);
      return false;
    }

    const expectedBuffer = Buffer.from(record.code, 'utf-8');
    const actualBuffer = Buffer.from(cleanCode, 'utf-8');

    if (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      // Invalidate code upon successful verification (single-use)
      this.otpStore.delete(cleanPhone);
      return true;
    }

    return false;
  }
}

