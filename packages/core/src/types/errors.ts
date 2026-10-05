/**
 * Normalized error codes for all payment SDK operations.
 */
export type PaymentErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INSUFFICIENT_FUNDS'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_SIGNATURE'
  | 'DUPLICATE_REFERENCE'
  | 'PROVIDER_ERROR'
  | 'VALIDATION_ERROR';

export const PaymentErrorCode = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  DUPLICATE_REFERENCE: 'DUPLICATE_REFERENCE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export interface PaymentErrorOptions {
  code: PaymentErrorCode;
  message: string;
  provider: string;
  httpStatus?: number;
  raw?: unknown;
}

/**
 * Custom error thrown by Ethio-Pay SDK whenever a payment error occurs.
 */
export class PaymentError extends Error {
  public readonly code: PaymentErrorCode;
  public readonly provider: string;
  public readonly httpStatus?: number;
  public readonly raw?: unknown;

  constructor(options: PaymentErrorOptions) {
    super(options.message);
    this.name = 'PaymentError';
    this.code = options.code;
    this.provider = options.provider;
    this.httpStatus = options.httpStatus;
    this.raw = options.raw;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
