import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  AccountingAdapterType,
  CompanyAccountingSyncService,
  NormalizedCompanyPayload
} from './companySync';

export interface MappingResolution {
  external_entity_id: string;
  metadata?: Record<string, any> | null;
  source: 'service' | 'service_category' | 'fallback' | 'tax_code' | 'payment_term' | 'company';
}

interface ResolveParams {
  tenantId?: string;
  adapterType: string;
  serviceId: string;
  targetRealm?: string | null;
}

interface GenericResolveParams {
  tenantId?: string;
  adapterType: string;
  entityType: string;
  entityId: string;
  source: MappingResolution['source'];
  targetRealm?: string | null;
}

export class AccountingMappingResolver {
  private cache = new Map<string, MappingResolution | null>();
  private genericCache = new Map<string, MappingResolution | null>();
  private companyCache = new Map<string, MappingResolution | null>();

  constructor(
    private readonly knex: Knex,
    private readonly companySyncService?: CompanyAccountingSyncService,
    private readonly tenantId?: string | null
  ) {}

  static async create(deps: { companySyncService?: CompanyAccountingSyncService } = {}): Promise<AccountingMappingResolver> {
    const { knex, tenant } = await createTenantKnex();
    return new AccountingMappingResolver(knex, deps.companySyncService, tenant ?? null);
  }

  async resolveServiceMapping(params: ResolveParams): Promise<MappingResolution | null> {
    const tenantId = this.resolveTenant(params.tenantId);
    const cacheKey = `${tenantId}:${params.adapterType}:${params.targetRealm ?? 'default'}:${params.serviceId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    const direct = await this.lookupMapping(params.adapterType, 'service', params.serviceId, tenantId, params.targetRealm);
    if (direct) {
      const result: MappingResolution = {
        external_entity_id: direct.external_entity_id,
        metadata: direct.metadata ?? null,
        source: 'service'
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    const serviceRow = await tenantDb(this.knex, tenantId).table('service_catalog')
      .select('category_id')
      .where({ service_id: params.serviceId })
      .first();

    if (serviceRow?.category_id) {
      const category = await this.lookupMapping(params.adapterType, 'service_category', serviceRow.category_id, tenantId, params.targetRealm);
      if (category) {
        const result: MappingResolution = {
          external_entity_id: category.external_entity_id,
          metadata: category.metadata ?? null,
          source: 'service_category'
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    this.cache.set(cacheKey, null);
    return null;
  }

  async resolveTaxCodeMapping(params: { tenantId?: string; adapterType: string; taxRegionId: string; targetRealm?: string | null }): Promise<MappingResolution | null> {
    if (!params.taxRegionId) {
      return null;
    }
    return this.resolveGenericMapping({
      adapterType: params.adapterType,
      tenantId: params.tenantId,
      entityType: 'tax_code',
      entityId: params.taxRegionId,
      source: 'tax_code',
      targetRealm: params.targetRealm ?? null
    });
  }

  async resolvePaymentTermMapping(params: { tenantId?: string; adapterType: string; paymentTermId: string; targetRealm?: string | null }): Promise<MappingResolution | null> {
    if (!params.paymentTermId) {
      return null;
    }
    return this.resolveGenericMapping({
      adapterType: params.adapterType,
      tenantId: params.tenantId,
      entityType: 'payment_term',
      entityId: params.paymentTermId,
      source: 'payment_term',
      targetRealm: params.targetRealm ?? null
    });
  }

  async resolveClientMapping(params: { tenantId?: string; adapterType: string; clientId: string; targetRealm?: string | null }): Promise<MappingResolution | null> {
    if (!params.clientId) {
      return null;
    }
    return this.resolveGenericMapping({
      adapterType: params.adapterType,
      tenantId: params.tenantId,
      entityType: 'client',
      entityId: params.clientId,
      source: 'company',
      targetRealm: params.targetRealm ?? null
    });
  }

  async ensureCompanyMapping(params: {
    tenantId: string;
    adapterType: string;
    companyId: string;
    payload: NormalizedCompanyPayload;
    targetRealm?: string | null;
  }): Promise<MappingResolution | null> {
    if (!this.companySyncService) {
      return null;
    }
    const cacheKey = this.buildCompanyCacheKey(params);
    if (this.companyCache.has(cacheKey)) {
      return this.companyCache.get(cacheKey) ?? null;
    }

    const adapterType = this.normalizeAdapterType(params.adapterType);
    if (!adapterType) {
      this.companyCache.set(cacheKey, null);
      return null;
    }

    const result = await this.companySyncService.ensureCompanyMapping({
      tenantId: params.tenantId,
      adapterType,
      companyId: params.companyId,
      payload: params.payload,
      targetRealm: params.targetRealm ?? null
    });

    const mapping: MappingResolution = {
      external_entity_id: result.externalCompanyId,
      metadata: result.metadata ?? null,
      source: 'company'
    };
    this.companyCache.set(cacheKey, mapping);
    return mapping;
  }

  private async resolveGenericMapping(params: GenericResolveParams): Promise<MappingResolution | null> {
    const tenantId = this.resolveTenant(params.tenantId);
    const cacheKey = this.buildGenericCacheKey({ ...params, tenantId });
    if (this.genericCache.has(cacheKey)) {
      return this.genericCache.get(cacheKey) ?? null;
    }

    const row = await this.lookupMapping(params.adapterType, params.entityType, params.entityId, tenantId, params.targetRealm);
    if (!row) {
      this.genericCache.set(cacheKey, null);
      return null;
    }

    const result: MappingResolution = {
      external_entity_id: row.external_entity_id,
      metadata: row.metadata ?? null,
      source: params.source
    };
    this.genericCache.set(cacheKey, result);
    return result;
  }

  private buildGenericCacheKey(params: GenericResolveParams & { tenantId: string }): string {
    return `${params.tenantId}:${params.adapterType}:${params.targetRealm ?? 'default'}:${params.entityType}:${params.entityId}`;
  }

  private buildCompanyCacheKey(params: {
    tenantId: string;
    adapterType: string;
    companyId: string;
    targetRealm?: string | null;
  }): string {
    return [
      params.tenantId,
      params.adapterType,
      params.targetRealm ?? 'default',
      params.companyId
    ].join(':');
  }

  private async lookupMapping(
    adapterType: string,
    entityType: string,
    entityId: string,
    tenantId: string,
    targetRealm?: string | null
  ) {
    const query = tenantDb(this.knex, tenantId).table('tenant_external_entity_mappings')
      .where({
        integration_type: adapterType,
        alga_entity_type: entityType,
        alga_entity_id: entityId
      })
      .orderByRaw('CASE WHEN external_realm_id IS NOT NULL THEN 0 ELSE 1 END');

    if (targetRealm) {
      query.andWhere((builder) => {
        builder.where('external_realm_id', targetRealm).orWhereNull('external_realm_id');
      });
    } else {
      query.whereNull('external_realm_id');
    }

    return query.first();
  }

  private resolveTenant(tenantId?: string | null): string {
    const resolved = tenantId ?? this.tenantId;
    if (!resolved) {
      throw new Error('AccountingMappingResolver requires tenant context');
    }
    return resolved;
  }

  private normalizeAdapterType(adapterType: string): AccountingAdapterType | null {
    if (
      adapterType === 'xero' ||
      adapterType === 'quickbooks_online' ||
      adapterType === 'quickbooks_desktop' ||
      adapterType === 'quickbooks_csv'
    ) {
      return adapterType;
    }
    return null;
  }
}
