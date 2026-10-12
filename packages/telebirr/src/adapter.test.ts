import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Status, PaymentError } from '@ethio-pay/core';
import { TelebirrAdapter } from './adapter.js';

describe('TelebirrAdapter - Initialize', () => {
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

  describe('initialize() Validation', () => {
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
  });

  describe('initialize() Execution', () => {
    it('successfully initializes checkout session and normalizes response', async () => {
      const adapter = new TelebirrAdapter(validConfig);

      // Mock fetch
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
      const adapter = new TelebirrAdapter(validConfig);

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
      const adapter = new TelebirrAdapter(validConfig);

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
});
