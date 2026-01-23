declare module '@alga-psa/integrations/email/domains/entry' {
  type DnsLookupResult = import('@alga-psa/types').DnsLookupResult;
  // Minimal surface needed for shared workflow registration without pulling in full package.
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

declare module '@product/email-domains/providers/ResendEmailProvider' {
  type IEmailProvider = import('server/src/types/email.types').IEmailProvider;
  type EmailMessage = import('server/src/types/email.types').EmailMessage;
  type EmailProviderCapabilities = import('server/src/types/email.types').EmailProviderCapabilities;
  type EmailSendResult = import('server/src/types/email.types').EmailSendResult;

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
