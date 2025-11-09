import { Knex } from 'knex';

import logger from '@alga-psa/shared/core/logger';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';
import type {
  DomainVerificationResult,
  DnsRecord,
} from 'server/src/types/email.types';
import { ResendEmailProvider } from 'server/src/services/email/providers/ResendEmailProvider';

import { verifyDnsRecords, type DnsLookupResult } from './dnsLookup';

const EMAIL_DOMAINS_TABLE = 'email_domains';
const TENANT_EMAIL_SETTINGS_TABLE = 'tenant_email_settings';
const MANAGED_PROVIDER_ID = 'managed-resend';

interface ManagedDomainServiceOptions {
  tenantId: string;
  knex: Knex;
}

interface CreateDomainOptions {
  domain: string;
  region?: string;
  userId?: string;
}

interface CreateDomainResult {
  providerDomainId: string;
  status: string;
  dnsRecords: DnsRecord[];
}

interface VerificationResult {
  provider: DomainVerificationResult;
  dnsLookup: DnsLookupResult[];
  providerDomainId: string;
}

export class ManagedDomainService {
  private providerPromise: Promise<ResendEmailProvider> | null = null;
  private readonly tenantId: string;
  private readonly knex: Knex;

  constructor(options: ManagedDomainServiceOptions) {
    this.tenantId = options.tenantId;
    this.knex = options.knex;
  }

  static forTenant(options: ManagedDomainServiceOptions): ManagedDomainService {
    return new ManagedDomainService(options);
  }

  async createDomain(options: CreateDomainOptions): Promise<CreateDomainResult> {
    const provider = await this.getProvider();

    logger.info('[ManagedDomainService] Creating managed domain', {
      tenantId: this.tenantId,
      domain: options.domain,
      region: options.region,
    });

    const providerResult = await provider.createDomain!(options.domain, options.region);

    const now = new Date();
    const record = {
      tenant_id: this.tenantId,
      domain_name: options.domain,
      status: providerResult.status ?? 'pending',
      provider_id: provider.providerId,
      provider_domain_id: providerResult.domainId,
      dns_records: JSON.stringify(providerResult.dnsRecords ?? []),
      created_at: now,
      updated_at: now,
      metadata: JSON.stringify({ region: options.region ?? 'us-east-1', managed: true }),
    };

    await this.knex(EMAIL_DOMAINS_TABLE)
      .insert(record)
      .onConflict(['tenant_id', 'domain_name'])
      .merge({
        status: record.status,
        provider_id: record.provider_id,
        provider_domain_id: record.provider_domain_id,
        dns_records: record.dns_records,
        metadata: record.metadata,
        updated_at: now,
      });

    return {
      providerDomainId: providerResult.domainId,
      status: providerResult.status ?? 'pending',
      dnsRecords: providerResult.dnsRecords ?? [],
    };
  }

  async checkDomainStatus(identifier: { domain?: string; providerDomainId?: string }): Promise<VerificationResult> {
    const provider = await this.getProvider();

    if (!identifier.domain && !identifier.providerDomainId) {
      throw new Error('Domain name or provider domain id must be provided');
    }

    const query = this.knex(EMAIL_DOMAINS_TABLE).where({ tenant_id: this.tenantId });

    if (identifier.domain) {
      query.andWhere({ domain_name: identifier.domain });
    }

    if (identifier.providerDomainId) {
      query.andWhere({ provider_domain_id: identifier.providerDomainId });
    }

    const existing = await query.first();

    if (!existing) {
      throw new Error(
        `Managed domain not found for tenant ${this.tenantId} (domain=${identifier.domain}, providerDomainId=${identifier.providerDomainId})`
      );
    }

    const dnsRecords: DnsRecord[] = existing.dns_records ? JSON.parse(existing.dns_records) : [];
    const dnsLookup = await verifyDnsRecords(dnsRecords);

    const providerDomainId = existing.provider_domain_id;
    if (!providerDomainId) {
      throw new Error(`Managed domain ${existing.domain_name} missing provider domain id`);
    }

    const providerVerification = await provider.verifyDomain!(providerDomainId);

    const updatedDnsRecords = providerVerification.dnsRecords ?? dnsRecords;
    const updatedStatus = providerVerification.status ?? existing.status;

    await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant_id: this.tenantId, domain_name: domain })
      .update({
        status: updatedStatus,
        dns_records: JSON.stringify(updatedDnsRecords ?? []),
        failure_reason: providerVerification.failureReason ?? null,
        provider_id: provider.providerId,
        verified_at: providerVerification.status === 'verified' ? new Date() : existing.verified_at,
        updated_at: new Date(),
      });

    return {
      provider: providerVerification,
      dnsLookup,
      providerDomainId,
    };
  }

  async activateDomain(domain: string): Promise<void> {
    const now = new Date();

    await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant_id: this.tenantId, domain_name: domain })
      .update({
        status: 'verified',
        verified_at: now,
        updated_at: now,
      });

    const existingSettings = await this.knex(TENANT_EMAIL_SETTINGS_TABLE)
      .where({ tenant_id: this.tenantId })
      .first();

    if (existingSettings) {
      await this.knex(TENANT_EMAIL_SETTINGS_TABLE)
        .where({ tenant_id: this.tenantId })
        .update({
          default_from_domain: domain,
          updated_at: now,
        });
    } else {
      await this.knex(TENANT_EMAIL_SETTINGS_TABLE).insert({
        tenant_id: this.tenantId,
        default_from_domain: domain,
        custom_domains: JSON.stringify([domain]),
        email_provider: 'resend',
        provider_configs: JSON.stringify([]),
        tracking_enabled: false,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async deleteDomain(domain: string): Promise<void> {
    const provider = await this.getProvider();

    const existing = await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant_id: this.tenantId, domain_name: domain })
      .first();

    if (!existing) {
      return;
    }

    if (existing.provider_domain_id) {
      try {
        await provider.deleteDomain!(existing.provider_domain_id);
      } catch (error: any) {
        logger.warn('[ManagedDomainService] Failed to delete domain from provider', {
          tenantId: this.tenantId,
          domain,
          error: error?.message,
        });
      }
    }

    await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant_id: this.tenantId, domain_name: domain })
      .del();
  }

  private async getProvider(): Promise<ResendEmailProvider> {
    if (!this.providerPromise) {
      this.providerPromise = this.createProvider();
    }

    return this.providerPromise;
  }

  private async createProvider(): Promise<ResendEmailProvider> {
    const provider = new ResendEmailProvider(MANAGED_PROVIDER_ID);
    const config = await this.getProviderConfig();
    await provider.initialize(config);
    return provider;
  }

  private async getProviderConfig(): Promise<Record<string, any>> {
    const secretProvider = await this.safeGetSecretProvider();
    const apiKey = (await secretProvider?.getAppSecret?.('RESEND_API_KEY')) ?? process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured for managed domains');
    }

    const baseUrl = process.env.RESEND_BASE_URL;
    const defaultFromDomain = process.env.RESEND_DEFAULT_FROM_DOMAIN;

    return {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(defaultFromDomain ? { defaultFromDomain } : {}),
    };
  }

  private async safeGetSecretProvider(): Promise<Awaited<ReturnType<typeof getSecretProviderInstance>> | null> {
    try {
      return await getSecretProviderInstance();
    } catch (error) {
      logger.warn('[ManagedDomainService] Failed to initialize secret provider, falling back to env vars', {
        error: (error as Error)?.message,
      });
      return null;
    }
  }
}

export default ManagedDomainService;
