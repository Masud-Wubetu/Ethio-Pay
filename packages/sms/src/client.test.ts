import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EthiopianSms } from './client.js';
import type { SmsProvider } from './types.js';
import { PaymentError } from '@ethio-pay/core';

describe('EthiopianSms Engine & Gateway Failover', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers SMS using primary gateway when healthy', async () => {
    const primary: SmsProvider = {
      name: 'afromessage',
      send: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'afro_101',
        provider: 'afromessage',
        raw: {},
      }),
    };

    const fallback: SmsProvider = {
      name: 'geezsms',
      send: vi.fn(),
    };

    const sms = new EthiopianSms({ providers: [primary, fallback] });
    const result = await sms.send({
      to: '0911234567',
      message: 'Hello Ethiopia!',
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('afromessage');
    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it('automatically cascades to backup gateway when primary gateway fails or drops', async () => {
    const primary: SmsProvider = {
      name: 'afromessage',
      send: vi.fn().mockRejectedValue(new Error('AfroMessage 500 Network Timeout')),
    };

    const fallback: SmsProvider = {
      name: 'geezsms',
      send: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'geez_202',
        provider: 'geezsms',
        raw: {},
      }),
    };

    const sms = new EthiopianSms({ providers: [primary, fallback] });
    const result = await sms.send({
      to: '0911234567',
      message: 'Your verification OTP is 482910',
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('geezsms');
    expect(result.messageId).toBe('geez_202');
    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).toHaveBeenCalledTimes(1);
  });

  it('throws PaymentError if all configured SMS providers fail', async () => {
    const primary: SmsProvider = {
      name: 'primary',
      send: vi.fn().mockRejectedValue(new Error('Gateway 1 down')),
    };
    const secondary: SmsProvider = {
      name: 'secondary',
      send: vi.fn().mockRejectedValue(new Error('Gateway 2 down')),
    };

    const sms = new EthiopianSms({ providers: [primary, secondary] });
    await expect(
      sms.send({ to: '0911000000', message: 'Test fail' })
    ).rejects.toThrow(PaymentError);
  });

  it('generates, dispatches, and verifies OTP in constant-time and invalidates on success', async () => {
    const mockProvider: SmsProvider = {
      name: 'geezsms',
      send: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'otp_msg_999',
        provider: 'geezsms',
        raw: {},
      }),
    };

    const sms = new EthiopianSms({ providers: [mockProvider] });
    const otpResult = await sms.sendOtp('0911223344', {
      length: 6,
      ttlSeconds: 60,
    });

    expect(otpResult.success).toBe(true);
    expect(otpResult.provider).toBe('geezsms');
    expect(mockProvider.send).toHaveBeenCalledTimes(1);

    // Extract dispatched message to inspect code
    const sentMessage = (mockProvider.send as any).mock.calls[0][0].message;
    const match = sentMessage.match(/\b\d{6}\b/);
    expect(match).not.toBeNull();
    const code = match[0];

    // Wrong code fails
    expect(sms.verifyOtp('0911223344', '000000')).toBe(false);

    // Correct code succeeds
    expect(sms.verifyOtp('0911223344', code)).toBe(true);

    // Single-use: Second attempt fails because code was consumed
    expect(sms.verifyOtp('0911223344', code)).toBe(false);
  });
});

