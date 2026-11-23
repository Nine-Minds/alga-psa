/**
 * describeScheduleWorkItems: the one shared resolver from a schedule entry's work item
 * (work_item_type, work_item_id) to what a human or a notification needs: a label, a title, the
 * link that opens the work, and whether the work is already done.
 *
 * Server-side only and context-free: it takes an explicit knex and tenant and needs no user or
 * session, so a background job can import it. It performs NO permission check; the link is
 * permission-checked by the page it opens, as every other link in the app is.
 *
 * Batching: a fixed number of queries per work item type regardless of how many items are asked
 * for (ticket 1, interaction 2, project_task 1, opportunity_step 1, appointment_request 1,
 * ad_hoc 0), every one tenant-scoped through tenantDb.
 *
 * Done rules (PRD R6), from the real columns:
 *   ticket               tickets.is_closed OR its status's is_closed
 *   interaction          its status (statuses via interactions.status_id) is_closed
 *   project_task         its phase status mapping resolves to a closed status
 *                        (COALESCE(statuses.is_closed, standard_statuses.is_closed), the same
 *                        resolution the project task link reads use)
 *   appointment_request  status <> 'approved' (CHECK: pending | approved | declined | cancelled)
 *   opportunity_step     status 'done' or 'skipped' (CHECK: planned | current | done | skipped)
 *   ad_hoc               never done here: the entry's own status is the caller's (R2) concern
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { buildAppointmentRequestReviewPath, buildScheduleEntryLink } from '@alga-psa/core';
import { recordPath } from '@alga-psa/types';

export type ScheduleWorkItemType =
  | 'ticket'
  | 'interaction'
  | 'project_task'
  | 'opportunity_step'
  | 'appointment_request'
  | 'ad_hoc';

export interface ScheduleWorkItemRef {
  work_item_type: ScheduleWorkItemType | string;
  /** Null/absent for ad_hoc entries, which have no work item row. */
  work_item_id?: string | null;
  /**
   * The schedule entry the work item came from. Needed to link the types whose destination is
   * the entry itself (ad_hoc, interaction without a ticket) and used as the title of an ad_hoc.
   */
  entry_id?: string | null;
  entry_title?: string | null;
  /** Occurrence start of a recurring entry, carried into the schedule deep link. */
  occurrence?: Date | string | null;
}

interface DescribedBase {
  workItemType: string;
  /** The key of the ref this was resolved from; see scheduleWorkItemKey. */
  key: string;
}

export interface FoundScheduleWorkItem extends DescribedBase {
  missing: false;
  /**
   * User-facing type label in English. Interactions carry the tenant-defined interaction type
   * name (data, not a translatable string) and have no labelKey. Everything else also carries a
   * `labelKey` in the `msp/schedule` i18n namespace so the caller can localize per recipient.
   */
  label: string;
  labelKey?: string;
  title: string;
  /** App-relative link that opens the work. */
  link: string;
  /** The ticket this work belongs to, when it has one. */
  ticketId?: string;
  done: boolean;
}

export interface MissingScheduleWorkItem extends DescribedBase {
  missing: true;
}

export type ScheduleWorkItemDescriptor = FoundScheduleWorkItem | MissingScheduleWorkItem;

/** Lookup key for a ref: `${type}:${work_item_id}`; ad_hoc without a work item id uses its entry id. */
export function scheduleWorkItemKey(
  workItemType: string,
  workItemId: string | null | undefined,
  entryId?: string | null,
): string {
  return `${workItemType}:${workItemId ?? entryId ?? ''}`;
}

const LABELS: Record<string, { label: string; labelKey: string }> = {
  ticket: { label: 'Ticket', labelKey: 'calendar.legend.types.ticket' },
  project_task: { label: 'Project task', labelKey: 'calendar.legend.types.projectTask' },
  ad_hoc: { label: 'Ad-Hoc Entry', labelKey: 'calendar.legend.types.adHoc' },
  interaction: { label: 'Interaction', labelKey: 'calendar.legend.types.interaction' },
  appointment_request: { label: 'Appointment Request', labelKey: 'calendar.legend.types.appointmentRequest' },
  opportunity_step: { label: 'Deal step', labelKey: 'calendar.legend.types.opportunityStep' },
};

const OPPORTUNITY_STEP_DONE_STATUSES = new Set(['done', 'skipped']);

const uniq = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));

type Row = Record<string, any>;

// LEVERAGE: pattern work-item-resolution — workItemActions.getWorkItemById re-derives per-type title/status/url one id at a time; this batched resolver is the shape it would sit on.
async function describeTickets(db: ReturnType<typeof tenantDb>, ids: string[]): Promise<Map<string, FoundScheduleWorkItem>> {
  const out = new Map<string, FoundScheduleWorkItem>();
  if (ids.length === 0) return out;
  const query = db.table('tickets as t');
  db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
  const rows: Row[] = await query
    .whereIn('t.ticket_id', ids)
    .select('t.ticket_id', 't.ticket_number', 't.title', 't.is_closed', 's.is_closed as status_is_closed');
  for (const r of rows) {
    out.set(r.ticket_id, {
      missing: false,
      workItemType: 'ticket',
      key: scheduleWorkItemKey('ticket', r.ticket_id),
      ...LABELS.ticket,
      title: [r.ticket_number, r.title].filter(Boolean).join(' – '),
      link: recordPath('ticket', r.ticket_id),
      ticketId: r.ticket_id,
      done: Boolean(r.is_closed) || Boolean(r.status_is_closed),
    });
  }
  return out;
}

async function describeInteractions(
  db: ReturnType<typeof tenantDb>,
  refs: ScheduleWorkItemRef[],
): Promise<Map<string, FoundScheduleWorkItem>> {
  const out = new Map<string, FoundScheduleWorkItem>();
  const ids = uniq(refs.map((r) => r.work_item_id));
  if (ids.length === 0) return out;

  const query = db.table('interactions as i');
  db.tenantJoin(query, 'statuses as s', 'i.status_id', 's.status_id', { type: 'left' });
  db.tenantJoin(query, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
  const rows: Row[] = await query
    .whereIn('i.interaction_id', ids)
    .select('i.interaction_id', 'i.title', 'i.ticket_id', 'i.type_id', 's.is_closed as status_is_closed', 'it.type_name');

  // A type id that is not one of the tenant's own is a system type (global table, no tenant column).
  const systemTypeIds = uniq(rows.filter((r) => !r.type_name).map((r) => r.type_id));
  const systemNames = new Map<string, string>();
  if (systemTypeIds.length > 0) {
    const systemRows: Row[] = await db.table('system_interaction_types').whereIn('type_id', systemTypeIds).select('type_id', 'type_name');
    for (const s of systemRows) systemNames.set(s.type_id, s.type_name);
  }

  const refById = new Map(refs.filter((r) => r.work_item_id).map((r) => [r.work_item_id as string, r]));
  for (const r of rows) {
    const ref = refById.get(r.interaction_id);
    const typeName: string | undefined = r.type_name ?? systemNames.get(r.type_id);
    // Fixed per interaction; the entry deep link is only meaningful when the caller gave the entry.
    const link = r.ticket_id
      ? recordPath('ticket', r.ticket_id)
      : ref?.entry_id
        ? buildScheduleEntryLink(ref.entry_id, ref.occurrence)
        : '/msp/schedule';
    out.set(r.interaction_id, {
      missing: false,
      workItemType: 'interaction',
      key: scheduleWorkItemKey('interaction', r.interaction_id),
      label: typeName ?? LABELS.interaction.label,
      ...(typeName ? {} : { labelKey: LABELS.interaction.labelKey }),
      title: r.title ?? '',
      link,
      ...(r.ticket_id ? { ticketId: r.ticket_id } : {}),
      done: Boolean(r.status_is_closed),
    });
  }
  return out;
}

async function describeProjectTasks(db: ReturnType<typeof tenantDb>, ids: string[]): Promise<Map<string, FoundScheduleWorkItem>> {
  const out = new Map<string, FoundScheduleWorkItem>();
  if (ids.length === 0) return out;
  const query = db.table('project_tasks as pt');
  db.tenantJoin(query, 'project_phases as ph', 'pt.phase_id', 'ph.phase_id', { type: 'left' });
  db.tenantJoin(query, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
  db.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
  const rows: Row[] = await query
    .whereIn('pt.task_id', ids)
    .select('pt.task_id', 'pt.task_name', 'pt.phase_id', 'ph.project_id', 's.is_closed as s_closed', 'ss.is_closed as ss_closed');
  for (const r of rows) {
    out.set(r.task_id, {
      missing: false,
      workItemType: 'project_task',
      key: scheduleWorkItemKey('project_task', r.task_id),
      ...LABELS.project_task,
      title: r.task_name ?? '',
      link: r.project_id
        ? recordPath('project_task', r.task_id, { projectId: r.project_id, phaseId: r.phase_id ?? undefined })
        : '/msp/projects',
      done: Boolean(r.s_closed ?? r.ss_closed ?? false),
    });
  }
  return out;
}

async function describeOpportunitySteps(db: ReturnType<typeof tenantDb>, ids: string[]): Promise<Map<string, FoundScheduleWorkItem>> {
  const out = new Map<string, FoundScheduleWorkItem>();
  if (ids.length === 0) return out;
  const query = db.table('opportunity_steps as os');
  const rows: Row[] = await query
    .whereIn('os.step_id', ids)
    .select('os.step_id', 'os.title', 'os.status', 'os.opportunity_id', 'os.ticket_id');
  for (const r of rows) {
    out.set(r.step_id, {
      missing: false,
      workItemType: 'opportunity_step',
      key: scheduleWorkItemKey('opportunity_step', r.step_id),
      ...LABELS.opportunity_step,
      title: r.title ?? '',
      // LEVERAGE: pattern record-link-opportunity — `/msp/opportunities/{id}` is hand-built here and in workItemActions.ts; recordLinks has no opportunity entity type.
      link: `/msp/opportunities/${encodeURIComponent(r.opportunity_id)}`,
      done: OPPORTUNITY_STEP_DONE_STATUSES.has(r.status),
    });
  }
  return out;
}

async function describeAppointmentRequests(db: ReturnType<typeof tenantDb>, ids: string[]): Promise<Map<string, FoundScheduleWorkItem>> {
  const out = new Map<string, FoundScheduleWorkItem>();
  if (ids.length === 0) return out;
  const query = db.table('appointment_requests as ar');
  db.tenantJoin(query, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
  const rows: Row[] = await query
    .whereIn('ar.appointment_request_id', ids)
    .select('ar.appointment_request_id', 'ar.status', 'ar.ticket_id', 'sc.service_name');
  for (const r of rows) {
    out.set(r.appointment_request_id, {
      missing: false,
      workItemType: 'appointment_request',
      key: scheduleWorkItemKey('appointment_request', r.appointment_request_id),
      ...LABELS.appointment_request,
      title: r.service_name ?? LABELS.appointment_request.label,
      link: buildAppointmentRequestReviewPath(r.appointment_request_id),
      ...(r.ticket_id ? { ticketId: r.ticket_id } : {}),
      done: r.status !== 'approved',
    });
  }
  return out;
}

function describeAdHoc(ref: ScheduleWorkItemRef): FoundScheduleWorkItem {
  return {
    missing: false,
    workItemType: 'ad_hoc',
    key: scheduleWorkItemKey('ad_hoc', ref.work_item_id, ref.entry_id),
    ...LABELS.ad_hoc,
    title: ref.entry_title ?? '',
    link: ref.entry_id ? buildScheduleEntryLink(ref.entry_id, ref.occurrence) : '/msp/schedule',
    done: false,
  };
}

/**
 * Resolve a batch of work items. The result is keyed by `scheduleWorkItemKey(type, id)`; every
 * input ref has an entry, either found or `{ missing: true }` (the row no longer exists in this
 * tenant, or the type is unknown).
 */
export async function describeScheduleWorkItems(
  knex: Knex | Knex.Transaction,
  tenant: string,
  items: ScheduleWorkItemRef[],
): Promise<Map<string, ScheduleWorkItemDescriptor>> {
  if (!tenant) throw new Error('describeScheduleWorkItems requires a tenant');
  const db = tenantDb(knex, tenant);
  const byType = (type: string) => items.filter((i) => i.work_item_type === type);
  const idsOf = (type: string) => uniq(byType(type).map((i) => i.work_item_id));

  const [tickets, interactions, tasks, steps, requests] = await Promise.all([
    describeTickets(db, idsOf('ticket')),
    describeInteractions(db, byType('interaction')),
    describeProjectTasks(db, idsOf('project_task')),
    describeOpportunitySteps(db, idsOf('opportunity_step')),
    describeAppointmentRequests(db, idsOf('appointment_request')),
  ]);
  const found: Record<string, Map<string, FoundScheduleWorkItem>> = {
    ticket: tickets,
    interaction: interactions,
    project_task: tasks,
    opportunity_step: steps,
    appointment_request: requests,
  };

  const result = new Map<string, ScheduleWorkItemDescriptor>();
  for (const item of items) {
    const key = scheduleWorkItemKey(item.work_item_type, item.work_item_id, item.entry_id);
    if (item.work_item_type === 'ad_hoc') {
      result.set(key, describeAdHoc(item));
      continue;
    }
    const hit = item.work_item_id ? found[item.work_item_type]?.get(item.work_item_id) : undefined;
    result.set(key, hit ? { ...hit, key } : { missing: true, workItemType: item.work_item_type, key });
  }
  return result;
}
