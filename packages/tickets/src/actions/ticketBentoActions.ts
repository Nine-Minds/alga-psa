'use server';

import type { Knex } from 'knex';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export interface TicketScheduleEntrySummary {
  entryId: string;
  title: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: string | null;
  assignedUserNames: string[];
  isUpcoming: boolean;
}

export interface TicketInteractionSummary {
  interactionId: string;
  title: string | null;
  typeName: string | null;
  interactionDate: string;
  durationMinutes: number | null;
  actorDisplayName: string | null;
}

export interface TicketBillingRollup {
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  uninvoicedBillableMinutes: number;
  contractName: string | null;
}

type TicketBillingRollupTotals = Omit<TicketBillingRollup, 'contractName'>;

interface TicketLookupRow {
  ticket_id: string;
  client_id: string | null;
}

function assertInternalUser(user: { user_type?: string }): void {
  if (user.user_type === 'client') {
    throw new Error('Permission denied: ticket bento data is internal-only in v1');
  }
}

async function assertCanReadTicket(
  user: Parameters<typeof hasPermission>[0],
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<TicketLookupRow> {
  if (!(await hasPermission(user, 'ticket', 'read', trx))) {
    throw new Error('Permission denied: cannot read ticket');
  }

  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first(['ticket_id', 'client_id']) as TicketLookupRow | undefined;
  if (!ticket) {
    throw new Error('Ticket not found');
  }

  return {
    ticket_id: ticket.ticket_id,
    client_id: ticket.client_id ?? null,
  };
}

function normalizeRequiredIso(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`${fieldName} is required`);
}

function normalizeNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return numericValue;
}

function normalizeNumberOrZero(value: unknown, fieldName: string): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return numericValue;
}

function toDate(value: unknown, fieldName: string): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new Error(`${fieldName} must be a valid date`);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  return [];
}

function isInvoiced(value: unknown): boolean {
  return value === true || value === 'true' || value === 't';
}

function workedMinutes(row: Record<string, unknown>): number {
  if (row.start_time !== null && row.start_time !== undefined && row.end_time !== null && row.end_time !== undefined) {
    const start = toDate(row.start_time, 'time_entries.start_time');
    const end = toDate(row.end_time, 'time_entries.end_time');
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  return normalizeNumberOrZero(row.billable_duration, 'time_entries.billable_duration');
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 10;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive integer');
  }
  return limit;
}

export const getTicketScheduleEntries = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
  ): Promise<TicketScheduleEntrySummary[]> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!ticketId) {
      throw new Error('ticketId required');
    }

    assertInternalUser(user as { user_type?: string });

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCanReadTicket(user, trx, tenant, ticketId);

      const now = new Date();
      const query = tenantScopedTable(trx, 'schedule_entries as se', tenant)
        .where({
          'se.work_item_id': ticketId,
          'se.work_item_type': 'ticket',
        })
        .select(
          'se.entry_id',
          'se.title',
          'se.scheduled_start',
          'se.scheduled_end',
          'se.status',
          trx.raw(
            "COALESCE(array_remove(array_agg(DISTINCT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, ''))), ''), NULLIF(u.username, ''))), NULL), ARRAY[]::text[]) AS assigned_user_names",
          ),
        )
        .groupBy('se.entry_id', 'se.title', 'se.scheduled_start', 'se.scheduled_end', 'se.status')
        .orderByRaw('CASE WHEN se.scheduled_end >= ? THEN 0 ELSE 1 END ASC', [now])
        .orderByRaw('CASE WHEN se.scheduled_end >= ? THEN se.scheduled_start END ASC', [now])
        .orderByRaw('CASE WHEN se.scheduled_end < ? THEN se.scheduled_start END DESC', [now])
        .limit(10);

      const facade = tenantDb(trx, tenant);
      facade.tenantJoin(query, 'schedule_entry_assignees as sea', 'se.entry_id', 'sea.entry_id', { type: 'left' });
      facade.tenantJoin(query, 'users as u', 'sea.user_id', 'u.user_id', { type: 'left' });

      const rows = (await query) as Array<Record<string, unknown>>;
      return rows.map((row) => {
        const scheduledStart = normalizeRequiredIso(row.scheduled_start, 'schedule_entries.scheduled_start');
        const scheduledEnd = normalizeRequiredIso(row.scheduled_end, 'schedule_entries.scheduled_end');

        return {
          entryId: row.entry_id as string,
          title: (row.title as string | null) ?? null,
          scheduledStart,
          scheduledEnd,
          status: (row.status as string | null) ?? null,
          assignedUserNames: toStringArray(row.assigned_user_names),
          isUpcoming: toDate(scheduledEnd, 'schedule_entries.scheduled_end').getTime() >= now.getTime(),
        };
      });
    });
  },
);

export const getTicketInteractions = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
    opts?: { limit?: number },
  ): Promise<TicketInteractionSummary[]> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!ticketId) {
      throw new Error('ticketId required');
    }

    assertInternalUser(user as { user_type?: string });
    const limit = validateLimit(opts?.limit);

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCanReadTicket(user, trx, tenant, ticketId);

      const query = tenantScopedTable(trx, 'interactions as i', tenant)
        .where('i.ticket_id', ticketId)
        .orderBy('i.interaction_date', 'desc')
        .limit(limit)
        .select(
          'i.interaction_id',
          'i.title',
          'i.interaction_date',
          'i.duration',
          trx.raw('COALESCE(it.type_name, sit.type_name) AS type_name'),
          trx.raw(
            "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, ''))), ''), NULLIF(u.username, ''), NULLIF(c.full_name, '')) AS actor_display_name",
          ),
        );

      const facade = tenantDb(trx, tenant);
      facade.tenantJoin(query, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
      facade.tenantJoin(query, 'system_interaction_types as sit', 'i.type_id', 'sit.type_id', { type: 'left' });
      facade.tenantJoin(query, 'users as u', 'i.user_id', 'u.user_id', { type: 'left' });
      facade.tenantJoin(query, 'contacts as c', 'i.contact_name_id', 'c.contact_name_id', { type: 'left' });

      const rows = (await query) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        interactionId: row.interaction_id as string,
        title: (row.title as string | null) ?? null,
        typeName: (row.type_name as string | null) ?? null,
        interactionDate: normalizeRequiredIso(row.interaction_date, 'interactions.interaction_date'),
        durationMinutes: normalizeNullableNumber(row.duration, 'interactions.duration'),
        actorDisplayName: (row.actor_display_name as string | null) ?? null,
      }));
    });
  },
);

export const getTicketBillingRollup = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
  ): Promise<TicketBillingRollup> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!ticketId) {
      throw new Error('ticketId required');
    }

    assertInternalUser(user as { user_type?: string });

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const ticket = await assertCanReadTicket(user, trx, tenant, ticketId);

      const timeEntryRows = (await tenantScopedTable(trx, 'time_entries', tenant)
        .where({
          work_item_id: ticketId,
          work_item_type: 'ticket',
        })
        .select('entry_id', 'start_time', 'end_time', 'billable_duration', 'invoiced')) as Array<Record<string, unknown>>;

      const rollup = timeEntryRows.reduce<TicketBillingRollupTotals>(
        (acc, row) => {
          const billableDuration = normalizeNumberOrZero(row.billable_duration, 'time_entries.billable_duration');
          acc.totalMinutes += workedMinutes(row);
          acc.billableMinutes += billableDuration;
          acc.entryCount += 1;
          if (!isInvoiced(row.invoiced)) {
            acc.uninvoicedBillableMinutes += billableDuration;
          }
          return acc;
        },
        {
          totalMinutes: 0,
          billableMinutes: 0,
          entryCount: 0,
          uninvoicedBillableMinutes: 0,
        },
      );

      let contractName: string | null = null;
      if (ticket.client_id) {
        const contractQuery = tenantScopedTable(trx, 'client_contracts as cc', tenant)
          .where({
            'cc.client_id': ticket.client_id,
            'cc.is_active': true,
          })
          .andWhere('c.status', 'active')
          .select('c.contract_name')
          // Multiple active contracts can exist; v1 uses the newest contract row.
          .orderBy('c.created_at', 'desc')
          .orderBy('c.contract_id', 'desc')
          .first();
        tenantDb(trx, tenant).tenantJoin(contractQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');

        const activeContract = await contractQuery as { contract_name?: string | null } | undefined;
        contractName = activeContract?.contract_name ?? null;
      }

      return {
        ...rollup,
        contractName,
      };
    });
  },
);

/**
 * Name of the SLA policy applied to a ticket, for the "SLA clocks" tile
 * header. Returns null when no policy applies.
 */
export const getTicketSlaPolicyName = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
  ): Promise<{ policyName: string | null }> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!ticketId) {
      throw new Error('ticketId required');
    }

    assertInternalUser(user as { user_type?: string });

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCanReadTicket(user, trx, tenant, ticketId);

      const row = await tenantScopedTable(trx, 'tickets as t', tenant)
        .where({ 't.ticket_id': ticketId })
        .whereNotNull('t.sla_policy_id')
        .join('sla_policies as sp', function joinPolicies() {
          this.on('sp.sla_policy_id', 't.sla_policy_id').andOn('sp.tenant', 't.tenant');
        })
        .first(['sp.policy_name']) as { policy_name: string | null } | undefined;

      return { policyName: row?.policy_name ?? null };
    });
  },
);
