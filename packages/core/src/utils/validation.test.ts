import { describe, it, expect } from 'vitest';
import { validateInitRequest } from './validation.js';
import { PaymentError } from '../types/errors.js';

describe('validateInitRequest', () => {
  const validRequest = {
    provider: 'chapa',
    amount: 100,
    currency: 'ETB',
    reference: 'TX-12345',
    customer: {
      name: 'Abebe Bikila',
      email: 'abebe@example.com',
      phoneNumber: '0911234567',
    },
  };

  it('passes validation for a valid request', () => {
    expect(() => validateInitRequest(validRequest)).not.toThrow();
  });

  it('fails if reference is missing or empty', () => {
    expect(() =>
      validateInitRequest({ ...validRequest, reference: '' })
    ).toThrowError(PaymentError);
  });

  it('fails if amount is zero or negative', () => {
    expect(() =>
      validateInitRequest({ ...validRequest, amount: 0 })
    ).toThrowError('Payment amount must be a positive number greater than 0');

    expect(() =>
      validateInitRequest({ ...validRequest, amount: -50 })
    ).toThrowError('Payment amount must be a positive number greater than 0');
  });

  it('fails if currency is unsupported', () => {
    expect(() =>
      validateInitRequest({ ...validRequest, currency: 'EUR' })
    ).toThrowError("Invalid currency 'EUR'");
  });

  it('validates Ethiopian phone number formats correctly', () => {
    expect(() =>
      validateInitRequest({
        ...validRequest,
        customer: { phoneNumber: '+251911234567' },
      })
    ).not.toThrow();

    expect(() =>
      validateInitRequest({
        ...validRequest,
        customer: { phoneNumber: '0712345678' },
      })
    ).not.toThrow();

    expect(() =>
      validateInitRequest({
        ...validRequest,
        customer: { phoneNumber: '12345' },
      })
    ).toThrowError('Invalid Ethiopian phone number format');
  });
});
