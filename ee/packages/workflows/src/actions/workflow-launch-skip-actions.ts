'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import {
  GetWorkflowLaunchSkipSummaryInput,
  ListEventLaunchSkipsInput,
  ListWorkflowLaunchSkipCountsInput,
  ListWorkflowLaunchSkipsPagedInput
} from './workflow-runtime-v2-schemas';
import { workflowTenantTable } from '../lib/workflowTenantDb';

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const throwHttpError = (status: number, message: string): never => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
};

// LEVERAGE: pattern workflow-require-permission — third copy (runtime-v2 and schedule-v2 actions have their own); extract a shared workflow permission guard.
const requireWorkflowPermission = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any,
  action: 'read',
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  if (await hasPermission(user, 'workflow', action, knex)) return;
  const fallback = await Promise.all([
    hasPermission(user, 'workflow', 'view', knex),
    hasPermission(user, 'workflow', 'manage', knex),
    hasPermission(user, 'workflow', 'admin', knex)
  ]);
  if (fallback.some(Boolean)) return;
  throwHttpError(403, 'Forbidden');
};

const SKIPS_TABLE = 'workflow_event_launch_skips';

export type WorkflowLaunchSkipReasonSummary = {
  reason: string;
  count: number;
  lastSkippedAt: string | null;
};

export type WorkflowLaunchSkipGroupSummary = {
  total: number;
  lastSkippedAt: string | null;
  byReason: WorkflowLaunchSkipReasonSummary[];
};

export type WorkflowLaunchSkipSummary = {
  from: string;
  alarming: WorkflowLaunchSkipGroupSummary;
  intentional: WorkflowLaunchSkipGroupSummary;
};

export type WorkflowLaunchSkipListItem = {
  skipId: string;
  eventId: string;
  eventName: string;
  eventDisplayName: string;
  reason: string;
  intentional: boolean;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export type EventLaunchSkipItem = {
  workflowName: string | null;
  workflowKey: string | null;
  reason: string;
  intentional: boolean;
  message: string;
  details: Record<string, unknown> | null;
};

const toIso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
};

const resolveFrom = (from?: string): string => from ?? new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();

/** Per-workflow skip counts for the window, split into alarming and intentional. */
export const getWorkflowLaunchSkipSummaryAction = withAuth(async (
  user,
  { tenant },
  input: unknown
): Promise<WorkflowLaunchSkipSummary> => {
  const parsed = GetWorkflowLaunchSkipSummaryInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const from = resolveFrom(parsed.from);

  const rows = await workflowTenantTable(knex, tenant, SKIPS_TABLE)
    .where({ workflow_id: parsed.workflowId })
    .where('created_at', '>=', from)
    .groupBy('reason', 'intentional')
    .select('reason', 'intentional')
    .count('* as count')
    .max('created_at as last_skipped_at');

  const emptyGroup = (): WorkflowLaunchSkipGroupSummary => ({ total: 0, lastSkippedAt: null, byReason: [] });
  const summary: WorkflowLaunchSkipSummary = { from, alarming: emptyGroup(), intentional: emptyGroup() };

  for (const row of rows as Array<{ reason: string; intentional: boolean; count: string | number; last_skipped_at: unknown }>) {
    const group = row.intentional ? summary.intentional : summary.alarming;
    const count = Number(row.count);
    const last = toIso(row.last_skipped_at);
    group.total += count;
    if (last && (!group.lastSkippedAt || last > group.lastSkippedAt)) group.lastSkippedAt = last;
    group.byReason.push({ reason: row.reason, count, lastSkippedAt: last });
  }
  for (const group of [summary.alarming, summary.intentional]) {
    group.byReason.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  }
  return summary;
});

/** Server-side paged drill-down of skips for one workflow. */
export const listWorkflowLaunchSkipsPagedAction = withAuth(async (
  user,
  { tenant },
  input: unknown
): Promise<{ items: WorkflowLaunchSkipListItem[]; totalItems: number }> => {
  const parsed = ListWorkflowLaunchSkipsPagedInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const from = resolveFrom(parsed.from);

  const query = workflowTenantTable(knex, tenant, SKIPS_TABLE)
    .where({ workflow_id: parsed.workflowId })
    .where('created_at', '>=', from);
  if (parsed.to) query.where('created_at', '<=', parsed.to);
  if (parsed.reason) query.where({ reason: parsed.reason });
  if (parsed.intentional !== undefined) query.where({ intentional: parsed.intentional });

  const countRow = await query.clone().clearSelect().clearOrder().count('* as count').first();
  const totalItems = Number((countRow as { count?: string | number } | undefined)?.count ?? 0);

  const rows = await query
    .clone()
    .select('skip_id', 'event_id', 'event_name', 'reason', 'intentional', 'message', 'details', 'created_at')
    .orderBy('created_at', 'desc')
    .orderBy('skip_id', 'desc')
    .limit(parsed.pageSize)
    .offset((parsed.page - 1) * parsed.pageSize);

  const eventNames = Array.from(new Set((rows as Array<{ event_name: string }>).map((r) => r.event_name)));
  const displayNames = await resolveEventDisplayNames(knex, tenant, eventNames);

  const items = (rows as Array<Record<string, any>>).map((row) => ({
    skipId: row.skip_id as string,
    eventId: row.event_id as string,
    eventName: row.event_name as string,
    eventDisplayName: displayNames.get(row.event_name) ?? (row.event_name as string),
    reason: row.reason as string,
    intentional: Boolean(row.intentional),
    message: row.message as string,
    details: (row.details ?? null) as Record<string, unknown> | null,
    createdAt: toIso(row.created_at) as string
  }));
  return { items, totalItems };
});

/** Alarming skip counts for many workflows at once (one grouped query per list load). */
export const listWorkflowLaunchSkipCountsAction = withAuth(async (
  user,
  { tenant },
  input: unknown
): Promise<Record<string, number>> => {
  const parsed = ListWorkflowLaunchSkipCountsInput.parse(input);
  if (parsed.workflowIds.length === 0) return {};
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await workflowTenantTable(knex, tenant, SKIPS_TABLE)
    .whereIn('workflow_id', parsed.workflowIds)
    .where({ intentional: false })
    .where('created_at', '>=', resolveFrom(parsed.from))
    .groupBy('workflow_id')
    .select('workflow_id')
    .count('* as count');

  const result: Record<string, number> = {};
  for (const row of rows as Array<{ workflow_id: string; count: string | number }>) {
    result[row.workflow_id] = Number(row.count);
  }
  return result;
});

/** The workflows that were not launched for one event (event detail panel). */
export const listEventLaunchSkipsAction = withAuth(async (
  user,
  { tenant },
  input: unknown
): Promise<EventLaunchSkipItem[]> => {
  const parsed = ListEventLaunchSkipsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const skips = (await workflowTenantTable(knex, tenant, SKIPS_TABLE)
    .where({ event_id: parsed.eventId })
    .select('workflow_id', 'reason', 'intentional', 'message', 'details')
    .orderBy('intentional', 'asc')
    .orderBy('created_at', 'asc')) as Array<Record<string, any>>;
  if (skips.length === 0) return [];

  const workflowIds = Array.from(new Set(skips.map((s) => s.workflow_id as string)));
  const definitions = (await workflowTenantTable(knex, tenant, 'workflow_definitions')
    .whereIn('workflow_id', workflowIds)
    .select('workflow_id', 'name', 'key')) as Array<{ workflow_id: string; name: string | null; key: string | null }>;
  const byId = new Map(definitions.map((d) => [d.workflow_id, d]));

  return skips.map((skip) => ({
    workflowName: byId.get(skip.workflow_id)?.name ?? null,
    workflowKey: byId.get(skip.workflow_id)?.key ?? null,
    reason: skip.reason as string,
    intentional: Boolean(skip.intentional),
    message: skip.message as string,
    details: (skip.details ?? null) as Record<string, unknown> | null
  }));
});

/** Event catalog display name (tenant catalog first, then the system catalog). */
async function resolveEventDisplayNames(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  eventNames: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (eventNames.length === 0) return names;

  const tenantRows = (await workflowTenantTable(knex, tenant, 'event_catalog')
    .whereIn('event_type', eventNames)
    .select('event_type', 'name')) as Array<{ event_type: string; name: string | null }>;
  for (const row of tenantRows) if (row.name) names.set(row.event_type, row.name);

  const missing = eventNames.filter((n) => !names.has(n));
  if (missing.length > 0) {
    const systemRows = (await workflowTenantTable(knex, tenant, 'system_event_catalog')
      .whereIn('event_type', missing)
      .select('event_type', 'name')) as Array<{ event_type: string; name: string | null }>;
    for (const row of systemRows) if (row.name) names.set(row.event_type, row.name);
  }
  return names;
}
