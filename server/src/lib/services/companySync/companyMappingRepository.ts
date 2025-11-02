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
    await this.knex.transaction(async (trx) => {
      const lockKey = [
        record.tenantId,
        record.adapterType,
        record.targetRealm ?? 'default',
        record.algaCompanyId
      ].join(':');

      await trx.raw(
        'SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended(?::text, 0))',
        [lockKey]
      );

      const lookupParams = {
        tenantId: record.tenantId,
        adapterType: record.adapterType,
        companyId: record.algaCompanyId,
        targetRealm: record.targetRealm ?? null
      };

      const existing =
        (await this.lookupMapping(lookupParams, 'company', trx)) ??
        (await this.lookupMapping(lookupParams, 'client', trx));

      if (existing) {
        return;
      }

      const payload = {
        id: trx.raw('gen_random_uuid()'),
        tenant: record.tenantId,
        integration_type: record.adapterType,
        alga_entity_type: 'company',
        alga_entity_id: record.algaCompanyId,
        external_entity_id: record.externalCompanyId,
        external_realm_id: record.targetRealm ?? null,
        metadata: record.metadata ?? null
      };

      try {
        await trx(TABLE_NAME).insert(payload);
      } catch (error: any) {
        if (error?.code !== '23505') {
          throw error;
        }
      }
    });
  }

  private lookupMapping(
    params: {
      tenantId: string;
      adapterType: AccountingAdapterType;
      companyId: string;
      targetRealm?: string | null;
    },
    entityType: 'company' | 'client',
    executor: Knex | Knex.Transaction = this.knex
  ) {
    const query = executor(TABLE_NAME)
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
