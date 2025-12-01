/**
 * Email provider types and interfaces for the outbound email abstraction system
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string; // Content-ID for inline attachments
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>; // For provider-specific tagging
  replyTo?: EmailAddress;
}

export interface EmailProviderConfig {
  providerId: string;
  providerType: 'smtp' | 'resend' | 'ses' | 'sendgrid' | 'microsoft' | 'google';
  isEnabled: boolean;
  config: Record<string, any>; // Provider-specific configuration
  rateLimits?: {
    perSecond?: number;
    perMinute?: number;
    perHour?: number;
    perDay?: number;
  };
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  providerId: string;
  providerType: string;
  error?: string;
  metadata?: Record<string, any>;
  sentAt: Date;
}

export interface EmailProviderCapabilities {
  supportsHtml: boolean;
  supportsAttachments: boolean;
  supportsTemplating: boolean;
  supportsBulkSending: boolean;
  supportsTracking: boolean;
  supportsCustomDomains: boolean;
  maxAttachmentSize?: number; // in bytes
  maxRecipientsPerMessage?: number;
}

export interface DomainVerificationResult {
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  verifiedAt?: Date;
  dnsRecords?: DnsRecord[];
  failureReason?: string;
  providerId?: string;
}

export interface DnsRecord {
  type: 'TXT' | 'MX' | 'CNAME' | 'A';
  name: string;
  value: string;
  ttl?: number;
  priority?: number; // For MX records
}

export interface TenantEmailSettings {
  tenantId: string;
  defaultFromDomain?: string;
  ticketingFromEmail?: string | null;
  customDomains: string[];
  emailProvider: 'smtp' | 'resend';
  providerConfigs: EmailProviderConfig[];
  trackingEnabled: boolean;
  maxDailyEmails?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Main interface that all email providers must implement
 */
export interface IEmailProvider {
  readonly providerId: string;
  readonly providerType: string;
  readonly capabilities: EmailProviderCapabilities;
  
  /**
   * Initialize the provider with configuration
   */
  initialize(config: Record<string, any>): Promise<void>;
  
  /**
   * Send a single email message
   */
  sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
  
  /**
   * Send multiple email messages in a batch
   */
  sendBulkEmails?(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]>;
  
  /**
   * Verify provider health and connectivity
   */
  healthCheck(): Promise<{ healthy: boolean; details?: string }>;
  
  /**
   * Get current rate limit status
   */
  getRateLimitStatus?(): Promise<{
    remaining: number;
    resetAt: Date;
    limit: number;
  }>;
  
  /**
   * Domain management methods (for providers that support it)
   */
  createDomain?(domain: string, region?: string): Promise<{
    domainId: string;
    dnsRecords: DnsRecord[];
    status: string;
  }>;
  
  verifyDomain?(domainId: string): Promise<DomainVerificationResult>;
  
  listDomains?(): Promise<Array<{
    domainId: string;
    domain: string;
    status: string;
    verifiedAt?: Date;
  }>>;
  
  deleteDomain?(domainId: string): Promise<{ success: boolean }>;
}

export class EmailProviderError extends Error {
  public readonly providerId: string;
  public readonly providerType: string;
  public readonly isRetryable: boolean;
  public readonly errorCode?: string;
  public readonly metadata?: Record<string, any>;

  constructor(
    message: string,
    providerId: string,
    providerType: string,
    isRetryable = false,
    errorCode?: string,
    metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'EmailProviderError';
    this.providerId = providerId;
    this.providerType = providerType;
    this.isRetryable = isRetryable;
    this.errorCode = errorCode;
    this.metadata = metadata;
  }
}

/**
 * Email provider manager interface for handling email providers
 */
export interface IEmailProviderManager {
  /**
   * Initialize the manager with tenant-specific settings
   */
  initialize(tenantSettings: TenantEmailSettings): Promise<void>;
  
  /**
   * Send email using the configured provider
   */
  sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
  
  /**
   * Send bulk emails using the configured provider
   */
  sendBulkEmails(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]>;
  
  /**
   * Get the configured provider for a tenant
   */
  getAvailableProviders(tenantId: string): Promise<IEmailProvider[]>;
  
  /**
   * Get health status of the provider
   */
  getProvidersHealth(tenantId: string): Promise<Array<{
    providerId: string;
    healthy: boolean;
    details?: string;
  }>>;
  
  /**
   * Update tenant email settings
   */
  updateTenantSettings(tenantId: string, settings: Partial<TenantEmailSettings>): Promise<void>;
}

/**
 * Inbound ticket defaults for email-to-ticket processing
 */
export interface InboundTicketDefaults {
  id: string;
  tenant: string;
  short_name: string;
  display_name: string;
  description?: string;
  board_id?: string;
  status_id?: string;
  priority_id?: string;
  client_id?: string;
  entered_by?: string | null;
  category_id?: string;
  subcategory_id?: string;
  location_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Options for ticket field dropdowns
 */
export interface TicketFieldOptions {
  boards: Array<{ id: string; name: string; is_default: boolean }>;
  statuses: Array<{ id: string; name: string; is_default?: boolean }>;
  priorities: Array<{ id: string; name: string; is_default?: boolean }>;
  categories: Array<{ id: string; name: string; parent_id?: string; board_id?: string }>;
  clients: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string; username: string }>;
  locations: Array<{ id: string; name: string; client_id: string }>;
}
