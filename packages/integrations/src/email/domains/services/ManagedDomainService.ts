import { Knex } from 'knex';

import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { DomainVerificationResult, DnsRecord } from '@alga-psa/types';
import { ResendEmailProvider } from '../providers/ResendEmailProvider';

import { verifyDnsRecords } from './dnsLookup';
import type { DnsLookupResult } from '@alga-psa/types';

const EMAIL_DOMAINS_TABLE = 'email_domains';
const TENANT_EMAIL_SETTINGS_TABLE = 'tenant_email_settings';
const MANAGED_PROVIDER_ID = 'managed-resend';

let loggedEmailDomainConflictFallback = false;

type PostgresErrorLike = {
  code?: string;
};

function isMissingEmailDomainConflictConstraintError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as PostgresErrorLike).code === '42P10';
}

function logEmailDomainConflictFallbackOnce(context: { tenantId: string; domain: string }): void {
  if (loggedEmailDomainConflictFallback) {
    return;
  }

  loggedEmailDomainConflictFallback = true;
  logger.warn('[ManagedDomainService] email_domains is missing the expected unique constraint; using manual upsert fallback', context);
}

async function upsertEmailDomainWithoutConflict(
  knex: Knex,
  record: Record<string, unknown>,
  mergeFields: Record<string, unknown>
): Promise<void> {
  await knex.transaction(async (trx) => {
    const existing = await trx(EMAIL_DOMAINS_TABLE)
      .where({
        tenant: record.tenant,
        domain_name: record.domain_name,
      })
      .first();

    if (existing) {
      await trx(EMAIL_DOMAINS_TABLE)
        .where({
          tenant: record.tenant,
          domain_name: record.domain_name,
        })
        .update(mergeFields);
      return;
    }

    await trx(EMAIL_DOMAINS_TABLE).insert(record);
  });
}

function parseDnsRecords(raw: unknown, domainName: string): DnsRecord[] {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw as DnsRecord[];
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as DnsRecord[];
    } catch (error) {
      logger.warn('[ManagedDomainService] Failed to parse dns_records JSON string', {
        domainName,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  if (typeof raw === 'object') {
    try {
      return JSON.parse(JSON.stringify(raw)) as DnsRecord[];
    } catch (error) {
      logger.warn('[ManagedDomainService] Failed to normalize dns_records object', {
        domainName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return [];
}

type EmailDomainStatus = 'pending' | 'verified' | 'failed';

function normalizeProviderStatus(status: string | undefined, fallback: EmailDomainStatus = 'pending'): EmailDomainStatus {
  if (!status) {
    return fallback;
  }

  const normalized = status.toLowerCase();
  if (normalized === 'verified') {
    return 'verified';
  }

  if (normalized === 'failed' || normalized === 'rejected' || normalized === 'temporary_failure') {
    return 'failed';
  }

  return 'pending';
}

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
      tenant: this.tenantId,
      domain_name: options.domain,
      status: normalizeProviderStatus(providerResult.status),
      provider_id: provider.providerId,
      provider_domain_id: providerResult.domainId,
      dns_records: JSON.stringify(providerResult.dnsRecords ?? []),
      created_at: now,
      updated_at: now,
      metadata: JSON.stringify({ region: options.region ?? 'us-east-1', managed: true }),
    };

    const mergeFields = {
      status: record.status,
      provider_id: record.provider_id,
      provider_domain_id: record.provider_domain_id,
      dns_records: record.dns_records,
      metadata: record.metadata,
      updated_at: now,
    };

    try {
      await this.knex(EMAIL_DOMAINS_TABLE)
        .insert(record)
        .onConflict(['tenant', 'domain_name'])
        .merge(mergeFields);
    } catch (error) {
      if (!isMissingEmailDomainConflictConstraintError(error)) {
        throw error;
      }

      logEmailDomainConflictFallbackOnce({
        tenantId: this.tenantId,
        domain: options.domain,
      });
      await upsertEmailDomainWithoutConflict(this.knex, record, mergeFields);
    }

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

    const query = this.knex(EMAIL_DOMAINS_TABLE).where({ tenant: this.tenantId });

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

    const dnsRecords: DnsRecord[] = parseDnsRecords(existing.dns_records, existing.domain_name);
    const dnsLookup = await verifyDnsRecords(dnsRecords);
    const allRecordsMatched = dnsLookup.length > 0 && dnsLookup.every((entry) => entry.matchedValue);

    const providerDomainId = existing.provider_domain_id;
    if (!providerDomainId) {
      throw new Error(`Managed domain ${existing.domain_name} missing provider domain id`);
    }

    let providerVerification = await provider.verifyDomain!(providerDomainId);

    if (
      allRecordsMatched &&
      providerVerification.providerStatus === 'not_started' &&
      typeof provider.startDomainVerification === 'function'
    ) {
      try {
        logger.info('[ManagedDomainService] Starting provider domain verification', {
          tenantId: this.tenantId,
          domain: existing.domain_name,
        });
        providerVerification = await provider.startDomainVerification(providerDomainId);
      } catch (error) {
        logger.warn('[ManagedDomainService] Failed to start provider verification (will retry)', {
          tenantId: this.tenantId,
          domain: existing.domain_name,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    const fallbackStatus: EmailDomainStatus = existing.status === 'verified'
      ? 'verified'
      : existing.status === 'failed'
        ? 'failed'
        : 'pending';
    const updatedDnsRecords = providerVerification.dnsRecords ?? dnsRecords;
    const updatedStatus = normalizeProviderStatus(providerVerification.status, fallbackStatus);
    const domainName = identifier.domain ?? existing.domain_name;

    const updatedAt = new Date();
    const verifiedAt =
      providerVerification.status === 'verified'
        ? updatedAt
        : existing.verified_at;
    await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant: this.tenantId, domain_name: domainName })
      .update({
        status: updatedStatus,
        dns_records: JSON.stringify(updatedDnsRecords ?? []),
        failure_reason: providerVerification.failureReason ?? null,
        provider_id: provider.providerId,
        verified_at: verifiedAt,
        dns_lookup_results: JSON.stringify(dnsLookup ?? []),
        dns_last_checked_at: updatedAt,
        updated_at: updatedAt,
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
      .where({ tenant: this.tenantId, domain_name: domain })
      .update({
        status: 'verified',
        verified_at: now,
        updated_at: now,
      });

    const existingSettings = await this.knex(TENANT_EMAIL_SETTINGS_TABLE)
      .where({ tenant: this.tenantId })
      .first();

    if (existingSettings) {
      await this.knex(TENANT_EMAIL_SETTINGS_TABLE)
        .where({ tenant: this.tenantId })
        .update({
          default_from_domain: domain,
          updated_at: now,
        });
    } else {
      await this.knex(TENANT_EMAIL_SETTINGS_TABLE).insert({
        tenant: this.tenantId,
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
      .where({ tenant: this.tenantId, domain_name: domain })
      .first();

    if (!existing) {
      return;
    }

    if (existing.provider_domain_id) {
      try {
        await provider.deleteDomain!(existing.provider_domain_id);
      } catch (error) {
        logger.warn('[ManagedDomainService] Failed to delete domain from provider', {
          tenantId: this.tenantId,
          domain,
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    await this.knex(EMAIL_DOMAINS_TABLE)
      .where({ tenant: this.tenantId, domain_name: domain })
      .update({
        status: 'deleted',
        updated_at: new Date(),
      });
  }

  private async getProvider(): Promise<ResendEmailProvider> {
    if (this.providerPromise) {
      return this.providerPromise;
    }

    this.providerPromise = (async () => {
      const secretProvider = await getSecretProviderInstance().catch((error) => {
        logger.warn('[ManagedDomainService] Failed to initialize secret provider, falling back to env vars', {
          error: error instanceof Error ? error.message : error,
        });
        return null;
      });

      const apiKey =
        (await secretProvider?.getAppSecret('resend_api_key')) ||
        process.env.RESEND_API_KEY;

      if (!apiKey) {
        throw new Error('Managed domain provisioning requires RESEND_API_KEY to be configured');
      }

      const provider = new ResendEmailProvider(MANAGED_PROVIDER_ID);
      await provider.initialize({
        apiKey,
        baseUrl: process.env.RESEND_BASE_URL,
        defaultFromDomain: process.env.RESEND_DEFAULT_DOMAIN,
      });

      return provider;
    })();

    return this.providerPromise;
  }
}

export default ManagedDomainService;
