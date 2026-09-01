import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { AccountingAdapterType } from '../services/companySync/companySync.types';

const TABLE_NAME = 'tenant_external_entity_mappings';

type InvoiceMappingDbRow = {
  id: string;
  integration_type: AccountingAdapterType;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  metadata?: unknown;
};

export interface InvoiceMappingRow {
  id: string;
  adapterType: AccountingAdapterType;
  invoiceId: string;
  externalInvoiceId: string;
  externalRealmId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FindInvoiceMappingParams {
  tenantId: string;
  adapterType: AccountingAdapterType;
  invoiceId: string;
  targetRealm?: string | null;
}

export interface UpsertInvoiceMappingParams {
  tenantId: string;
  adapterType: AccountingAdapterType;
  invoiceId: string;
  externalInvoiceId: string;
  targetRealm?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class KnexInvoiceMappingRepository {
  private readonly knex: Knex;

  constructor(knex: Knex) {
    this.knex = knex;
  }

  async findInvoiceMapping(params: FindInvoiceMappingParams): Promise<InvoiceMappingRow | null> {
    const query = tenantDb(this.knex, params.tenantId).table<InvoiceMappingDbRow>(TABLE_NAME)
      .select(
        'id',
        'integration_type',
        'alga_entity_id',
        'external_entity_id',
        'external_realm_id',
        'metadata'
      )
      .where((builder) => {
        builder
          .where('integration_type', params.adapterType)
          .where('alga_entity_type', 'invoice')
          .where('alga_entity_id', params.invoiceId)
          .whereNull('deleted_at');
      });

    // Exact tenant + provider + type + realm match, no NULL-realm fallback:
    // a live mapping in another company is not this company's document.
    if (params.targetRealm) {
      query.andWhere('external_realm_id', params.targetRealm);
    } else {
      query.andWhere((builder) => {
        builder.whereNull('external_realm_id');
      });
    }

    const row = await query.first();
    if (!row) {
      return null;
    }

    return this.normalizeRow(row);
  }

  /**
   * Like findInvoiceMapping, but returns a tombstoned (unlinked) row too, so
   * the export path can distinguish "this invoice was never exported" from
   * "this invoice was exported and then unlinked". A tombstoned document must
   * be explicitly relinked or re-created — it must never silently re-export as
   * a brand-new remote document (a duplicate).
   */
  async findUnlinkedInvoiceMapping(params: FindInvoiceMappingParams): Promise<InvoiceMappingRow | null> {
    const query = tenantDb(this.knex, params.tenantId).table<InvoiceMappingDbRow>(TABLE_NAME)
      .select(
        'id',
        'integration_type',
        'alga_entity_id',
        'external_entity_id',
        'external_realm_id',
        'metadata'
      )
      .where((builder) => {
        builder
          .where('integration_type', params.adapterType)
          .where('alga_entity_type', 'invoice')
          .where('alga_entity_id', params.invoiceId)
          .whereNotNull('deleted_at');
      });

    // Realm-exact: external entity ids are provider-company-local, so a
    // mapping from another realm — or a legacy realm-less row — must never
    // resolve for a realm-scoped export or write.
    if (params.targetRealm) {
      query.andWhere('external_realm_id', params.targetRealm);
    } else {
      query.andWhere((builder) => {
        builder.whereNull('external_realm_id');
      });
    }

    const row = await query.first();
    if (!row) {
      return null;
    }

    return this.normalizeRow(row);
  }

  async upsertInvoiceMapping(params: UpsertInvoiceMappingParams): Promise<void> {
    const now = new Date().toISOString();
    const metadata =
      params.metadata && Object.keys(params.metadata).length > 0 ? params.metadata : null;

    await tenantDb(this.knex, params.tenantId).table(TABLE_NAME)
      .insert({
        id: this.knex.raw('gen_random_uuid()'),
        tenant: params.tenantId,
        integration_type: params.adapterType,
        alga_entity_type: 'invoice',
        alga_entity_id: params.invoiceId,
        external_entity_id: params.externalInvoiceId,
        external_realm_id: params.targetRealm ?? null,
        sync_status: 'synced',
        metadata,
        created_at: now,
        updated_at: now
      })
      // Matches idx_unique_alga_mapping, which includes the realm expression —
      // the same invoice may be mapped once per realm.
      .onConflict(this.knex.raw("(tenant, integration_type, alga_entity_type, alga_entity_id, COALESCE(external_realm_id, ''))"))
      .merge({
        external_entity_id: params.externalInvoiceId,
        external_realm_id: params.targetRealm ?? null,
        sync_status: 'synced',
        metadata,
        updated_at: now
      });
  }

  private normalizeRow(row: InvoiceMappingDbRow): InvoiceMappingRow {
    return {
      id: row.id,
      adapterType: row.integration_type,
      invoiceId: row.alga_entity_id,
      externalInvoiceId: row.external_entity_id,
      externalRealmId: row.external_realm_id ?? null,
      metadata: this.parseMetadata(row.metadata)
    };
  }

  private parseMetadata(input: unknown): Record<string, unknown> | null {
    if (!input) {
      return null;
    }

    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return null;
      } catch (error) {
        logger.warn('InvoiceMappingRepository: failed to parse mapping metadata string', {
          error
        });
        return null;
      }
    }

    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }

    return null;
  }
}
