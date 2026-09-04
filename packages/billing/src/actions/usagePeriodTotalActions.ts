'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import {
  IUsagePeriodTotal,
  IUsagePeriodTotalUpsert,
  UsageMeasurementMode,
} from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type UsagePeriodTotalActionError = ActionMessageError | ActionPermissionError;

/**
 * Server boundary for period-total usage reports.
 *
 * One logical total per tenant, client, contract line, service configuration,
 * and canonical service-period boundary (usage_period_totals). Writing the
 * same boundary replaces the single row — it never appends — and the DB
 * unique key is the authority: "save 10 then edit to 12" bills 12, never 22.
 *
 * Concurrency/retry contract:
 *  - An identical request_id replay returns the original row.
 *  - Reusing a request_id with different content is rejected.
 *  - An edit carrying a stale expected_revision is rejected (reload required).
 *  - An invoiced (billed) total cannot be edited, deleted, or recreated.
 *  - Additive consumption entries are rejected for period-total
 *    configurations at the usage-entry action boundary (see usageActions).
 */

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function periodTotalErrorFrom(error: unknown): UsagePeriodTotalActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied:')) {
      return permissionError(error.message);
    }
  }
  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02' || dbError?.code === '22003') {
    return actionError(
      'The reported quantity or period is invalid. Enter a whole number of 0 or more.',
    );
  }
  return null;
}

function assertQuantityIsValid(quantity: number): string | null {
  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity < 0
  ) {
    return 'Quantity must be a whole number of 0 or more.';
  }
  return null;
}

function assertPeriodIsValid(
  periodStart: string,
  periodEnd: string,
): string | null {
  if (
    typeof periodStart !== 'string' ||
    typeof periodEnd !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
  ) {
    return 'Service period boundaries must be calendar dates (YYYY-MM-DD).';
  }
  if (periodEnd < periodStart) {
    return 'Service period end cannot precede its start.';
  }
  return null;
}

function normalizeBoundaryForComparison(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function assertSameContent(a: IUsagePeriodTotal, data: IUsagePeriodTotalUpsert): boolean {
  return (
    a.client_id === data.client_id &&
    a.client_contract_line_id === data.client_contract_line_id &&
    a.service_id === data.service_id &&
    a.config_id === data.config_id &&
    normalizeBoundaryForComparison(a.period_start) ===
      normalizeBoundaryForComparison(data.period_start) &&
    normalizeBoundaryForComparison(a.period_end) ===
      normalizeBoundaryForComparison(data.period_end) &&
    Number(a.quantity) === Number(data.quantity)
  );
}

/**
 * Loads and validates the usage configuration targeted by a period-total write
 * under the current tenant:
 *   - the config exists, belongs to the contract line and service, and is a
 *     Usage configuration in period_total measurement mode;
 *   - the service is a member of the contract line;
 *   - the contract line is assigned to the client (client_contracts).
 */
async function resolvePeriodTotalScope(params: {
  trx: Knex.Transaction;
  tenant: string;
  data: IUsagePeriodTotalUpsert;
}): Promise<{ config: { config_id: string; measurement_mode: UsageMeasurementMode | null } } | { error: string }> {
  const { trx, tenant, data } = params;

  const config = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
    .where({
      config_id: data.config_id,
      contract_line_id: data.client_contract_line_id,
      service_id: data.service_id,
      configuration_type: 'Usage',
      tenant,
    })
    .first<{ config_id: string }>('config_id');
  if (!config) {
    return { error: 'The selected service configuration is not a Usage configuration on that contract line.' };
  }

  const usageConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
    .where({ config_id: data.config_id, tenant })
    .first<{ measurement_mode: UsageMeasurementMode | null }>('measurement_mode');
  const measurementMode = usageConfig?.measurement_mode ?? 'additive';
  if (measurementMode !== 'period_total') {
    return {
      error:
        'This service is configured for additive consumption, not period totals. Record consumption entries instead of a period count.',
    };
  }

  const membership = await tenantScopedTable(trx, tenant, 'contract_line_services')
    .where({ contract_line_id: data.client_contract_line_id, service_id: data.service_id, tenant })
    .first('service_id');
  if (!membership) {
    return { error: 'The service is not part of that contract line.' };
  }

  const line = await tenantScopedTable(trx, tenant, 'contract_lines')
    .where({ contract_line_id: data.client_contract_line_id, tenant })
    .first<{ contract_id: string | null }>('contract_id');
  if (!line?.contract_id) {
    return { error: 'The contract line is not attached to a contract.' };
  }
  const assignment = await tenantScopedTable(trx, tenant, 'client_contracts')
    .where({ client_id: data.client_id, contract_id: line.contract_id, tenant })
    .first('client_contract_id');
  if (!assignment) {
    return { error: 'The contract line is not assigned to the selected client.' };
  }

  return { config: { config_id: data.config_id, measurement_mode: measurementMode } };
}

export interface IUsagePeriodTotalUpsertResult {
  total: IUsagePeriodTotal;
  /** True when the write created the total; false when it replaced an existing recorded total or returned a replay. */
  replacedExisting: boolean;
}

/**
 * Create or replace the period total for a service period. See the module
 * comment for the exact concurrency and replay contract.
 */
export const upsertUsagePeriodTotal = withAuth(
  async (
    user,
    { tenant },
    data: IUsagePeriodTotalUpsert,
  ): Promise<IUsagePeriodTotalUpsertResult | UsagePeriodTotalActionError> => {
    if (!(await hasPermission(user, 'billing', 'create'))) {
      return permissionError('Permission denied: billing create required');
    }
    if (!data.client_id || !data.client_contract_line_id || !data.service_id || !data.config_id) {
      return actionError('Client, contract line, service, and configuration are all required.');
    }
    const quantityIssue = assertQuantityIsValid(Number(data.quantity));
    if (quantityIssue) {
      return actionError(quantityIssue);
    }
    const periodIssue = assertPeriodIsValid(String(data.period_start), String(data.period_end));
    if (periodIssue) {
      return actionError(periodIssue);
    }
    const quantity = Number(data.quantity);

    try {
      const { knex } = await createTenantKnex();
      return await knex.transaction(async (trx) => {
        const scope = await resolvePeriodTotalScope({ trx, tenant, data });
        if ('error' in scope) {
          return actionError(scope.error);
        }

        const table = () => tenantScopedTable(trx, tenant, 'usage_period_totals');

        // 1. Request-id replay: an identical replay returns the original row.
        if (data.request_id) {
          const existingByRequest = await table()
            .where({ tenant, request_id: data.request_id })
            .first<IUsagePeriodTotal | undefined>();
          if (existingByRequest) {
            if (assertSameContent(existingByRequest, data)) {
              return {
                total: existingByRequest,
                replacedExisting: false,
              };
            }
            return actionError(
              'This request id was already used for a different period total. Retrying an earlier request with changed content is not allowed; issue a new request.',
            );
          }
        }

        // 2. Logical-key replace (recorded) or immutability (billed).
        const existingByKey = await table()
          .where({
            tenant,
            client_id: data.client_id,
            client_contract_line_id: data.client_contract_line_id,
            service_id: data.service_id,
            config_id: data.config_id,
            period_start: String(data.period_start),
            period_end: String(data.period_end),
          })
          .first<IUsagePeriodTotal | undefined>();

        if (existingByKey) {
          if (existingByKey.lifecycle_state === 'billed') {
            return actionError(
              'This period total is already invoiced and cannot be edited or replaced. Adjust the resulting invoice instead.',
            );
          }
          const expectedRevision =
            data.expected_revision == null ? null : Number(data.expected_revision);
          if (expectedRevision != null && Number(existingByKey.revision) !== expectedRevision) {
            return actionError(
              `This period total was changed by someone else (revision ${existingByKey.revision}). Reload and retry your edit to replace it.`,
            );
          }
          const [updated] = await table()
            .where({
              period_total_id: existingByKey.period_total_id,
              tenant,
            })
            .where('lifecycle_state', 'recorded')
            .modify((query: Knex.QueryBuilder) => {
              if (expectedRevision != null) {
                query.where('revision', expectedRevision);
              }
            })
            .update({
              quantity,
              revision: Number(existingByKey.revision) + 1,
              ...(data.request_id ? { request_id: data.request_id } : {}),
              updated_at: trx.fn.now(),
            })
            .returning('*');
          if (!updated) {
            return actionError(
              `This period total was changed concurrently (revision ${existingByKey.revision}). Reload and retry your edit to replace it.`,
            );
          }
          return { total: updated, replacedExisting: true };
        }

        // 3. Create. A concurrent identical create loses the unique-key race
        // and is treated as the same logical total (idempotent), not an error.
        try {
          const [inserted] = await table()
            .insert({
              tenant,
              client_id: data.client_id,
              client_contract_line_id: data.client_contract_line_id,
              service_id: data.service_id,
              config_id: data.config_id,
              period_start: String(data.period_start),
              period_end: String(data.period_end),
              quantity,
              revision: 1,
              request_id: data.request_id ?? null,
              lifecycle_state: 'recorded',
              created_by: user.user_id ?? null,
            })
            .returning('*');
          return { total: inserted, replacedExisting: false };
        } catch (error) {
          const dbError = error as { code?: string };
          if (dbError?.code === '23505') {
            const concurrent = await table()
              .where({
                tenant,
                client_id: data.client_id,
                client_contract_line_id: data.client_contract_line_id,
                service_id: data.service_id,
                config_id: data.config_id,
                period_start: String(data.period_start),
                period_end: String(data.period_end),
              })
              .first<IUsagePeriodTotal | undefined>();
            if (concurrent && assertSameContent(concurrent, data)) {
              return { total: concurrent, replacedExisting: false };
            }
            return actionError(
              'A conflicting period total already exists for this service period. Reload to see it before replacing it.',
            );
          }
          throw error;
        }
      });
    } catch (error) {
      const expected = periodTotalErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);

export interface IUsagePeriodTotalFilter {
  client_id?: string;
  client_contract_line_id?: string;
  service_id?: string;
  config_id?: string;
  period_start?: string;
  period_end?: string;
  include_billed?: boolean;
}

export const getUsagePeriodTotals = withAuth(
  async (
    user,
    { tenant },
    filter: IUsagePeriodTotalFilter = {},
  ): Promise<IUsagePeriodTotal[] | UsagePeriodTotalActionError> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError('Permission denied: billing read required');
    }
    try {
      const { knex } = await createTenantKnex();
      let query = tenantScopedTable(knex, tenant, 'usage_period_totals')
        .where({ tenant });
      if (filter.client_id) query = query.where('client_id', filter.client_id);
      if (filter.client_contract_line_id) {
        query = query.where('client_contract_line_id', filter.client_contract_line_id);
      }
      if (filter.service_id) query = query.where('service_id', filter.service_id);
      if (filter.config_id) query = query.where('config_id', filter.config_id);
      if (filter.period_start) query = query.where('period_start', filter.period_start);
      if (filter.period_end) query = query.where('period_end', filter.period_end);
      if (!filter.include_billed) {
        query = query.where('lifecycle_state', 'recorded');
      }
      return (await query.orderBy('created_at', 'desc')) as unknown as IUsagePeriodTotal[];
    } catch (error) {
      const expected = periodTotalErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);

/**
 * Delete an unbilled (recorded) period total. Deleting the report returns the
 * period to unreported state; an invoiced total cannot be deleted.
 */
export const deleteUsagePeriodTotal = withAuth(
  async (
    user,
    { tenant },
    params: { period_total_id: string; expected_revision?: number | null },
  ): Promise<void | UsagePeriodTotalActionError> => {
    if (!(await hasPermission(user, 'billing', 'delete'))) {
      return permissionError('Permission denied: billing delete required');
    }
    try {
      const { knex } = await createTenantKnex();
      const result = await knex.transaction(async (trx) => {
        const existing = await tenantScopedTable(trx, tenant, 'usage_period_totals')
          .where({ period_total_id: params.period_total_id, tenant })
          .first<IUsagePeriodTotal | undefined>();
        if (!existing) {
          return actionError('The period total no longer exists. It may have been deleted already.');
        }
        if (existing.lifecycle_state === 'billed') {
          return actionError(
            'This period total is already invoiced and cannot be deleted. Adjust the resulting invoice instead.',
          );
        }
        if (
          params.expected_revision != null &&
          Number(existing.revision) !== Number(params.expected_revision)
        ) {
          return actionError(
            `This period total was changed by someone else (revision ${existing.revision}). Reload and retry.`,
          );
        }
        const deletedCount = await tenantScopedTable(trx, tenant, 'usage_period_totals')
          .where({ period_total_id: params.period_total_id, tenant })
          .where('lifecycle_state', 'recorded')
          .delete();
        if (deletedCount !== 1) {
          return actionError('The period total could not be deleted because it is already invoiced.');
        }
        return undefined;
      });
      if (result && 'actionError' in result) {
        return result;
      }
      revalidatePath('/msp/billing');
    } catch (error) {
      const expected = periodTotalErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);
