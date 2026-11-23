import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  EthiopianPayments,
  ChapaAdapter,
  TelebirrAdapter,
  SantimPayAdapter,
  CbeBirrAdapter,
  ArifPayAdapter,
  AwashBirrAdapter,
  EthiopianSms,
  AfroMessageAdapter,
  GeezSmsAdapter,
  EthioTelecomSmsAdapter,
  PaymentError,
  createIdempotencyMiddleware,
  ETHIO_PAY_VERSION,
  SDK_VERSION,
  CHAPA_ADAPTER_VERSION,
  TELEBIRR_ADAPTER_VERSION,
  SANTIMPAY_ADAPTER_VERSION,
  CBEBIRR_ADAPTER_VERSION,
  ARIFPAY_ADAPTER_VERSION,
  AWASHBIRR_ADAPTER_VERSION,
} from './index.js';

describe('ethio-pay umbrella package', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('exports core client, all official adapters, and version identifiers', () => {
    expect(ETHIO_PAY_VERSION).toBe('0.1.0');
    expect(SDK_VERSION).toBe('0.1.0');
    expect(CHAPA_ADAPTER_VERSION).toBe('0.1.0');
    expect(TELEBIRR_ADAPTER_VERSION).toBe('0.1.0');
    expect(SANTIMPAY_ADAPTER_VERSION).toBe('0.1.0');
    expect(CBEBIRR_ADAPTER_VERSION).toBe('0.1.0');
    expect(ARIFPAY_ADAPTER_VERSION).toBe('0.1.0');
    expect(AWASHBIRR_ADAPTER_VERSION).toBe('0.1.0');

    expect(typeof EthiopianPayments).toBe('function');
    expect(typeof ChapaAdapter).toBe('function');
    expect(typeof TelebirrAdapter).toBe('function');
    expect(typeof SantimPayAdapter).toBe('function');
    expect(typeof CbeBirrAdapter).toBe('function');
    expect(typeof ArifPayAdapter).toBe('function');
    expect(typeof AwashBirrAdapter).toBe('function');
    expect(typeof EthiopianSms).toBe('function');
    expect(typeof AfroMessageAdapter).toBe('function');
    expect(typeof GeezSmsAdapter).toBe('function');
    expect(typeof EthioTelecomSmsAdapter).toBe('function');
    expect(typeof createIdempotencyMiddleware).toBe('function');
  });

  it('allows initializing SDK with all Ethiopian payment providers simultaneously', () => {
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

    const santimpay = new SantimPayAdapter({
      merchantId: 'M-SAN-01',
      authToken: 'SAN_AUTH_1',
    });

    const cbebirr = new CbeBirrAdapter({
      tillCode: 'TILL-CBE-1',
      apiKey: 'CBE_KEY_1',
    });

    const arifpay = new ArifPayAdapter({
      apiKey: 'ARIF_KEY_1',
    });

    const awashbirr = new AwashBirrAdapter({
      merchantId: 'AWASH-M-1',
      passKey: 'AWASH_PASS_1',
    });

    const sdk = new EthiopianPayments({
      providers: [chapa, telebirr, santimpay, cbebirr, arifpay, awashbirr],
    });

    expect(sdk.getProvider('chapa')).toBe(chapa);
    expect(sdk.getProvider('telebirr')).toBe(telebirr);
    expect(sdk.getProvider('santimpay')).toBe(santimpay);
    expect(sdk.getProvider('cbebirr')).toBe(cbebirr);
    expect(sdk.getProvider('arifpay')).toBe(arifpay);
    expect(sdk.getProvider('awashbirr')).toBe(awashbirr);
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
