import { PaymentError, PaymentErrorCode } from './types/errors.js';
import type { PaymentProvider, WebhookHeaders } from './types/provider.js';
import type {
  InitRequest,
  PaymentSession,
  PaymentStatus,
  PaymentEvent,
  RefundRequest,
  RefundResult,
} from './types/models.js';
import { validateInitRequest, type ValidationOptions } from './utils/validation.js';

export type Environment = 'sandbox' | 'production';

export interface EthiopianPaymentsOptions {
  environment?: Environment;
  providers?: PaymentProvider[];
  defaultFallbackProviders?: string[];
  validationOptions?: ValidationOptions;
}

/**
 * Main client manager routing payment initialization, verification, and webhooks to registered provider adapters.
 */
export class EthiopianPayments {
  private providers = new Map<string, PaymentProvider>();
  private environment: Environment;
  private defaultFallbackProviders: string[];
  private validationOptions: ValidationOptions;

  constructor(options: EthiopianPaymentsOptions = {}) {
    this.environment = options.environment || 'production';
    this.defaultFallbackProviders = options.defaultFallbackProviders || [];
    this.validationOptions = options.validationOptions || {};

    if (options.providers) {
      for (const provider of options.providers) {
        this.registerProvider(provider);
      }
    }
  }

  public getEnvironment(): Environment {
    return this.environment;
  }

  public registerProvider(provider: PaymentProvider): this {
    if (!provider || !provider.name) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Provider must be an object implementing PaymentProvider with a valid name',
        provider: 'core',
      });
    }
    this.providers.set(provider.name.toLowerCase(), provider);
    return this;
  }

  public getProvider(name: string): PaymentProvider {
    const key = name.toLowerCase();
    const provider = this.providers.get(key);
    if (!provider) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: `Payment provider '${name}' is not registered. Registered providers: ${
          Array.from(this.providers.keys()).join(', ') || 'none'
        }`,
        provider: name,
      });
    }
    return provider;
  }

  public async initialize(req: InitRequest): Promise<PaymentSession> {
    if (!req.provider) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Request must specify a provider name',
        provider: 'core',
      });
    }

    const candidateProviders = [
      req.provider,
      ...(req.fallbackProviders || this.defaultFallbackProviders || []),
    ];

    let lastError: any;

    for (const providerName of candidateProviders) {
      try {
        const provider = this.getProvider(providerName);
        validateInitRequest(
          { ...req, provider: providerName },
          {
            providerName: provider.name,
            ...this.validationOptions,
          }
        );

        return await provider.initialize({ ...req, provider: providerName });
      } catch (err: any) {
        lastError = err;
        // If it's a validation error caused by core request params (e.g. non-positive amount), fail immediately
        if (err?.code === PaymentErrorCode.VALIDATION_ERROR && err.provider === 'core') {
          throw err;
        }
        // If there are more candidate providers, continue to next fallback
        continue;
      }
    }

    throw lastError;
  }

  public async verify(providerName: string, reference: string): Promise<PaymentStatus> {
    if (!reference || typeof reference !== 'string' || reference.trim() === '') {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Payment reference must be a non-empty string',
        provider: providerName,
      });
    }

    const provider = this.getProvider(providerName);
    return provider.verify(reference);
  }

  public webhooks = {
    verify: (providerName: string, rawBody: string, headers: WebhookHeaders): void => {
      const provider = this.getProvider(providerName);
      provider.verifyWebhook(rawBody, headers);
    },

    parse: (providerName: string, rawBody: string, headers?: WebhookHeaders): PaymentEvent => {
      const provider = this.getProvider(providerName);
      return provider.parseWebhook(rawBody, headers);
    },
  };

  public async refund(req: RefundRequest): Promise<RefundResult> {
    if (!req.provider) {
      throw new PaymentError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: 'Refund request must specify a provider name',
        provider: 'core',
      });
    }

    const provider = this.getProvider(req.provider);
    if (!provider.refund) {
      throw new PaymentError({
        code: PaymentErrorCode.PROVIDER_ERROR,
        message: `Provider '${provider.name}' does not support refunds`,
        provider: provider.name,
      });
    }

    return provider.refund(req);
  }
}
