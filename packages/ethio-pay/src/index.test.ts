import { describe, it, expect } from 'vitest';
import {
  EthiopianPayments,
  ChapaAdapter,
  PaymentError,
  createIdempotencyMiddleware,
  ETHIO_PAY_VERSION,
  SDK_VERSION,
  CHAPA_ADAPTER_VERSION,
} from './index.js';

describe('ethio-pay umbrella package', () => {
  it('exports core client, adapters, and version identifiers', () => {
    expect(ETHIO_PAY_VERSION).toBe('0.1.0');
    expect(SDK_VERSION).toBe('0.1.0');
    expect(CHAPA_ADAPTER_VERSION).toBe('0.1.0');
    expect(typeof EthiopianPayments).toBe('function');
    expect(typeof ChapaAdapter).toBe('function');
    expect(typeof createIdempotencyMiddleware).toBe('function');
  });

  it('allows initializing SDK with ChapaAdapter from umbrella package', () => {
    const chapa = new ChapaAdapter({
      secretKey: 'CHASECK_TEST-1234567890',
      secretHash: 'test-hash-secret',
    });

    const sdk = new EthiopianPayments({
      providers: [chapa],
    });

    expect(sdk.getProvider('chapa')).toBe(chapa);
    expect(sdk.getProvider('chapa').name).toBe('chapa');
  });

  it('handles errors cleanly via re-exported PaymentError', () => {
    const err = new PaymentError({
      code: 'PROVIDER_ERROR',
      message: 'Something went wrong',
      provider: 'core',
      httpStatus: 400,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.message).toBe('Something went wrong');
    expect(err.httpStatus).toBe(400);
  });
});
