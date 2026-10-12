import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  EthiopianPayments,
  ChapaAdapter,
  TelebirrAdapter,
  PaymentError,
  createIdempotencyMiddleware,
  ETHIO_PAY_VERSION,
  SDK_VERSION,
  CHAPA_ADAPTER_VERSION,
  TELEBIRR_ADAPTER_VERSION,
} from './index.js';

describe('ethio-pay umbrella package', () => {
  // Ephemeral test keys for Telebirr
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('exports core client, adapters, and version identifiers', () => {
    expect(ETHIO_PAY_VERSION).toBe('0.1.0');
    expect(SDK_VERSION).toBe('0.1.0');
    expect(CHAPA_ADAPTER_VERSION).toBe('0.1.0');
    expect(TELEBIRR_ADAPTER_VERSION).toBe('0.1.0');
    expect(typeof EthiopianPayments).toBe('function');
    expect(typeof ChapaAdapter).toBe('function');
    expect(typeof TelebirrAdapter).toBe('function');
    expect(typeof createIdempotencyMiddleware).toBe('function');
  });

  it('allows initializing SDK with multiple providers (Chapa + Telebirr)', () => {
    const chapa = new ChapaAdapter({
      secretKey: 'CHASECK_TEST-1234567890',
      secretHash: 'test-hash-secret',
    });

    const telebirr = new TelebirrAdapter({
      appId: 'FABRIC_APP_001',
      appKey: 'FABRIC_KEY_001',
      shortCode: '100200',
      publicKey,
      privateKey,
    });

    const sdk = new EthiopianPayments({
      providers: [chapa, telebirr],
    });

    expect(sdk.getProvider('chapa')).toBe(chapa);
    expect(sdk.getProvider('telebirr')).toBe(telebirr);
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
