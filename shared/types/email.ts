/**
 * Email provider types and interfaces for the outbound email abstraction system
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
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
  tags?: Record<string, string>;
  replyTo?: EmailAddress;
}

export interface EmailProviderConfig {
  providerId: string;
  providerType: 'smtp' | 'resend' | 'ses' | 'sendgrid';
  isEnabled: boolean;
  config: Record<string, any>;
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
  maxAttachmentSize?: number;
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
  priority?: number;
}

export interface TenantEmailSettings {
  tenantId: string;
  defaultFromDomain?: string;
  customDomains: string[];
  emailProvider: 'smtp' | 'resend';
  providerConfigs: EmailProviderConfig[];
  trackingEnabled: boolean;
  maxDailyEmails?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEmailProvider {
  readonly providerId: string;
  readonly providerType: string;
  readonly capabilities: EmailProviderCapabilities;
  initialize(config: Record<string, any>): Promise<void>;
  sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
  sendBulkEmails?(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]>;
  healthCheck(): Promise<{ healthy: boolean; details?: string }>;
  getRateLimitStatus?(): Promise<{
    remaining: number;
    resetAt: Date;
    limit: number;
  }>;
  createDomain?(domain: string, region?: string): Promise<{
    domainId: string;
    dnsRecords: DnsRecord[];
    status: string;
  }>;
  verifyDomain?(domainId: string): Promise<DomainVerificationResult>;
  listDomains?(): Promise<
    Array<{
      domainId: string;
      domain: string;
      status: string;
      verifiedAt?: Date;
    }>
  >;
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

export interface IEmailProviderManager {
  initialize(tenantSettings: TenantEmailSettings): Promise<void>;
  sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
  sendBulkEmails(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]>;
  getAvailableProviders(tenantId: string): Promise<IEmailProvider[]>;
}
