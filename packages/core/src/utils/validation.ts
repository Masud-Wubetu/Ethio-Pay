import { PaymentError, PaymentErrorCode } from '../types/errors.js';
import type { InitRequest } from '../types/models.js';

export const SUPPORTED_CURRENCIES = ['ETB', 'USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export interface ValidationOptions {
  allowedCurrencies?: readonly string[] | string[];
  providerName?: string;
}

/**
 * Validates initialization request fields before making any remote network call.
 * Throws PaymentError with code VALIDATION_ERROR if invalid.
 */
export function validateInitRequest(
  req: InitRequest,
  options: ValidationOptions = {}
): void {
  const provider = options.providerName || req.provider || 'core';
  const allowedCurrencies: readonly string[] =
    options.allowedCurrencies || SUPPORTED_CURRENCIES;

  if (!req.reference || typeof req.reference !== 'string' || req.reference.trim() === '') {
    throw new PaymentError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: 'Payment reference must be a non-empty string',
      provider,
    });
  }

  if (typeof req.amount !== 'number' || Number.isNaN(req.amount) || req.amount <= 0) {
    throw new PaymentError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: 'Payment amount must be a positive number greater than 0',
      provider,
    });
  }

  if (
    !req.currency ||
    typeof req.currency !== 'string' ||
    !allowedCurrencies.includes(req.currency.toUpperCase())
  ) {
    throw new PaymentError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: `Invalid currency '${req.currency}'. Supported currencies: ${allowedCurrencies.join(', ')}`,
      provider,
    });
  }

  if (req.customer?.phoneNumber) {
    const cleanPhone = req.customer.phoneNumber.replace(/[\s\-()]/g, '');
    const ethPhoneRegex = /^(\+?251|0)(9|7)\d{8}$/;
    if (!ethPhoneRegex.test(cleanPhone)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: `Invalid Ethiopian phone number format '${req.customer.phoneNumber}'. Expected format: +2519... or 09.../07...`,
        provider,
      });
    }
  }

  if (req.customer?.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(req.customer.email)) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: `Invalid customer email address '${req.customer.email}'`,
        provider,
      });
    }
  }
}
