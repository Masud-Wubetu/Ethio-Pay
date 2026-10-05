import type { Status } from './status.js';

export interface CustomerInfo {
  name?: string;
  email?: string;
  phoneNumber?: string;
}

export interface InitRequest {
  provider: string;
  amount: number;
  currency: string;
  reference: string;
  customer?: CustomerInfo;
  returnUrl?: string;
  callbackUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSession {
  id: string;
  provider: string;
  reference: string;
  checkoutUrl: string;
  status: Status;
  amount: number;
  currency: string;
  raw: unknown;
}

export interface PaymentStatus {
  id?: string;
  provider: string;
  reference: string;
  status: Status;
  amount: number;
  currency: string;
  raw: unknown;
}

export type PaymentEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.expired'
  | 'payment.refunded';

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  provider: string;
  reference: string;
  amount: number;
  currency: string;
  status: Status;
  occurredAt: string;
  raw: unknown;
}

export interface RefundRequest {
  provider: string;
  reference: string;
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  provider: string;
  reference: string;
  refundId: string;
  status: Status;
  raw: unknown;
}
