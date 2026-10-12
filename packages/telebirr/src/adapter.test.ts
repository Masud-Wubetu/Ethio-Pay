import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Status, PaymentError, PaymentErrorCode } from '@ethio-pay/core';
import { TelebirrAdapter } from './adapter.js';
import {
  createCanonicalString,
  signWithPrivateKey,
  encryptWithPublicKey,
} from './crypto.js';

describe('TelebirrAdapter', () => {
  // Generate ephemeral RSA keypair for testing
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const validConfig = {
    appId: 'FABRIC_APP_123',
    appKey: 'FABRIC_KEY_ABC',
    shortCode: '100200',
    publicKey,
    privateKey,
    baseUrl: 'https://test-telebirr.local',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor Validation', () => {
    it('instantiates successfully with valid config', () => {
      const adapter = new TelebirrAdapter(validConfig);
      expect(adapter.name).toBe('telebirr');
      expect(adapter.getConfig().appId).toBe('FABRIC_APP_123');
      expect((adapter.getConfig() as Record<string, unknown>).privateKey).toBeUndefined();
    });

    it('throws when appId is missing', () => {
      expect(() => new TelebirrAdapter({ ...validConfig, appId: '' })).toThrowError(
        /appId is required/
      );
    });

    it('throws when privateKey is missing', () => {
      expect(() => new TelebirrAdapter({ ...validConfig, privateKey: '' })).toThrowError(
        /privateKey is required/
      );
    });

    it('throws when publicKey is missing', () => {
      expect(() => new TelebirrAdapter({ ...validConfig, publicKey: '' })).toThrowError(
        /publicKey is required/
      );
    });

    it('throws when shortCode is missing', () => {
      expect(() => new TelebirrAdapter({ ...validConfig, shortCode: '' })).toThrowError(
        /shortCode is required/
      );
    });
  });

  describe('initialize()', () => {
    const adapter = new TelebirrAdapter(validConfig);

    it('throws when reference is empty', async () => {
      await expect(
        adapter.initialize({
          provider: 'telebirr',
          amount: 100,
          currency: 'ETB',
          reference: '',
        })
      ).rejects.toThrowError(/reference is required/);
    });

    it('throws when amount is negative or zero', async () => {
      await expect(
        adapter.initialize({
          provider: 'telebirr',
          amount: -50,
          currency: 'ETB',
          reference: 'TX-1',
        })
      ).rejects.toThrowError(/amount must be a positive number/);
    });

    it('throws when currency is not ETB', async () => {
      await expect(
        adapter.initialize({
          provider: 'telebirr',
          amount: 50,
          currency: 'USD',
          reference: 'TX-1',
        })
      ).rejects.toThrowError(/only supports ETB/);
    });

    it('successfully initializes checkout session and normalizes response', async () => {
      const mockResponse = {
        code: 200,
        msg: 'success',
        data: {
          toPayUrl: 'https://h5.ethiomobilemoney.et/trade-pay?session=SESS-9988',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
      } as unknown as Response);

      const session = await adapter.initialize({
        provider: 'telebirr',
        amount: 350.5,
        currency: 'ETB',
        reference: 'TX-TELEBIRR-001',
        customer: { name: 'Abebe Bikila', phoneNumber: '0911223344' },
        returnUrl: 'https://store.et/success',
        callbackUrl: 'https://store.et/webhooks/telebirr',
      });

      expect(session).toEqual({
        id: 'TX-TELEBIRR-001',
        provider: 'telebirr',
        reference: 'TX-TELEBIRR-001',
        checkoutUrl: 'https://h5.ethiomobilemoney.et/trade-pay?session=SESS-9988',
        status: Status.PENDING,
        amount: 350.5,
        currency: 'ETB',
        raw: mockResponse,
      });
    });

    it('handles Telebirr API error response codes', async () => {
      const mockErrorResponse = {
        code: 4001,
        msg: 'Merchant account is suspended',
        data: null,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockErrorResponse,
        text: async () => JSON.stringify(mockErrorResponse),
      } as unknown as Response);

      await expect(
        adapter.initialize({
          provider: 'telebirr',
          amount: 100,
          currency: 'ETB',
          reference: 'TX-FAIL-1',
        })
      ).rejects.toThrowError(/Merchant account is suspended/);
    });

    it('throws when response data is missing checkout url', async () => {
      const mockEmptyResponse = {
        code: 200,
        msg: 'success',
        data: {},
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockEmptyResponse,
        text: async () => JSON.stringify(mockEmptyResponse),
      } as unknown as Response);

      await expect(
        adapter.initialize({
          provider: 'telebirr',
          amount: 100,
          currency: 'ETB',
          reference: 'TX-NOURL-1',
        })
      ).rejects.toThrowError(/missing checkout URL/);
    });
  });

  describe('verify()', () => {
    const adapter = new TelebirrAdapter(validConfig);

    it('throws when reference is empty', async () => {
      await expect(adapter.verify('')).rejects.toThrowError(/reference is required/);
    });

    it('successfully queries and normalizes successful transaction status', async () => {
      const mockStatusResponse = {
        code: 200,
        msg: 'success',
        data: {
          outTradeNo: 'TX-REF-100',
          tradeNo: 'TB-ORDER-999',
          tradeStatus: 'SUCCESS',
          totalAmount: '450.00',
          transactionTime: '2026-10-12 18:30:00',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStatusResponse,
        text: async () => JSON.stringify(mockStatusResponse),
      } as unknown as Response);

      const status = await adapter.verify('TX-REF-100');

      expect(status).toEqual({
        id: 'TB-ORDER-999',
        provider: 'telebirr',
        reference: 'TX-REF-100',
        status: Status.SUCCEEDED,
        amount: 450,
        currency: 'ETB',
        raw: mockStatusResponse,
      });
    });

    it('normalizes failed status to Status.FAILED', async () => {
      const mockStatusResponse = {
        code: 200,
        msg: 'success',
        data: {
          outTradeNo: 'TX-REF-101',
          tradeNo: 'TB-ORDER-1000',
          tradeStatus: 'CLOSED',
          totalAmount: '120.00',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStatusResponse,
        text: async () => JSON.stringify(mockStatusResponse),
      } as unknown as Response);

      const status = await adapter.verify('TX-REF-101');
      expect(status.status).toBe(Status.FAILED);
    });

    it('normalizes expired status to Status.EXPIRED', async () => {
      const mockStatusResponse = {
        code: 200,
        msg: 'success',
        data: {
          outTradeNo: 'TX-REF-102',
          tradeStatus: 'EXPIRED',
          totalAmount: 100,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStatusResponse,
        text: async () => JSON.stringify(mockStatusResponse),
      } as unknown as Response);

      const status = await adapter.verify('TX-REF-102');
      expect(status.status).toBe(Status.EXPIRED);
    });

    it('throws when status inquiry API returns error code', async () => {
      const mockErrorResponse = {
        code: 4004,
        msg: 'Order not found',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockErrorResponse,
        text: async () => JSON.stringify(mockErrorResponse),
      } as unknown as Response);

      await expect(adapter.verify('TX-INVALID')).rejects.toThrowError(/Order not found/);
    });
  });

  describe('verifyWebhook()', () => {
    const adapter = new TelebirrAdapter(validConfig);

    it('verifies valid signature on plain JSON webhook body', () => {
      const notification = {
        outTradeNo: 'TX-WEBHOOK-01',
        totalAmount: '500.00',
        tradeStatus: 'SUCCESS',
        tradeNo: 'TB-WH-1234',
      };

      const canonical = createCanonicalString(notification);
      // Sign with the configured privateKey (simulating Telebirr server whose public key we hold)
      const signature = signWithPrivateKey(canonical, privateKey);

      const rawBody = JSON.stringify({
        ...notification,
        sign: signature,
      });

      expect(() => adapter.verifyWebhook(rawBody, {})).not.toThrow();
    });

    it('verifies valid signature passed in headers', () => {
      const notification = {
        outTradeNo: 'TX-WEBHOOK-02',
        totalAmount: '200.00',
        tradeStatus: 'SUCCESS',
      };

      const canonical = createCanonicalString(notification);
      const signature = signWithPrivateKey(canonical, privateKey);
      const rawBody = JSON.stringify(notification);

      expect(() =>
        adapter.verifyWebhook(rawBody, {
          'x-telebirr-signature': signature,
        })
      ).not.toThrow();
    });

    it('throws INVALID_SIGNATURE when signature is tampered with', () => {
      const rawBody = JSON.stringify({
        outTradeNo: 'TX-TAMPERED',
        totalAmount: '100.00',
        tradeStatus: 'SUCCESS',
        sign: 'fake-invalid-signature',
      });

      expect(() => adapter.verifyWebhook(rawBody, {})).toThrowError(
        /Invalid Telebirr webhook signature/
      );
    });

    it('throws INVALID_SIGNATURE when signature is missing', () => {
      const rawBody = JSON.stringify({
        outTradeNo: 'TX-NOSIG',
        totalAmount: '100.00',
        tradeStatus: 'SUCCESS',
      });

      expect(() => adapter.verifyWebhook(rawBody, {})).toThrowError(
        /Missing Telebirr webhook signature/
      );
    });

    it('verifies valid encrypted response format', () => {
      const encryptedBlock = encryptWithPublicKey(
        JSON.stringify({ outTradeNo: 'TX-ENC', tradeStatus: 'SUCCESS' }),
        publicKey
      );

      const signature = signWithPrivateKey(encryptedBlock, privateKey);
      const rawBody = JSON.stringify({
        response: encryptedBlock,
        sign: signature,
      });

      expect(() => adapter.verifyWebhook(rawBody, {})).not.toThrow();
    });
  });

  describe('parseWebhook()', () => {
    const adapter = new TelebirrAdapter(validConfig);

    it('parses plain JSON webhook event successfully', () => {
      const rawBody = JSON.stringify({
        outTradeNo: 'TX-PARSE-01',
        totalAmount: 320,
        tradeStatus: 'SUCCESS',
        tradeNo: 'TRADE-999',
        tradeDate: '2026-10-12T15:00:00.000Z',
      });

      const event = adapter.parseWebhook(rawBody);

      expect(event).toEqual({
        id: 'TRADE-999',
        type: 'payment.succeeded',
        provider: 'telebirr',
        reference: 'TX-PARSE-01',
        amount: 320,
        currency: 'ETB',
        status: Status.SUCCEEDED,
        occurredAt: '2026-10-12T15:00:00.000Z',
        raw: JSON.parse(rawBody),
      });
    });

    it('parses encrypted response block using merchant private key', () => {
      const innerData = {
        outTradeNo: 'TX-PARSE-ENC',
        totalAmount: '600.00',
        tradeStatus: 'SUCCESS',
        tradeNo: 'TB-ENC-777',
      };

      const encrypted = encryptWithPublicKey(JSON.stringify(innerData), publicKey);
      const rawBody = JSON.stringify({
        response: encrypted,
      });

      const event = adapter.parseWebhook(rawBody);

      expect(event.id).toBe('TB-ENC-777');
      expect(event.reference).toBe('TX-PARSE-ENC');
      expect(event.amount).toBe(600);
      expect(event.type).toBe('payment.succeeded');
      expect(event.status).toBe(Status.SUCCEEDED);
    });

    it('maps failed and expired trade statuses accurately', () => {
      const failedBody = JSON.stringify({
        outTradeNo: 'TX-FAILED',
        tradeStatus: 'CLOSED',
        totalAmount: 100,
      });
      const failedEvent = adapter.parseWebhook(failedBody);
      expect(failedEvent.type).toBe('payment.failed');
      expect(failedEvent.status).toBe(Status.FAILED);

      const expiredBody = JSON.stringify({
        outTradeNo: 'TX-EXPIRED',
        tradeStatus: 'EXPIRED',
        totalAmount: 100,
      });
      const expiredEvent = adapter.parseWebhook(expiredBody);
      expect(expiredEvent.type).toBe('payment.expired');
      expect(expiredEvent.status).toBe(Status.EXPIRED);
    });

    it('throws VALIDATION_ERROR when reference is missing', () => {
      const rawBody = JSON.stringify({
        tradeStatus: 'SUCCESS',
      });
      expect(() => adapter.parseWebhook(rawBody)).toThrowError(
        /Missing transaction reference/
      );
    });
  });
});
