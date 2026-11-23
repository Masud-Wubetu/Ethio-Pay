export interface CbeBirrConfig {
  tillCode: string;
  initiatorIdentifier?: string;
  securityCredential?: string;
  shortCode?: string;
  apiKey: string;
  secretHash?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface CbeBirrInitResponse {
  code: string | number;
  message?: string;
  checkoutUrl?: string;
  paymentUrl?: string;
  conversationId?: string;
  transactionReference?: string;
}

export interface CbeBirrQueryResponse {
  code: string | number;
  message?: string;
  status?: string;
  transactionStatus?: string;
  amount?: number | string;
  currency?: string;
  transactionId?: string;
  orderId?: string;
  timestamp?: string;
}

