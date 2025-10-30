import { Knex } from 'knex';
import {
  AccountingAdapterType,
  CompanyMappingLookupResult,
  CompanyMappingRecord,
  CompanyMappingRepository
} from './companySync.types';

const TABLE_NAME = 'tenant_external_entity_mappings';

export class KnexCompanyMappingRepository implements CompanyMappingRepository {
  constructor(private readonly knex: Knex) {}

  async findCompanyMapping(params: {
    tenantId: string;
    adapterType: AccountingAdapterType;
    companyId: string;
    targetRealm?: string | null;
  }): Promise<CompanyMappingLookupResult | null> {
    const row =
      (await this.lookupMapping(params, 'company')) ??
      (await this.lookupMapping(params, 'client'));
    if (!row) {
      return null;
    }

    return {
      externalCompanyId: row.external_entity_id,
      metadata: row.metadata ?? null
    };
  }

  async upsertCompanyMapping(record: CompanyMappingRecord): Promise<void> {
    const payload = {
      id: this.knex.raw('gen_random_uuid()'),
      tenant: record.tenantId,
      integration_type: record.adapterType,
      alga_entity_type: 'company',
      alga_entity_id: record.algaCompanyId,
      external_entity_id: record.externalCompanyId,
      external_realm_id: record.targetRealm ?? null,
      metadata: record.metadata ?? null
    };

    try {
      await this.knex(TABLE_NAME)
        .insert(payload)
        .onConflict([
          'tenant',
          'integration_type',
          'alga_entity_type',
          'alga_entity_id',
          'external_realm_id'
        ])
        .merge({
          external_entity_id: payload.external_entity_id,
          metadata: payload.metadata
        });
    } catch (error: any) {
      if (error?.code === '23505') {
        // Unique violation: another process inserted the row; treat as success.
        return;
      }
      throw error;
    }
  }

  private lookupMapping(
    params: {
      tenantId: string;
      adapterType: AccountingAdapterType;
      companyId: string;
      targetRealm?: string | null;
    },
    entityType: 'company' | 'client'
  ) {
    const query = this.knex(TABLE_NAME)
      .where({
        tenant: params.tenantId,
        integration_type: params.adapterType,
        alga_entity_type: entityType,
        alga_entity_id: params.companyId
      })
      .orderByRaw('CASE WHEN external_realm_id IS NOT NULL THEN 0 ELSE 1 END');

    if (params.targetRealm) {
      query.andWhere((builder) => {
        builder.where('external_realm_id', params.targetRealm!).orWhereNull('external_realm_id');
      });
    } else {
      query.whereNull('external_realm_id');
    }

    return query.first();
  }
}
