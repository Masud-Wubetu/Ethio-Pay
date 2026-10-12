import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  formatPublicKey,
  formatPrivateKey,
  createCanonicalString,
  signWithPrivateKey,
  verifyWithPublicKey,
  encryptWithPublicKey,
  decryptWithPrivateKey,
} from './crypto.js';

describe('Telebirr Crypto Utilities', () => {
  // Generate a test 2048-bit RSA keypair for testing
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  describe('formatPublicKey & formatPrivateKey', () => {
    it('preserves keys that already have PEM headers', () => {
      expect(formatPublicKey(publicKey)).toBe(publicKey.trim());
      expect(formatPrivateKey(privateKey)).toBe(privateKey.trim());
    });

    it('wraps raw base64 key strings with appropriate PEM headers', () => {
      const rawPublic = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\s+/g, '');

      const formatted = formatPublicKey(rawPublic);
      expect(formatted).toContain('-----BEGIN PUBLIC KEY-----');
      expect(formatted).toContain('-----END PUBLIC KEY-----');

      const rawPrivate = privateKey
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '');

      const formattedPrivate = formatPrivateKey(rawPrivate);
      expect(formattedPrivate).toContain('-----BEGIN PRIVATE KEY-----');
      expect(formattedPrivate).toContain('-----END PRIVATE KEY-----');
    });
  });

  describe('createCanonicalString', () => {
    it('sorts keys alphabetically by ASCII order and joins with &', () => {
      const params = {
        title: 'Order-1',
        amount: 150,
        appId: '12345',
      };
      const canonical = createCanonicalString(params);
      expect(canonical).toBe('amount=150&appId=12345&title=Order-1');
    });

    it('filters out the sign field and empty/null/undefined values', () => {
      const params = {
        sign: 'SHOULD_BE_IGNORED',
        name: 'Abebe',
        empty: '',
        none: null,
        missing: undefined,
        amount: 200,
      };
      const canonical = createCanonicalString(params);
      expect(canonical).toBe('amount=200&name=Abebe');
    });
  });

  describe('signWithPrivateKey & verifyWithPublicKey', () => {
    it('successfully signs and verifies data with RSA SHA256', () => {
      const data = 'amount=250&appId=12345&outTradeNo=TX-9988';
      const signature = signWithPrivateKey(data, privateKey);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(50);

      const isValid = verifyWithPublicKey(data, signature, publicKey);
      expect(isValid).toBe(true);
    });

    it('rejects tampered data', () => {
      const data = 'amount=250&appId=12345';
      const signature = signWithPrivateKey(data, privateKey);

      const isValid = verifyWithPublicKey('amount=999999&appId=12345', signature, publicKey);
      expect(isValid).toBe(false);
    });

    it('rejects tampered signature', () => {
      const data = 'amount=250&appId=12345';
      const isValid = verifyWithPublicKey(data, 'invalid-signature-data', publicKey);
      expect(isValid).toBe(false);
    });
  });

  describe('encryptWithPublicKey & decryptWithPrivateKey', () => {
    it('encrypts and decrypts short payload successfully', () => {
      const plaintext = 'Secret credential text: Telebirr-2026';
      const ciphertext = encryptWithPublicKey(plaintext, publicKey);

      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = decryptWithPrivateKey(ciphertext, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts large payloads exceeding single RSA block size', () => {
      const largePayload = JSON.stringify({
        appId: 'FABRIC-APP-12345',
        outTradeNo: 'TX-LARGE-1234567890',
        subject: 'E-Commerce Cart Checkout with long product titles and customer instructions',
        customer: {
          name: 'Abebe Bikila Gebremeskel',
          email: 'abebe.bikila.long.email.address@example.com',
          phone: '+251911223344',
          shippingAddress: 'Bole Subcity, Woreda 03, House 124, Addis Ababa, Ethiopia',
        },
        metadata: {
          items: [
            { id: 1, name: 'Traditional Ethiopian Coffee Pot (Jebena)', price: 450 },
            { id: 2, name: 'Handmade Netela Scarf', price: 800 },
          ],
        },
      });

      const encrypted = encryptWithPublicKey(largePayload, publicKey);
      const decrypted = decryptWithPrivateKey(encrypted, privateKey);

      expect(decrypted).toBe(largePayload);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(largePayload));
    });
  });
});
