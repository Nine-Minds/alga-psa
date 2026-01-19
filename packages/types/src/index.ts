/**
 * @alga-psa/types
 *
 * Shared TypeScript type definitions for Alga PSA.
 * This module provides centralized type definitions for use across all modules.
 */

// Core type definitions (from shared/types)
// Note: Some types (EmailMessage, EmailProviderConfig) in lib/email.ts are for OUTBOUND email
export * from './lib/attributes';
export * from './lib/general';
export * from './lib/tax';
export * from './lib/temporal';
export * from './lib/interval-tracking';
export * from './lib/invoice-renderer/types';
export * from './lib/xeroCsvTaxImport';
export * from './lib/companySync';
export * from './lib/telemetry';
export * from './lib/tenancy';

// Outbound email types - exported with explicit naming to avoid conflicts with inbound email interfaces.
export type {
  EmailAttachment as OutboundEmailAttachment,
  EmailAddress,
  EmailMessage as OutboundEmailMessage,
  EmailProviderConfig as OutboundEmailProviderConfig,
  EmailSendResult,
  EmailProviderCapabilities,
  DomainVerificationResult,
  DnsRecord,
  DnsLookupResult,
  TenantEmailSettings,
  IEmailProvider,
  IEmailProviderManager
} from './lib/email';
export { EmailProviderError } from './lib/email';

// Legacy outbound email names for compatibility with @alga-psa/types imports
export type {
  EmailAttachment,
  EmailMessage,
  EmailProviderConfig
} from './lib/email';

export type { InboundTicketDefaults, TicketFieldOptions } from './lib/email';

// Interface definitions (migrated from server/src/interfaces and shared/interfaces).
export * from './interfaces';

// Inbound email types - exported with explicit naming to avoid conflicts with outbound email types above.
export type {
  EmailProviderConfig as InboundEmailProviderConfig,
  EmailMessage as InboundEmailMessage,
  EmailMessageDetails,
  InboundEmailEvent,
  EmailConnectionStatus,
  EmailQueueJob
} from './interfaces/email.interfaces';

// Common utility types
export type { Knex } from 'knex';

/**
 * Generic ID type for database entities
 */
export type EntityId = string;

/**
 * ISO 8601 date string
 */
export type ISODateString = string;

/**
 * Tenant identifier
 */
export type TenantId = string;

/**
 * User identifier
 */
export type UserId = string;

/**
 * Common pagination parameters
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
}

/**
 * Common pagination result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Common audit fields for entities
 */
export interface AuditFields {
  created_at: ISODateString;
  updated_at: ISODateString;
  created_by?: UserId;
  updated_by?: UserId;
}

/**
 * Tenant-scoped entity base
 */
export interface TenantScopedEntity extends AuditFields {
  tenant: TenantId;
}
