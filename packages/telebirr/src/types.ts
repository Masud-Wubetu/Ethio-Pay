/**
 * Configuration options required to instantiate the TelebirrAdapter.
 */
export interface TelebirrConfig {
  /**
   * Application ID assigned by Telebirr / Ethio Telecom Fabric platform.
   */
  appId: string;

  /**
   * Application Key / Secret assigned by Telebirr.
   */
  appKey: string;

  /**
   * Merchant Short Code identifier registered with Telebirr.
   */
  shortCode: string;

  /**
   * Telebirr's RSA Public Key (used to verify incoming webhook signatures and response signatures).
   * Can be provided as standard PEM or raw Base64 string.
   */
  publicKey: string;

  /**
   * Merchant's RSA Private Key (used to digitally sign request payloads sent to Telebirr).
   * Can be provided as standard PEM or raw Base64 string.
   */
  privateKey: string;

  /**
   * Base API endpoint URL for Telebirr Fabric gateway.
   * Default: 'https://app.ethiomobilemoney.et:2121'
   */
  baseUrl?: string;

  /**
   * HTTP request timeout in milliseconds. Default: 15000 (15 seconds).
   */
  timeout?: number;

  /**
   * Maximum retry attempts on network or 5xx failures. Default: 3.
   */
  maxRetries?: number;
}

/**
 * Native Telebirr Fabric parameters for checkout initialization.
 */
export interface TelebirrFabricInitParams {
  appId: string;
  appkey: string;
  nonce: string;
  notifyUrl: string;
  outTradeNo: string;
  receiveName: string;
  returnUrl: string;
  shortCode: string;
  subject: string;
  timeoutExpress: string;
  totalAmount: string;
  timestamp: string;
}

/**
 * Envelope payload sent to Telebirr H5 checkout endpoint.
 */
export interface TelebirrInitPayload {
  appid: string;
  sign: string;
  ussd: string;
}

/**
 * Telebirr server response when initiating a checkout session.
 */
export interface TelebirrInitResponse {
  code: number | string;
  msg?: string;
  data?: {
    toPayUrl?: string;
    payUrl?: string;
  } | string;
}

/**
 * Telebirr server response when querying transaction status.
 */
export interface TelebirrQueryStatusResponse {
  code: number | string;
  msg?: string;
  data?: {
    outTradeNo?: string;
    tradeNo?: string;
    tradeStatus?: string; // 'SUCCESS', 'FAILED', 'PAYING', 'EXPIRED'
    totalAmount?: string | number;
    transactionTime?: string;
    payerName?: string;
  };
}

/**
 * Normalized Telebirr notification payload received in webhooks.
 */
export interface TelebirrNotificationPayload {
  msisdn?: string;
  outTradeNo: string;
  totalAmount: string | number;
  tradeDate?: string;
  tradeNo?: string;
  tradeStatus: string;
  sign?: string;
  [key: string]: unknown;
}
