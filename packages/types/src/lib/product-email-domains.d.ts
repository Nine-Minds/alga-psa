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
