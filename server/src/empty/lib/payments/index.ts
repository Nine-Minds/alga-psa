/**
 * Empty Payment Provider Module for Community Edition
 *
 * Payment provider functionality is only available in the Enterprise Edition.
 */

// Core interfaces (re-exported from server interfaces)
export type {
  PaymentProvider,
  PaymentProviderCapabilities,
  CreatePaymentLinkRequest,
  PaymentLinkResult,
  PaymentWebhookEvent,
  WebhookProcessingResult,
  PaymentDetails,
  PaymentStatus,
  PaymentLinkStatus,
  PaymentCustomer,
  PaymentSettings,
  RecordPaymentResult,
  IPaymentProviderConfig,
  IClientPaymentCustomer,
  IInvoicePaymentLink,
  IPaymentWebhookEvent,
} from '@/interfaces/payment.interfaces';

export { DEFAULT_PAYMENT_SETTINGS } from '@/interfaces/payment.interfaces';

// Registry stub
export const PAYMENT_PROVIDER_TYPES = {
  STRIPE: 'stripe',
} as const;

export type PaymentProviderType = typeof PAYMENT_PROVIDER_TYPES[keyof typeof PAYMENT_PROVIDER_TYPES];

export class PaymentProviderRegistry {
  static getAvailableProviders(): string[] {
    return [];
  }

  static isProviderAvailable(_providerType: string): boolean {
    return false;
  }
}

// Stripe provider stub
export class StripePaymentProvider {
  constructor(_tenantId: string) {}

  parseWebhookEvent(_rawBody: string): any {
    return null;
  }

  async createPaymentLink(): Promise<any> {
    return {
      success: false,
      error: 'Payment provider is only available in Enterprise Edition',
    };
  }
}

export function createStripePaymentProvider(tenantId: string): StripePaymentProvider {
  return new StripePaymentProvider(tenantId);
}

// Payment service stub
export class PaymentService {
  private tenantId: string;

  private constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  static async create(tenantId: string): Promise<PaymentService> {
    return new PaymentService(tenantId);
  }

  async isPaymentProviderConfigured(): Promise<boolean> {
    return false;
  }

  async getPaymentSettings(): Promise<any> {
    return null;
  }

  async createPaymentLink(): Promise<any> {
    return {
      success: false,
      error: 'Payment provider is only available in Enterprise Edition',
    };
  }

  async processWebhookEvent(): Promise<any> {
    return {
      success: false,
      error: 'Payment provider is only available in Enterprise Edition',
    };
  }
}
