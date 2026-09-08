import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IClientContractLine } from '@alga-psa/types';
import { formatISO } from 'date-fns';

export type EligibleContractLine = IClientContractLine & {
  contract_line_type: string;
  /** contract_lines.billing_profile_id — step 2 of the resolution chain. */
  billing_profile_id?: string | null;
  /** client_contracts.billing_profile_id — step 3 of the resolution chain. */
  contract_billing_profile_id?: string | null;
  bucket_overlay?: {
    config_id: string;
    total_minutes?: number | null;
    overage_rate?: number | null;
    allow_rollover?: boolean | null;
  };
};

const resolveEffectiveDateRange = (
  effectiveDate?: string | Date
): { rangeStart: string; rangeEnd: string } => {
  const source =
    effectiveDate instanceof Date
      ? effectiveDate.toISOString()
      : typeof effectiveDate === 'string' && effectiveDate.trim().length > 0
        ? effectiveDate
        : new Date().toISOString();
  const normalizedDate = source.slice(0, 10);
  return {
    rangeStart: `${normalizedDate}T00:00:00.000Z`,
    rangeEnd: `${normalizedDate}T23:59:59.999Z`,
  };
};

export async function loadEligibleTimeContractLines(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date,
  retain = false
): Promise<EligibleContractLine[]> {
  const { rangeStart, rangeEnd } = resolveEffectiveDateRange(effectiveDate);
  const db = tenantDb(knex, tenant);

  const serviceInfo = await db.table('service_catalog')
    .where({
      'service_catalog.service_id': serviceId,
    })
    .first('category_id', 'custom_service_type_id as service_type_id');

  if (!serviceInfo) {
    console.warn(`Service not found: ${serviceId}`);
    return [];
  }

  const query = db.table('client_contracts');
  db.tenantJoin(query, 'contracts', 'client_contracts.contract_id', 'contracts.contract_id');
  db.tenantJoin(query, 'contract_lines', 'contracts.contract_id', 'contract_lines.contract_id');
  db.tenantJoin(query, 'contract_line_services', 'contract_lines.contract_line_id', 'contract_line_services.contract_line_id', { type: 'left', on(join) { join.andOnVal('contract_line_services.service_id', '=', serviceId); } });
  // Scope-resolution rule (weighted-burn model): explicit membership on a line
  // bucket, else the line's catch-all bucket. Replacement for the legacy
  // configuration_type='Bucket' overlay join.
  db.tenantJoin(
    query,
    'contract_line_bucket_services as member',
    'member.contract_line_id',
    'contract_lines.contract_line_id',
    {
      type: 'left',
      on(join) {
        join.andOnVal('member.service_id', '=', serviceId);
      },
    }
  );
  db.tenantJoin(
    query,
    'contract_line_buckets as catch_all',
    'catch_all.contract_line_id',
    'contract_lines.contract_line_id',
    {
      type: 'left',
      on(join) {
        join.andOnVal('catch_all.covers_all_services', '=', true);
      },
    }
  );

  query
    .where({
      'client_contracts.client_id': clientId,
      'client_contracts.is_active': true,
      'contracts.is_active': true,
      'contract_lines.is_active': true,
    })
    .where(function (this: Knex.QueryBuilder) {
      this.where('contract_line_services.service_id', serviceId).orWhereNotNull('member.bucket_id').orWhereNotNull('catch_all.bucket_id');
    })
    .where(function (this: Knex.QueryBuilder) {
      this.where('client_contracts.start_date', '<=', rangeEnd);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('client_contracts.end_date').orWhere('client_contracts.end_date', '>=', rangeStart);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('contracts.is_system_managed_default')
        .orWhere('contracts.is_system_managed_default', false);
    });

  if (retain) query.forShare('client_contracts', 'contracts', 'contract_lines');
  const rows = await query.select(
    'contract_lines.contract_line_id as client_contract_line_id',
    'client_contracts.client_id',
    'contract_lines.contract_line_id',
    'client_contracts.start_date',
    'client_contracts.end_date',
    'client_contracts.is_active',
    'client_contracts.tenant',
    'client_contracts.client_contract_id',
    'contracts.contract_id',
    'contract_lines.contract_line_type',
    'contract_lines.contract_line_name',
    'contracts.contract_name',
    // Steps 2 and 3 of the billing-profile chain, so profile-aware narrowing
    // can prefer the line whose contract belongs to the work item's profile.
    'contract_lines.billing_profile_id',
    'client_contracts.billing_profile_id as contract_billing_profile_id',
    'member.bucket_id as member_bucket_id',
    'catch_all.bucket_id as catch_all_bucket_id'
  );

  return rows.map((row) => {
    const {
      member_bucket_id,
      catch_all_bucket_id,
      start_date,
      end_date,
      ...rest
    } = row as Record<string, any>;

    const { bucket_overlay: existingOverlay, ...restWithoutOverlay } = rest;

    const bucket_config_id = member_bucket_id ?? catch_all_bucket_id ?? null;

    const bucket_overlay = bucket_config_id
      ? {
          config_id: bucket_config_id,
          total_minutes: null,
          overage_rate: null,
          allow_rollover: null,
        }
      : existingOverlay;

    return {
      ...restWithoutOverlay,
      start_date: start_date ? formatISO(start_date) : '',
      end_date: end_date ? formatISO(end_date) : null,
      bucket_overlay,
    } as EligibleContractLine;
  });
}

