export interface ArifPayConfig {
  apiKey: string;
  secretKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface ArifPaySessionResponse {
  data?: {
    sessionId?: string;
    paymentUrl?: string;
    checkoutUrl?: string;
    totalAmount?: number;
  };
  msg?: string;
  error?: boolean;
}

export interface ArifPayStatusResponse {
  data?: {
    sessionId?: string;
    status?: string;
    totalAmount?: number;
    transactionStatus?: string;
    orderId?: string;
  };
  error?: boolean;
}

