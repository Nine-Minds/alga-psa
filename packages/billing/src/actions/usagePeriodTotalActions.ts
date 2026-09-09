'use server';

import { Knex } from 'knex';
import { resolveUsageMeasurementRevision } from '../lib/billing/usageMeasurementTransitions';
import { BillingEngine } from '../lib/billing/billingEngine';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';
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

/** Content a request id was originally consumed with (usage_period_total_requests row). */
interface IUsagePeriodTotalRequestRow {
  request_id: string;
  client_id: string;
  client_contract_line_id: string;
  service_id: string;
  config_id: string;
  period_start: unknown;
  period_end: unknown;
  quantity: number;
}

function requestMatchesUpsert(row: IUsagePeriodTotalRequestRow, data: IUsagePeriodTotalUpsert): boolean {
  return (
    row.client_id === data.client_id &&
    row.client_contract_line_id === data.client_contract_line_id &&
    row.service_id === data.service_id &&
    row.config_id === data.config_id &&
    normalizeBoundaryForComparison(row.period_start) ===
      normalizeBoundaryForComparison(data.period_start) &&
    normalizeBoundaryForComparison(row.period_end) ===
      normalizeBoundaryForComparison(data.period_end) &&
    Number(row.quantity) === Number(data.quantity)
  );
}

/**
 * Preserves a consumed request id and its exact content in the durable
 * history. Returns false when another writer consumed the id concurrently
 * (the conflict is ignored, so the transaction stays healthy).
 */
async function recordConsumedRequest(params: {
  requestHistory: () => Knex.QueryBuilder;
  tenant: string;
  data: IUsagePeriodTotalUpsert;
  quantity: number;
}): Promise<boolean> {
  const { requestHistory, tenant, data, quantity } = params;
  const [recorded] = await requestHistory()
    .insert({
      tenant,
      request_id: data.request_id,
      client_id: data.client_id,
      client_contract_line_id: data.client_contract_line_id,
      service_id: data.service_id,
      config_id: data.config_id,
      period_start: String(data.period_start),
      period_end: String(data.period_end),
      quantity,
    })
    .onConflict()
    .ignore()
    .returning('request_id');
  return Boolean(recorded);
}

/**
 * Loads and validates the usage configuration targeted by a period-total write
 * under the current tenant:
 *   - the config exists, belongs to the contract line and service, and is a
 *     Usage configuration in period_total measurement mode;
 *   - the service is a member of the contract line;
 *   - the contract line is assigned to the client (client_contracts), the
 *     assignment is active, and it is effective for the reported period;
 *   - the reported period is a canonical materialized service-period boundary
 *     for the contract line (recurring_service_periods), never a free-hand
 *     date range that billing would silently ignore.
 */
async function resolvePeriodTotalScope(params: {
  trx: Knex.Transaction;
  tenant: string;
  data: IUsagePeriodTotalUpsert;
  allowAdditive?: boolean;
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
  const revision = await resolveUsageMeasurementRevision(trx, tenant, data.config_id, String(data.period_start));
  const measurementMode = revision?.measurement_mode ?? usageConfig?.measurement_mode ?? 'additive';
  if (measurementMode !== 'period_total' && !params.allowAdditive) {
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
    .where({ client_id: data.client_id, contract_id: line.contract_id, tenant, is_active: true })
    .where('start_date', '<=', String(data.period_start))
    .andWhere(query => query.whereNull('end_date').orWhere('end_date', '>=', String(data.period_start)))
    .first<{ client_contract_id: string; is_active: boolean | null; start_date: unknown; end_date: unknown }>(
      'client_contract_id',
      'is_active',
      'start_date',
      'end_date',
    );
  if (!assignment) {
    return { error: 'The contract line has no active, effective assignment to the selected client for this period.' };
  }
  if (assignment.is_active !== true) {
    return { error: 'The contract assignment for this client is not active, so usage cannot be reported against it.' };
  }
  const periodStartDay = normalizeBoundaryForComparison(data.period_start);
  const assignmentStartDay = normalizeBoundaryForComparison(assignment.start_date);
  const assignmentEndDay = assignment.end_date == null ? null : normalizeBoundaryForComparison(assignment.end_date);
  if (assignmentStartDay > periodStartDay || (assignmentEndDay != null && assignmentEndDay < periodStartDay)) {
    return {
      error: `The contract assignment is not effective for the service period starting ${periodStartDay}. Report usage only for periods the assignment covers.`,
    };
  }

  if (!(await BillingEngine.forTransaction(trx, tenant).isCanonicalUsagePeriod(
    data.client_id, data.client_contract_line_id, String(data.period_start), String(data.period_end),
  ))) {
    return { error: 'The reported period is not an eligible canonical service period. Reload the invoice preview and use its service period.' };
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
        await lockTenantBilling(trx, tenant);
        const scope = await resolvePeriodTotalScope({ trx, tenant, data });
        if ('error' in scope) {
          return actionError(scope.error);
        }

        const table = () => tenantScopedTable(trx, tenant, 'usage_period_totals');
        const requestHistory = () => tenantScopedTable(trx, tenant, 'usage_period_total_requests');
        const currentByLogicalKey = () =>
          table()
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

        // 1. Request-id replay against the durable request history. Every
        // consumed request id is preserved forever (the live row keeps only
        // the latest), so replaying request A after edit B — or after a
        // delete + re-report — can never restore A's content: an identical
        // replay is acknowledged without mutating anything, and reusing an id
        // with different content is rejected.
        if (data.request_id) {
          const consumedRequest = await requestHistory()
            .where({ tenant, request_id: data.request_id })
            .first<IUsagePeriodTotalRequestRow | undefined>();
          if (consumedRequest) {
            if (!requestMatchesUpsert(consumedRequest, data)) {
              return actionError(
                'This request id was already used for a different period total. Retrying an earlier request with changed content is not allowed; issue a new request.',
              );
            }
            const current = await currentByLogicalKey();
            if (current) {
              return { total: current, replacedExisting: false };
            }
            return actionError(
              'This request was already applied, and the resulting period total was later replaced or deleted. Reload to see the current state; replaying the old request cannot restore it.',
            );
          }

          // Pre-history rows carry a request id only on the live row. A hit
          // here without history is still a consumed id: identical content is
          // acknowledged, changed content is rejected.
          const liveByRequest = await table()
            .where({ tenant, request_id: data.request_id })
            .first<IUsagePeriodTotal | undefined>();
          if (liveByRequest) {
            if (assertSameContent(liveByRequest, data)) {
              return { total: liveByRequest, replacedExisting: false };
            }
            return actionError(
              'This request id was already used for a different period total. Retrying an earlier request with changed content is not allowed; issue a new request.',
            );
          }
        }

        // 2. Logical-key replace (recorded) or immutability (billed).
        const existingByKey = await currentByLogicalKey();

        if (existingByKey) {
          if (existingByKey.lifecycle_state === 'billed') {
            return actionError(
              'This period total is already invoiced and cannot be edited or replaced. Adjust the resulting invoice instead.',
            );
          }
          if (data.expected_revision != null && Number(existingByKey.revision) !== Number(data.expected_revision)) {
            return actionError('This period total was changed by someone else. Reload and retry with its current revision.');
          }
          // Preserve the last pre-migration request before replacing the live id.
          if (existingByKey.request_id) {
            await recordConsumedRequest({ requestHistory, tenant, data: {
              ...existingByKey,
              period_start: normalizeBoundaryForComparison(existingByKey.period_start),
              period_end: normalizeBoundaryForComparison(existingByKey.period_end),
            }, quantity: Number(existingByKey.quantity) });
          }
          // An identical write against an identical stored total is a
          // convergent duplicate (e.g. two operators reporting the same
          // number, or a lost create race resolved after the winner
          // committed): acknowledge it without mutating anything.
          if (assertSameContent(existingByKey, data)) {
            if (data.request_id) {
              await recordConsumedRequest({ requestHistory, tenant, data, quantity });
            }
            return { total: existingByKey, replacedExisting: false };
          }
          // Replacing an existing report with DIFFERENT content requires
          // proof the writer saw it: the expected revision. A blind overwrite
          // (no revision) is rejected so an operator who did not know a
          // report exists cannot silently replace someone else's number.
          const expectedRevision =
            data.expected_revision == null ? null : Number(data.expected_revision);
          if (expectedRevision == null || !data.request_id) {
            return actionError(
              `A period total already exists for this service period (quantity ${existingByKey.quantity}, revision ${existingByKey.revision}). Reload it and retry your edit with that revision to replace it.`,
            );
          }
          if (Number(existingByKey.revision) !== expectedRevision) {
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
            .where('revision', expectedRevision)
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
          if (data.request_id) {
            const recorded = await recordConsumedRequest({ requestHistory, tenant, data, quantity });
            if (!recorded) {
              throw new Error('Request history conflict; the period total write was rolled back.');
            }
          }
          return { total: updated, replacedExisting: true };
        }

        // 3. Create. ON CONFLICT DO NOTHING keeps the transaction healthy on
        // a lost race (no aborted-transaction reads); the loser then reads
        // the winner's row and reconciles instead of erroring blindly.
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
          .onConflict()
          .ignore()
          .returning('*');
        if (inserted) {
          if (data.request_id) {
            const recorded = await recordConsumedRequest({ requestHistory, tenant, data, quantity });
            if (!recorded) {
              throw new Error('Request history conflict; the period total write was rolled back.');
            }
          }
          return { total: inserted, replacedExisting: false };
        }

        // The insert was skipped: either the logical key or the request id
        // already exists. Reconcile against the winner.
        const concurrent = await currentByLogicalKey();
        if (concurrent && assertSameContent(concurrent, data)) {
          return { total: concurrent, replacedExisting: false };
        }
        if (concurrent) {
          return actionError(
            'A conflicting period total already exists for this service period. Reload to see it before replacing it.',
          );
        }
        return actionError(
          'This request id was already used by another write. Reload and retry with a new request.',
        );
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
 * period to unreported state; an invoiced total cannot be deleted. The caller
 * must pass the revision it reviewed — a blind delete (no revision, or a stale
 * one) is rejected so a report someone else just corrected cannot vanish. The
 * request history is deliberately kept: replaying the request that created the
 * deleted total cannot recreate it.
 */
export const deleteUsagePeriodTotal = withAuth(
  async (
    user,
    { tenant },
    params: { period_total_id: string; expected_revision: number },
  ): Promise<void | UsagePeriodTotalActionError> => {
    if (!(await hasPermission(user, 'billing', 'delete'))) {
      return permissionError('Permission denied: billing delete required');
    }
    if (params.expected_revision == null || !Number.isFinite(Number(params.expected_revision))) {
      return actionError('Deleting a period total requires the revision you reviewed. Reload and retry.');
    }
    try {
      const { knex } = await createTenantKnex();
      const result = await knex.transaction(async (trx) => {
        await lockTenantBilling(trx, tenant);
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
        if (Number(existing.revision) !== Number(params.expected_revision)) {
          return actionError(
            `This period total was changed by someone else (revision ${existing.revision}). Reload and retry.`,
          );
        }
        // Live reports predating request history still own their last request ID.
        // Preserve that known identity in the same transaction as deletion.
        if (existing.request_id) {
          await recordConsumedRequest({
            requestHistory: () => tenantScopedTable(trx, tenant, 'usage_period_total_requests'),
            tenant,
            data: {
              ...existing,
              period_start: normalizeBoundaryForComparison(existing.period_start),
              period_end: normalizeBoundaryForComparison(existing.period_end),
            },
            quantity: Number(existing.quantity),
          });
        }
        const deletedCount = await tenantScopedTable(trx, tenant, 'usage_period_totals')
          .where({ period_total_id: params.period_total_id, tenant })
          .where('lifecycle_state', 'recorded')
          .where('revision', Number(params.expected_revision))
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

/** Contextual form read validates the same assignment/period as a write. */
export const getUsagePeriodEntryContext = withAuth(async (user, {tenant}, data: Omit<IUsagePeriodTotalUpsert, 'quantity'>) => {
  if (!(await hasPermission(user, 'billing', 'read'))) return permissionError('Permission denied: billing read required');
  const {knex} = await createTenantKnex();
  return knex.transaction(async trx => {
    const scope = await resolvePeriodTotalScope({trx, tenant, data: {...data, quantity: 0}, allowAdditive: true});
    if ('error' in scope) return actionError(scope.error);
    const total = await tenantScopedTable(trx, tenant, 'usage_period_totals').where({
      client_id: data.client_id, client_contract_line_id: data.client_contract_line_id,
      service_id: data.service_id, config_id: data.config_id,
      period_start: data.period_start, period_end: data.period_end,
    }).first<IUsagePeriodTotal>();
    return { measurement_mode: scope.config.measurement_mode, total: total ?? null };
  });
});
