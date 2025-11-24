/**
 * Payment Provider Module
 *
 * Exports all payment-related functionality for the Alga PSA system.
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
} from 'server/src/interfaces/payment.interfaces';

export { DEFAULT_PAYMENT_SETTINGS } from 'server/src/interfaces/payment.interfaces';

// Registry
export { PaymentProviderRegistry, PAYMENT_PROVIDER_TYPES } from './PaymentProviderRegistry';
export type { PaymentProviderType } from './PaymentProviderRegistry';

// Providers
export { StripePaymentProvider, createStripePaymentProvider } from './StripePaymentProvider';

// Service
export { PaymentService } from './PaymentService';
