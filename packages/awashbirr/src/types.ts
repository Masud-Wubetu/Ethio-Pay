export interface AwashBirrConfig {
  merchantId: string;
  passKey: string;
  secretHash?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface AwashBirrInitResponse {
  statusCode: string | number;
  message?: string;
  checkoutUrl?: string;
  paymentUrl?: string;
  transactionRef?: string;
}

export interface AwashBirrQueryResponse {
  statusCode: string | number;
  message?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  transactionId?: string;
  reference?: string;
}

