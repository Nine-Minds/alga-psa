import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ISlaPolicy, ISlaPolicyTarget, IBusinessHoursScheduleWithEntries } from '@alga-psa/types';

export type ResolvedSlaPolicy = ISlaPolicy & { targets: ISlaPolicyTarget[] };

function tenantScopedTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/**
 * Resolve which SLA policy applies to a ticket.
 * Priority: Client > Board > Tenant Default
 */
export async function resolveSlaPolicy(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string | null,
  boardId: string | null
): Promise<ResolvedSlaPolicy | null> {
  // 1. Check client-specific policy
  if (clientId) {
    const client = await tenantScopedTable(trx, tenant, 'clients')
      .where('client_id', clientId)
      .select('sla_policy_id')
      .first();

    if (client?.sla_policy_id) {
      const policy = await getSlaPolicyWithTargets(trx, tenant, client.sla_policy_id);
      if (policy) return policy;
    }
  }

  // 2. Check board-specific policy
  if (boardId) {
    const board = await tenantScopedTable(trx, tenant, 'boards')
      .where('board_id', boardId)
      .select('sla_policy_id')
      .first();

    if (board?.sla_policy_id) {
      const policy = await getSlaPolicyWithTargets(trx, tenant, board.sla_policy_id);
      if (policy) return policy;
    }
  }

  // 3. Fall back to tenant default
  const defaultPolicy = await tenantScopedTable(trx, tenant, 'sla_policies')
    .where('is_default', true)
    .first();

  if (defaultPolicy) {
    return getSlaPolicyWithTargets(trx, tenant, defaultPolicy.sla_policy_id);
  }

  return null;
}

/**
 * Get an SLA policy with its targets.
 */
export async function getSlaPolicyWithTargets(
  trx: Knex | Knex.Transaction,
  tenant: string,
  policyId: string
): Promise<ResolvedSlaPolicy | null> {
  const policy = await tenantScopedTable(trx, tenant, 'sla_policies')
    .where('sla_policy_id', policyId)
    .first();

  if (!policy) return null;

  const targets = await tenantScopedTable(trx, tenant, 'sla_policy_targets')
    .where('sla_policy_id', policyId);

  return {
    ...policy,
    targets
  };
}

/**
 * Get the business hours schedule for an SLA policy/target.
 */
export async function getBusinessHoursSchedule(
  trx: Knex | Knex.Transaction,
  tenant: string,
  policy: ISlaPolicy,
  target: ISlaPolicyTarget
): Promise<IBusinessHoursScheduleWithEntries> {
  // If target is 24x7, return a 24x7 schedule
  if (target.is_24x7) {
    return {
      tenant,
      schedule_id: '24x7',
      schedule_name: '24x7',
      timezone: 'UTC',
      is_default: false,
      is_24x7: true,
      entries: [],
      holidays: []
    };
  }

  // Get schedule from policy
  if (policy.business_hours_schedule_id) {
    const schedule = await tenantScopedTable(trx, tenant, 'business_hours_schedules')
      .where('schedule_id', policy.business_hours_schedule_id)
      .first();

    if (schedule) {
      const entries = await tenantScopedTable(trx, tenant, 'business_hours_entries')
        .where('schedule_id', schedule.schedule_id);

      const holidays = await tenantScopedTable(trx, tenant, 'holidays')
        .where(function() {
          this.whereNull('schedule_id')
            .orWhere('schedule_id', schedule.schedule_id);
        });

      return {
        ...schedule,
        entries,
        holidays
      };
    }
  }

  // Fall back to default schedule
  const defaultSchedule = await tenantScopedTable(trx, tenant, 'business_hours_schedules')
    .where('is_default', true)
    .first();

  if (defaultSchedule) {
    const entries = await tenantScopedTable(trx, tenant, 'business_hours_entries')
      .where('schedule_id', defaultSchedule.schedule_id);

    const holidays = await tenantScopedTable(trx, tenant, 'holidays')
      .where(function() {
        this.whereNull('schedule_id')
          .orWhere('schedule_id', defaultSchedule.schedule_id);
      });

    return {
      ...defaultSchedule,
      entries,
      holidays
    };
  }

  // Ultimate fallback: 24x7
  return {
    tenant,
    schedule_id: '24x7-fallback',
    schedule_name: '24x7 (Fallback)',
    timezone: 'UTC',
    is_default: false,
    is_24x7: true,
    entries: [],
    holidays: []
  };
}

