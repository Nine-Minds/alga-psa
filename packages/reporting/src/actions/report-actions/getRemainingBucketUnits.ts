'use server';

import { z } from 'zod';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex'; // Import Knex type for query builder
import { reportingActionErrorFrom, type ReportingActionError } from './reportingActionErrors';

// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  currentDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid current date format (YYYY-MM-DD)",
  }),
});

// Define the structure for the returned data
export interface RemainingBucketUnitsResult {
  contract_line_id: string;
  contract_line_name: string;
  service_id: string;
  service_name: string;
  display_label: string;
  total_minutes: number;
  minutes_used: number;
  rolled_over_minutes: number;
  remaining_minutes: number;
  period_start?: string;
  period_end?: string;
}

/**
 * Server action to fetch remaining units (hours) for active bucket pools
 * associated with a specific client for the current period.
 *
 * Weighted-burn model: a bucket is a line-owned pool. One row is returned per
 * pool; the display label is the pool name, the single member service name
 * (member-scoped pool), or a generic pool label (catch-all). `minutes_used`
 * is the pool's weighted consumption, so the numbers read correctly for both
 * 1x and weighted pools.
 *
 * @param input - Object containing clientId and currentDate.
 * @returns A promise that resolves to an array of bucket pool usage details.
 */
export const getRemainingBucketUnits = withAuth(async (
  _user,
  { tenant },
  input: z.infer<typeof InputSchema>
): Promise<RemainingBucketUnitsResult[] | ReportingActionError> => {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    return reportingActionErrorFrom(validationResult.error)!;
  }
  const { clientId, currentDate } = validationResult.data;

  const { knex } = await createTenantKnex();

  console.log(`Fetching remaining bucket units for client ${clientId} in tenant ${tenant} as of ${currentDate}`);

  try {
    const results: RemainingBucketUnitsResult[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      // Active client contract lines owning at least one bucket pool.
      const lineQuery = scopedDb.table('client_contracts as cc');
      scopedDb.tenantJoin(
        lineQuery,
        'contracts as c',
        'c.contract_id',
        trx.raw('coalesce(cc.template_contract_id, cc.contract_id)') as unknown as string,
        { rootTenantColumn: 'cc.tenant' }
      );
      scopedDb.tenantJoin(lineQuery, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
      scopedDb.tenantJoin(lineQuery, 'contract_line_buckets as clb', 'cl.contract_line_id', 'clb.contract_line_id');

      // Member (first member only, for the label when member-scoped).
      scopedDb.tenantJoin(
        lineQuery,
        'contract_line_bucket_services as first_member',
        'first_member.bucket_id',
        'clb.bucket_id',
        {
          type: 'left',
          on: (join) => {
            // Deterministic "first" member for the display label.
            join.andOn('first_member.service_id', '=', trx.raw('(' +
              'SELECT ms.service_id FROM contract_line_bucket_services ms ' +
              'WHERE ms.tenant = first_member.tenant AND ms.bucket_id = first_member.bucket_id ' +
              'ORDER BY ms.service_id ASC LIMIT 1' +
            ')'));
          },
        }
      );
      scopedDb.tenantJoin(lineQuery, 'service_catalog as sc', 'first_member.service_id', 'sc.service_id', {
        type: 'left',
      });
      scopedDb.tenantJoin(lineQuery, 'bucket_usage as bu', 'clb.bucket_id', 'bu.bucket_id', {
        type: 'left',
        rootTenantColumn: 'cc.tenant',
        on: (join) => {
          join
            .andOn('cc.client_id', '=', 'bu.client_id')
            .andOn('bu.period_start', '<=', trx.raw('?', [currentDate]))
            .andOn('bu.period_end', '>', trx.raw('?', [currentDate]));
        },
      });

      lineQuery
        .where('cc.client_id', clientId)
        .andWhere('cc.is_active', true)
        .andWhere('cc.start_date', '<=', trx.raw('?', [currentDate]))
        .andWhere(function() {
          this.whereNull('cc.end_date')
              .orWhere('cc.end_date', '>', trx.raw('?', [currentDate]));
        })
        .select(
          'cl.contract_line_id',
          'cl.contract_line_name',
          'clb.bucket_id',
          'clb.bucket_name',
          'clb.covers_all_services',
          'clb.total_minutes',
          'first_member.service_id',
          'sc.service_name',
          trx.raw('COALESCE(bu.minutes_used, 0) as minutes_used'),
          trx.raw('COALESCE(bu.rolled_over_minutes, 0) as rolled_over_minutes'),
          'bu.period_start',
          'bu.period_end'
        );

      const rawResults: any[] = await lineQuery;

      return rawResults.map(row => {
        const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
        const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
        const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
        const remainingMinutes = totalMinutes + rolledOverMinutes - minutesUsed;
        const serviceName = row.service_name
          ? String(row.service_name)
          : row.covers_all_services
            ? 'All services'
            : 'Bucket pool';
        const displayLabel = row.bucket_name
          ? String(row.bucket_name)
          : `${row.contract_line_name} - ${serviceName}`;

        return {
          contract_line_id: row.contract_line_id,
          contract_line_name: row.contract_line_name,
          service_id: row.service_id ?? null,
          service_name: serviceName,
          display_label: displayLabel,
          total_minutes: totalMinutes,
          minutes_used: minutesUsed,
          rolled_over_minutes: rolledOverMinutes,
          remaining_minutes: remainingMinutes,
          period_start: row.period_start ? row.period_start.toISOString().split('T')[0] : undefined,
          period_end: row.period_end ? row.period_end.toISOString().split('T')[0] : undefined,
        };
      });
    });

    console.log(`Found ${results.length} active bucket pools for client ${clientId}`);
    return results;

  } catch (error) {
    const expected = reportingActionErrorFrom(error);
    if (expected) return expected;
    console.error(`Error fetching remaining bucket units for client ${clientId} in tenant ${tenant}:`, error);
    throw error;
  }
});
