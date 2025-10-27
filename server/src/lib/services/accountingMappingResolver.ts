import { Knex } from 'knex';
import { createTenantKnex } from '../db';

export interface MappingResolution {
  external_entity_id: string;
  metadata?: Record<string, any> | null;
  source: 'service' | 'service_category' | 'fallback';
}

interface ResolveParams {
  adapterType: string;
  serviceId: string;
  targetRealm?: string | null;
}

export class AccountingMappingResolver {
  private cache = new Map<string, MappingResolution | null>();

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
      query.andWhereNull('external_realm_id');
    }

    return query.first();
  }
}
