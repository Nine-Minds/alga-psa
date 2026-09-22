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

      // Keep each query tenant-routed. Citus cannot plan the former combined
      // COALESCE join and correlated first-member subquery on the upgrade
      // topology. Resolve those relationships from client-scoped tenant result sets.
      // These reads retain the transaction's default isolation; concurrent edits
      // can become visible between queries, unlike a single-statement snapshot.
      const assignments = await scopedDb.table('client_contracts')
        .where({ client_id: clientId, is_active: true })
        .andWhere('start_date', '<=', currentDate)
        .andWhere(function() { this.whereNull('end_date').orWhere('end_date', '>', currentDate); })
        .select('contract_id', 'template_contract_id');
      const contractIds = [...new Set(assignments.map((row: any) => row.template_contract_id ?? row.contract_id).filter(Boolean))];
      if (!contractIds.length) return [];
      const contracts = await scopedDb.table('contracts').whereIn('contract_id', contractIds).select('contract_id');
      const lines = await scopedDb.table('contract_lines').whereIn('contract_id', contracts.map((row: any) => row.contract_id))
        .select('contract_id', 'contract_line_id', 'contract_line_name');
      if (!lines.length) return [];
      const pools = await scopedDb.table('contract_line_buckets').whereIn('contract_line_id', lines.map((row: any) => row.contract_line_id))
        .select('bucket_id', 'contract_line_id', 'bucket_name', 'covers_all_services', 'total_minutes');
      if (!pools.length) return [];
      const bucketIds = pools.map((row: any) => row.bucket_id);
      const members = await scopedDb.table('contract_line_bucket_services').whereIn('bucket_id', bucketIds)
        .orderBy('service_id').select('bucket_id', 'service_id');
      const services = members.length ? await scopedDb.table('service_catalog')
        .whereIn('service_id', members.map((row: any) => row.service_id)).select('service_id', 'service_name') : [];
      const usage = await scopedDb.table('bucket_usage').where({ client_id: clientId }).whereIn('bucket_id', bucketIds)
        .andWhere('period_start', '<=', currentDate).andWhere('period_end', '>', currentDate)
        .select('bucket_id', 'minutes_used', 'rolled_over_minutes', 'period_start', 'period_end');
      const groupBy = (rows: any[], key: string) => {
        const grouped = new Map<string, any[]>();
        for (const row of rows) {
          const group = grouped.get(row[key]) ?? [];
          group.push(row);
          grouped.set(row[key], group);
        }
        return grouped;
      };
      const linesByContract = groupBy(lines, 'contract_id');
      const poolsByLine = groupBy(pools, 'contract_line_id');
      const membersByPool = groupBy(members, 'bucket_id');
      const usageByPool = groupBy(usage, 'bucket_id');
      const servicesById = new Map(services.map((row: any) => [row.service_id, row]));
      const rawResults: any[] = [];
      // Preserve the previous join's assignment and matching-period multiplicity,
      // including zero-use pools and the first member's deterministic label.
      for (const assignment of assignments) {
        for (const line of linesByContract.get(assignment.template_contract_id ?? assignment.contract_id) ?? []) {
          for (const pool of poolsByLine.get(line.contract_line_id) ?? []) {
            const member = membersByPool.get(pool.bucket_id)?.[0];
            const service = servicesById.get(member?.service_id);
            const periods = usageByPool.get(pool.bucket_id) ?? [];
            for (const period of periods.length ? periods : [{ minutes_used: 0, rolled_over_minutes: 0 }]) {
              rawResults.push({
                ...line, ...pool, ...period,
                minutes_used: period.minutes_used ?? 0,
                rolled_over_minutes: period.rolled_over_minutes ?? 0,
                service_id: member?.service_id, service_name: service?.service_name,
              });
            }
          }
        }
      }

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
