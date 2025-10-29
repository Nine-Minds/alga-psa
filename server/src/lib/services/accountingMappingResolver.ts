import { Knex } from 'knex';
import { createTenantKnex } from '../db';

export interface MappingResolution {
  external_entity_id: string;
  metadata?: Record<string, any> | null;
  source: 'service' | 'service_category' | 'fallback' | 'tax_code' | 'payment_term';
}

interface ResolveParams {
  adapterType: string;
  serviceId: string;
  targetRealm?: string | null;
}

interface GenericResolveParams {
  adapterType: string;
  entityType: string;
  entityId: string;
  source: MappingResolution['source'];
  targetRealm?: string | null;
}

export class AccountingMappingResolver {
  private cache = new Map<string, MappingResolution | null>();
  private genericCache = new Map<string, MappingResolution | null>();

  constructor(private readonly knex: Knex) {}

  static async create(): Promise<AccountingMappingResolver> {
    const { knex } = await createTenantKnex();
    return new AccountingMappingResolver(knex);
  }

  async resolveServiceMapping(params: ResolveParams): Promise<MappingResolution | null> {
    const cacheKey = `${params.adapterType}:${params.targetRealm ?? 'default'}:${params.serviceId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    const direct = await this.lookupMapping(params.adapterType, 'service', params.serviceId, params.targetRealm);
    if (direct) {
      const result: MappingResolution = {
        external_entity_id: direct.external_entity_id,
        metadata: direct.metadata ?? null,
        source: 'service'
      };
      this.cache.set(cacheKey, result);
      return result;
    }

    const serviceRow = await this.knex('service_catalog')
      .select('category_id')
      .where({ service_id: params.serviceId })
      .first();

    if (serviceRow?.category_id) {
      const category = await this.lookupMapping(params.adapterType, 'service_category', serviceRow.category_id, params.targetRealm);
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

  async resolveTaxCodeMapping(params: { adapterType: string; taxRegionId: string; targetRealm?: string | null }): Promise<MappingResolution | null> {
    if (!params.taxRegionId) {
      return null;
    }
    return this.resolveGenericMapping({
      adapterType: params.adapterType,
      entityType: 'tax_code',
      entityId: params.taxRegionId,
      source: 'tax_code',
      targetRealm: params.targetRealm ?? null
    });
  }

  async resolvePaymentTermMapping(params: { adapterType: string; paymentTermId: string; targetRealm?: string | null }): Promise<MappingResolution | null> {
    if (!params.paymentTermId) {
      return null;
    }
    return this.resolveGenericMapping({
      adapterType: params.adapterType,
      entityType: 'payment_term',
      entityId: params.paymentTermId,
      source: 'payment_term',
      targetRealm: params.targetRealm ?? null
    });
  }

  private async resolveGenericMapping(params: GenericResolveParams): Promise<MappingResolution | null> {
    const cacheKey = this.buildGenericCacheKey(params);
    if (this.genericCache.has(cacheKey)) {
      return this.genericCache.get(cacheKey) ?? null;
    }

    const row = await this.lookupMapping(params.adapterType, params.entityType, params.entityId, params.targetRealm);
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

  private buildGenericCacheKey(params: GenericResolveParams): string {
    return `${params.adapterType}:${params.targetRealm ?? 'default'}:${params.entityType}:${params.entityId}`;
  }

  private async lookupMapping(
    adapterType: string,
    entityType: string,
    entityId: string,
    targetRealm?: string | null
  ) {
    const query = this.knex('tenant_external_entity_mappings')
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
}
