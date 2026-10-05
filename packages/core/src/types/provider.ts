import type {
  InitRequest,
  PaymentSession,
  PaymentStatus,
  PaymentEvent,
  RefundRequest,
  RefundResult,
} from './models.js';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * Core contract interface that every payment provider adapter must implement.
 */
export interface PaymentProvider {
  /**
   * Unique lowercase name of the provider adapter (e.g. 'chapa', 'telebirr', 'cbebirr', 'sandbox')
   */
  readonly name: string;

  /**
   * Initializes a payment checkout session with the provider.
   */
  initialize(req: InitRequest): Promise<PaymentSession>;

  /**
   * Queries payment status from the provider by merchant reference.
   */
  verify(reference: string): Promise<PaymentStatus>;

  /**
   * Verifies incoming webhook request signatures.
   * Throws PaymentError with code INVALID_SIGNATURE if verification fails.
   */
  verifyWebhook(rawBody: string, headers: WebhookHeaders): void;

  /**
   * Parses raw webhook body into a normalized PaymentEvent.
   */
  parseWebhook(rawBody: string, headers?: WebhookHeaders): PaymentEvent;

  /**
   * Optional: Processes a payment refund if supported by the provider.
   */
  refund?(req: RefundRequest): Promise<RefundResult>;
}
