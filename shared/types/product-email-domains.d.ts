/**
 * Type declarations for email domain modules
 *
 * NOTE: ManagedDomainService is now accessed via the registry pattern
 * in @alga-psa/shared/workflow/services/managedDomainRegistry.
 * This declaration is kept for backwards compatibility but may be removed.
 */

declare module '@alga-psa/integrations/email/domains/entry' {
  type DnsLookupResult = import('@alga-psa/types').DnsLookupResult;

  export const ManagedDomainService: {
    forTenant: (options: { tenantId: string; knex: unknown }) => {
      createDomain: (options: { domain: string; region?: string }) => Promise<{
        providerDomainId: string;
        status: string;
        dnsRecords: unknown[];
      }>;
      checkDomainStatus: (identifier: { domain?: string; providerDomainId?: string }) => Promise<{
        provider: unknown;
        dnsLookup: DnsLookupResult[];
        providerDomainId: string;
      }>;
      activateDomain: (domain: string) => Promise<void>;
      deleteDomain: (domain: string) => Promise<void>;
      startDomainVerification?: (domainId: string) => Promise<unknown>;
    };
  };
}

// Email provider types - self-contained to avoid importing from server
declare module '@product/email-domains/providers/ResendEmailProvider' {
  interface EmailAddress {
    email: string;
    name?: string;
  }

  interface EmailAttachment {
    filename: string;
    content: Buffer | string;
    contentType?: string;
    cid?: string;
  }

  interface EmailMessage {
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

  interface EmailProviderCapabilities {
    supportsHtml: boolean;
    supportsAttachments: boolean;
    supportsTemplating: boolean;
    supportsBulkSending: boolean;
    supportsTracking: boolean;
    supportsCustomDomains: boolean;
    maxAttachmentSize?: number;
    maxRecipientsPerMessage?: number;
  }

  interface EmailSendResult {
    success: boolean;
    messageId?: string;
    providerId: string;
    providerType: string;
    error?: string;
    metadata?: Record<string, any>;
    sentAt: Date;
  }

  interface IEmailProvider {
    readonly providerId: string;
    readonly providerType: string;
    readonly capabilities: EmailProviderCapabilities;
    initialize(config: Record<string, any>): Promise<void>;
    sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
    healthCheck(): Promise<{ healthy: boolean; details?: string }>;
  }

  export class ResendEmailProvider implements IEmailProvider {
    readonly providerId: string;
    readonly providerType: string;
    readonly capabilities: EmailProviderCapabilities;
    constructor(providerId: string);
    initialize(config: Record<string, any>): Promise<void>;
    sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult>;
    healthCheck(): Promise<{ healthy: boolean; details?: string }>;
  }
}
