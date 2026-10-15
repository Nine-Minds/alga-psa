/**
 * Payment Provider Interfaces
 *
 * Abstract payment provider architecture supporting Stripe and future payment platforms.
 * This module defines the core interfaces for payment processing, payment links,
 * customer management, and webhook handling.
 */

import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';

// =============================================================================
// Payment Provider Capabilities
// =============================================================================

/**
 * Describes the capabilities of a payment provider implementation.
 */
export interface PaymentProviderCapabilities {
  /** Supports generating payment links that can be shared via email */
  supportsPaymentLinks: boolean;
  /** Supports hosted checkout pages (redirect to provider) */
  supportsHostedCheckout: boolean;
  /** Supports embedded checkout (iframe/components) */
  supportsEmbeddedCheckout: boolean;
  /** Supports webhook notifications for payment events */
  supportsWebhooks: boolean;
  /** List of supported currency codes (ISO 4217) */
  supportedCurrencies: string[];
  /** Supports partial payments (paying less than full amount) */
  supportsPartialPayments: boolean;
  /** Supports refund processing */
  supportsRefunds: boolean;
  /** Supports saving payment methods for future use */
  supportsSavedPaymentMethods: boolean;
}

// =============================================================================
// Payment Link Types
// =============================================================================

/**
 * Request to create a payment link for an invoice.
 */
export interface CreatePaymentLinkRequest {
  /** The invoice to create a payment link for */
  invoiceId: string;
  /** Amount to charge in cents */
  amount: number;
  /** Currency code (ISO 4217, e.g., 'USD', 'EUR') */
  currency: string;
  /** Description shown to customer during payment */
  description: string;
  /** External customer ID if customer exists in payment provider */
  customerId?: string;
  /** Client ID in AlgaPSA (for customer creation if needed) */
  clientId: string;
  billingProfileId?: string;
  /** Client email for customer creation */
  clientEmail: string;
  /** Client name for customer creation */
  clientName: string;
  /** Metadata to attach to the payment (returned in webhooks) */
  metadata: Record<string, string>;
  /** When the payment link should expire */
  expiresAt?: Date;
  /** URL to redirect to after successful payment */
  successUrl: string;
  /** URL to redirect to if payment is cancelled */
  cancelUrl?: string;
}

/**
 * Result of creating a payment link.
 */
export interface PaymentLinkResult {
  /** Internal payment link ID */
  paymentLinkId: string;
  /** External ID from the payment provider (e.g., Stripe session ID) */
  externalLinkId: string;
  /** URL for the customer to complete payment */
  url: string;
  /** When the payment link expires */
  expiresAt?: Date;
  /** Payment provider type */
  provider: string;
}

/**
 * Status of a payment link.
 *
 * `expire_pending` is an intermediate, blocking state: the row is never
 * returned or reused for checkout, but stays discoverable so a later attempt
 * retries the provider expiration before any replacement session is created.
 * It transitions to `expired` only after the provider confirms the session is
 * closed.
 */
export type PaymentLinkStatus = 'active' | 'expire_pending' | 'expired' | 'completed' | 'cancelled';

// =============================================================================
// Payment Details & Status
// =============================================================================

/**
 * Details about a completed or pending payment.
 */
export interface PaymentDetails {
  /** External payment ID from provider */
  paymentId: string;
  /** Payment status */
  status: PaymentStatus;
  /** Amount in cents */
  amount: number;
  /** Currency code */
  currency: string;
  /** When the payment was created */
  createdAt: Date;
  /** When the payment was completed (if successful) */
  completedAt?: Date;
  /** Payment method type (e.g., 'card', 'bank_transfer') */
  paymentMethodType?: string;
  /** Last 4 digits if card payment */
  cardLast4?: string;
  /** Card brand if card payment */
  cardBrand?: string;
  /** Receipt URL if available */
  receiptUrl?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Payment status values.
 */
export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Parsed webhook event from a payment provider.
 */
export interface PaymentWebhookEvent {
  /** Unique event ID from the provider */
  eventId: string;
  /** Event type (provider-specific, e.g., 'checkout.session.completed') */
  eventType: string;
  /** Payment provider type */
  provider: string;
  /** Raw event payload */
  payload: unknown;
  /** Invoice ID from metadata (if present) */
  invoiceId?: string;
  /** Amount in cents (if applicable) */
  amount?: number;
  /** Currency code (if applicable) */
  currency?: string;
  /** Payment status derived from event */
  status: PaymentStatus;
  /**
   * External Checkout Session/link ID the event refers to (when the object is
   * a Checkout Session). Always known for checkout.session.* events, unlike
   * `paymentIntentId`, which is null on open sessions under apiVersion
   * 2024-12-18.acacia.
   */
  externalLinkId?: string;
  /** External payment intent/charge ID */
  paymentIntentId?: string;
  /** External customer ID */
  customerId?: string;
  billingProfileId?: string;
  autopayAttemptId?: string;
  externalPaymentMethodId?: string;
  setupIntentId?: string;
}

/**
 * Result of processing a webhook event.
 */
export interface WebhookProcessingResult {
  /** Whether the event was processed successfully */
  success: boolean;
  /** Error message if processing failed */
  error?: string;
  /** Whether a payment was recorded */
  paymentRecorded?: boolean;
  /** The recorded payment ID if applicable */
  paymentId?: string;
  /** Invoice ID that was updated */
  invoiceId?: string;
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Information about a customer in the payment provider.
 */
export interface PaymentCustomer {
  /** External customer ID in payment provider */
  externalCustomerId: string;
  /** Customer email */
  email: string;
  /** Customer name */
  name?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Payment Provider Interface
// =============================================================================

/**
 * Abstract interface for payment providers.
 *
 * Implementations must handle:
 * - Customer creation and retrieval
 * - Payment link generation
 * - Webhook signature verification and parsing
 * - Payment status retrieval
 */
export interface PaymentProvider {
  /** Unique identifier for this payment provider type */
  readonly providerType: string;

  /**
   * Returns the capabilities of this payment provider.
   */
  capabilities(): PaymentProviderCapabilities;

  /**
   * Gets or creates a customer in the payment provider.
   *
   * @param clientId - The AlgaPSA client ID
   * @param email - Customer email address
   * @param name - Customer name
   * @returns The external customer ID
   */
  getOrCreateCustomer(clientId: string, email: string, name: string, billingProfileId?: string): Promise<string>;

  createPaymentMethodSetupSession?(request: CreatePaymentMethodSetupSessionRequest): Promise<{ externalSessionId: string; url: string }>;
  retrieveSavedPaymentMethod?(externalId: string): Promise<SavedPaymentMethodDetails>;
  detachPaymentMethod?(externalId: string): Promise<void>;
  chargeSavedPaymentMethod?(request: ChargeSavedPaymentMethodRequest): Promise<SavedPaymentMethodChargeResult>;
  retrieveAttemptPaymentIntent?(attemptId: string): Promise<unknown | null>;

  /**
   * Creates a payment link for an invoice.
   *
   * @param request - Payment link creation parameters
   * @returns The created payment link details
   */
  createPaymentLink(request: CreatePaymentLinkRequest): Promise<PaymentLinkResult>;

  /**
   * Expires an existing hosted payment link when the provider supports it.
   * Used before replacing a link whose payable amount is no longer current.
   */
  expirePaymentLink?(externalLinkId: string): Promise<void>;

  /**
   * Verifies the signature of a webhook payload.
   *
   * @param payload - Raw webhook payload as string
   * @param signature - Signature header from the webhook request
   * @returns true if signature is valid
   */
  verifyWebhookSignature(payload: string, signature: string): boolean;

  /**
   * Parses a webhook payload into a structured event.
   *
   * @param payload - Raw webhook payload as string
   * @returns Parsed webhook event
   */
  parseWebhookEvent(payload: string): PaymentWebhookEvent;

  /**
   * Retrieves details about a specific payment.
   *
   * @param paymentId - External payment ID
   * @returns Payment details
   */
  getPaymentDetails(paymentId: string): Promise<PaymentDetails>;

  /**
   * Retrieves the current status of a payment link/checkout session.
   *
   * @param externalLinkId - External payment link/session ID
   * @returns Payment status and details
   */
  getPaymentLinkStatus(externalLinkId: string): Promise<PaymentDetails | null>;
}

export interface CreatePaymentMethodSetupSessionRequest {
  clientId: string;
  billingProfileId: string;
  customerId: string;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}
export interface SavedPaymentMethodDetails {
  externalPaymentMethodId: string;
  externalCustomerId: string;
  brand: string | null;
  last4: string;
  expMonth: number;
  expYear: number;
  fingerprint: string | null;
}
export interface ChargeSavedPaymentMethodRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  invoiceId: string;
  clientId: string;
  billingProfileId: string;
  attemptId: string;
  idempotencyKey: string;
  description: string;
}
export interface SavedPaymentMethodChargeResult {
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  paymentIntentId: string;
  failureCode?: string;
  declineCode?: string;
  message?: string;
}

// =============================================================================
// Database Entity Types
// =============================================================================

/**
 * Payment provider configuration for a tenant.
 */
export interface IPaymentProviderConfig extends TenantEntity {
  config_id: string;
  provider_type: string;
  is_enabled: boolean;
  is_default: boolean;
  configuration: Record<string, unknown>;
  credentials_vault_path?: string;
  webhook_secret_vault_path?: string;
  settings?: Record<string, unknown>; // PaymentSettings stored as JSONB
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

/**
 * Mapping between a client and their payment provider customer ID.
 */
export interface IClientPaymentCustomer extends TenantEntity {
  mapping_id: string;
  client_id: string;
  billing_profile_id: string;
  provider_type: string;
  external_customer_id: string;
  email?: string;
  metadata?: Record<string, unknown>;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

/**
 * Payment link for an invoice.
 */
export interface IInvoicePaymentLink extends TenantEntity {
  link_id: string;
  invoice_id: string;
  provider_type: string;
  external_link_id: string;
  url: string;
  amount: number;
  currency: string;
  status: PaymentLinkStatus;
  expires_at?: ISO8601String;
  completed_at?: ISO8601String;
  metadata?: Record<string, unknown>;
  created_at: ISO8601String;
}

/**
 * Webhook event from a payment provider.
 */
export interface IPaymentWebhookEvent extends TenantEntity {
  event_id: string;
  provider_type: string;
  external_event_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  invoice_id?: string;
  processed: boolean;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error?: string;
  processed_at?: ISO8601String;
  created_at: ISO8601String;
}

// =============================================================================
// Service Types
// =============================================================================

/**
 * Options for the PaymentService.
 */
export interface PaymentServiceOptions {
  tenantId: string;
}

/**
 * Result of recording a payment.
 */
export interface RecordPaymentResult {
  success: boolean;
  paymentId?: string;
  invoiceStatus?: string;
  error?: string;
}

/**
 * Payment settings for a tenant.
 */
export interface PaymentSettings {
  /** Whether to include payment links in invoice emails */
  paymentLinksInEmails: boolean;
  /** Default payment provider to use */
  defaultProvider?: string;
  /** Whether to send payment confirmation emails */
  sendPaymentConfirmations: boolean;
  /** Number of hours before payment links expire (default: 168 = 7 days) */
  paymentLinkExpirationHours: number;
  autopayEnabled: boolean;
  autopayChargeTiming: 'on_finalize' | 'on_due_date';
  autopayRetryDays: number[];
  autopayConsentText: string;
  autopayConsentTextVersion: string;
}

/**
 * Default payment settings.
 */
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  paymentLinksInEmails: true,
  defaultProvider: undefined,
  sendPaymentConfirmations: true,
  paymentLinkExpirationHours: 168, // 7 days
  autopayEnabled: false,
  autopayChargeTiming: 'on_finalize',
  autopayRetryDays: [3, 5, 7],
  autopayConsentText: '',
  autopayConsentTextVersion: '1',
};

export interface IBillingProfileAutopay extends TenantEntity {
  billing_profile_id: string;
  client_id: string;
  is_enabled: boolean;
  payment_method_id: string | null;
  authorized_at: ISO8601String | null;
  authorized_by_user_id: string | null;
  authorization_source: 'client_portal' | 'msp' | null;
  authorization_ip: string | null;
  authorization_user_agent: string | null;
  consent_text_version: string | null;
  disabled_at: ISO8601String | null;
  disabled_by_user_id: string | null;
  disabled_reason: string | null;
}

export interface IInvoiceAutopayAttempt extends TenantEntity {
  attempt_id: string;
  invoice_id: string;
  billing_profile_id: string;
  payment_method_id: string;
  attempt_number: number;
  scheduled_for: ISO8601String;
  status: 'scheduled' | 'processing' | 'succeeded' | 'failed' | 'requires_action' | 'cancelled';
  amount: number;
  currency: string;
  provider_type: string;
  payment_intent_id: string | null;
  idempotency_key: string;
  failure_code: string | null;
  failure_message: string | null;
  decline_code: string | null;
  processed_at: ISO8601String | null;
}
