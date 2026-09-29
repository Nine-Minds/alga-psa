import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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
    algaEntityType?: string;
  }): Promise<CompanyMappingLookupResult | null> {
    const row = await this.lookupMapping(params);
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
        record.algaEntityType ?? 'client',
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
        targetRealm: record.targetRealm ?? null,
        algaEntityType: record.algaEntityType
      };

      const existing = await this.lookupMapping(lookupParams, trx);

      if (existing) {
        return;
      }

      const payload = {
        id: trx.raw('gen_random_uuid()'),
        tenant: record.tenantId,
        integration_type: record.adapterType,
        alga_entity_type: record.algaEntityType ?? 'client',
        alga_entity_id: record.algaCompanyId,
        external_entity_id: record.externalCompanyId,
        external_realm_id: record.targetRealm ?? null,
        metadata: record.metadata ?? null
      };

      try {
        await tenantDb(trx, record.tenantId).table(TABLE_NAME).insert(payload);
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
      algaEntityType?: string;
    },
    executor: Knex | Knex.Transaction = this.knex
  ) {
    const query = tenantDb(executor, params.tenantId).table(TABLE_NAME)
      .where({
        integration_type: params.adapterType,
        alga_entity_type: params.algaEntityType ?? 'client',
        alga_entity_id: params.companyId
      });

    // Realm-scoped lookups are realm-exact: a mapping from another realm — or a
    // legacy realm-less row — must never resolve for a realm-scoped write. Legacy
    // rows are handled by migration/reconciliation, not guessed here; ignoring
    // them lets the sync service resolve the company inside the correct realm
    // and persist a realm-scoped mapping.
    if (params.targetRealm) {
      query.andWhere('external_realm_id', params.targetRealm);
    } else {
      query.whereNull('external_realm_id');
    }

    return query.first();
  }
}
