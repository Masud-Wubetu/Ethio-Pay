// Re-export core contracts, client, utilities, and errors
export * from '@ethio-pay/core';

// Re-export official Ethiopian payment provider adapters
export * from '@ethio-pay/chapa';
export * from '@ethio-pay/telebirr';
export * from '@ethio-pay/santimpay';
export * from '@ethio-pay/cbebirr';
export * from '@ethio-pay/arifpay';
export * from '@ethio-pay/awashbirr';

// Re-export unified Ethiopian SMS & OTP engine
export * from '@ethio-pay/sms';

export const ETHIO_PAY_VERSION = '0.1.0';
