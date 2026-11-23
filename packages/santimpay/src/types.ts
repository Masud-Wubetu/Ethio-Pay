export interface SantimPayConfig {
  merchantId: string;
  authToken: string;
  clientSecret?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface SantimPayInitPayload {
  id: string;
  amount: number;
  paymentReason?: string;
  phoneNumber?: string;
  merchantId: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  notifyUrl?: string;
}

export interface SantimPayInitResponse {
  status: string;
  message?: string;
  paymentUrl?: string;
  url?: string;
}

export interface SantimPayStatusResponse {
  status: string;
  paymentStatus?: string;
  transactionStatus?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  id?: string;
  paymentDate?: string;
}

