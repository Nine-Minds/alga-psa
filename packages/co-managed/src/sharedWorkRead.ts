import type { Knex } from 'knex';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedCustomerTicket } from './customerWork';
import { withCoManagedSharedWork, CoManagedSharedWorkError,
  type CoManagedSessionActor, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';

export interface CoManagedDisplayReference {
  tenant: string;
  kind: 'board' | 'status' | 'priority' | 'project' | 'project_phase' | 'project_status_mapping';
  id: string;
  name: string | null;
}
export type CoManagedSummaryValue = string | number | boolean | null | CoManagedDisplayReference;
export interface CoManagedSharedWorkSummary {
  resource: CoManagedSharedResource;
  revision: number;
  /** Allowlisted metadata only. Missing fields may have been redacted. */
  fields: Record<string, CoManagedSummaryValue>;
}
export type CoManagedSummaryCandidate = { value: CoManagedSummaryValue; sources: string[] };

/** Redact derived values together with their source fields. A hidden status ID,
 * for example, must not remain visible through its qualified display reference.
 * A nested redaction omits the containing display value instead of returning a
 * partially identifying reference. Resource identity is the caller's input. */
function visibleFields(candidates: Record<string, CoManagedSummaryCandidate>, redactions: readonly string[]) {
  if (redactions.some(field => typeof field !== 'string')) throw new CoManagedSharedWorkError();
  const fields: Record<string, CoManagedSummaryValue> = {};
  for (const [key, candidate] of Object.entries(candidates)) {
    const names = [key, ...candidate.sources];
    const hidden = isCoManagedReadFieldHidden(redactions, names);
    if (!hidden) fields[key] = candidate.value;
  }
  return fields;
}
function text(value: unknown): string | null { return value == null ? null : String(value); }
function date(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
function reference(tenant: string, kind: CoManagedDisplayReference['kind'], id: unknown, name: unknown): CoManagedDisplayReference | null {
  return id == null ? null : { tenant, kind, id: String(id), name: text(name) };
}

/** Internal metadata projection. Callers retain their live read authority or
 * archival participation/grant admission; this function grants neither. */
export async function readCoManagedSummaryCandidates(trx: Knex.Transaction, resource: CoManagedSharedResource): Promise<Record<string, CoManagedSummaryCandidate>> {
  const owner = tenantDb(trx, resource.tenant);
  let candidates: Record<string, CoManagedSummaryCandidate>;
  if (resource.kind === 'ticket') {
    const query = owner.table('tickets').where('tickets.ticket_id', resource.id);
    owner.tenantJoin(query, 'boards', 'tickets.board_id', 'boards.board_id', { type: 'left' });
    owner.tenantJoin(query, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' });
    owner.tenantJoin(query, 'priorities', 'tickets.priority_id', 'priorities.priority_id', { type: 'left' });
    owner.tenantJoin(query, 'co_management_ticket_work as work', 'tickets.ticket_id', 'work.ticket_id', { type: 'left',
      on: join => join.andOn('work.relationship_id', '=', trx.raw('?', [resource.relationshipId])) });
    const row = await query.first('tickets.ticket_number', 'tickets.title', 'tickets.board_id', 'boards.board_name',
      'tickets.status_id', 'statuses.name as status_name', 'statuses.is_closed', 'tickets.priority_id', 'priorities.priority_name',
      'tickets.entered_at', 'tickets.updated_at', 'tickets.closed_at', 'work.revision as work_revision', 'work.responsibility',
      'work.first_escalated_at', 'work.last_transition_at', 'work.grant_revoked_at');
    if (!row) throw new CoManagedSharedWorkError();
    candidates = {
      work_revision: { value: Number(row.work_revision ?? 0), sources: ['work', 'co_management_ticket_work'] },
      responsibility: { value: row.responsibility ?? 'customer', sources: ['work', 'co_management_ticket_work'] },
      first_escalated_at: { value: date(row.first_escalated_at), sources: ['work', 'co_management_ticket_work'] },
      last_transition_at: { value: date(row.last_transition_at), sources: ['work', 'co_management_ticket_work'] },
      explicit_grant_active: { value: row.work_revision != null && !row.grant_revoked_at, sources: ['work', 'grant_revoked_at', 'co_management_ticket_work'] },
      ticket_number: { value: text(row.ticket_number), sources: ['tickets.ticket_number'] },
      title: { value: text(row.title), sources: ['tickets.title'] },
      board: { value: reference(resource.tenant, 'board', row.board_id, row.board_name), sources: ['board_id', 'board_name', 'tickets.board_id', 'boards'] },
      status: { value: reference(resource.tenant, 'status', row.status_id, row.status_name), sources: ['status_id', 'status_name', 'tickets.status_id', 'statuses'] },
      is_closed: { value: row.is_closed == null ? null : Boolean(row.is_closed), sources: ['status', 'status_id', 'tickets.status_id', 'statuses'] },
      priority: { value: reference(resource.tenant, 'priority', row.priority_id, row.priority_name), sources: ['priority_id', 'priority_name', 'tickets.priority_id', 'priorities'] },
      entered_at: { value: date(row.entered_at), sources: ['tickets.entered_at'] },
      updated_at: { value: date(row.updated_at), sources: ['tickets.updated_at'] },
      closed_at: { value: date(row.closed_at), sources: ['tickets.closed_at'] },
    };
  } else if (resource.kind === 'project') {
    const query = owner.table('projects').where('projects.project_id', resource.id);
    owner.tenantJoin(query, 'statuses', 'projects.status', 'statuses.status_id', { type: 'left' });
    const row = await query.first('projects.project_number', 'projects.project_name', 'projects.status', 'statuses.name as status_name',
      'statuses.is_closed', 'projects.start_date', 'projects.end_date', 'projects.created_at', 'projects.updated_at');
    if (!row) throw new CoManagedSharedWorkError();
    candidates = {
      project_number: { value: text(row.project_number), sources: ['projects.project_number'] },
      project_name: { value: text(row.project_name), sources: ['projects.project_name'] },
      status: { value: reference(resource.tenant, 'status', row.status, row.status_name), sources: ['status_id', 'status_name', 'projects.status', 'statuses'] },
      is_closed: { value: row.is_closed == null ? null : Boolean(row.is_closed), sources: ['status', 'status_id', 'projects.status', 'statuses'] },
      start_date: { value: date(row.start_date), sources: ['projects.start_date'] },
      end_date: { value: date(row.end_date), sources: ['projects.end_date'] },
      created_at: { value: date(row.created_at), sources: ['projects.created_at'] },
      updated_at: { value: date(row.updated_at), sources: ['projects.updated_at'] },
    };
  } else {
    const query = owner.table('project_tasks').where('project_tasks.task_id', resource.id);
    owner.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    owner.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
    owner.tenantJoin(query, 'project_status_mappings as psm', 'project_tasks.project_status_mapping_id', 'psm.project_status_mapping_id', {
      type: 'left', on: join => join.andOn('psm.project_id', '=', 'projects.project_id')
        .andOn(function () { this.onNull('psm.phase_id').orOn('psm.phase_id', '=', 'project_tasks.phase_id'); }),
    });
    owner.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
    owner.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
    const row = await query.first('project_tasks.task_name', 'project_tasks.wbs_code', 'project_tasks.due_date',
      'project_tasks.created_at', 'project_tasks.updated_at', 'psm.project_status_mapping_id',
      'projects.project_id', 'projects.project_name', 'project_phases.phase_id', 'project_phases.phase_name',
      trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
      trx.raw('CASE WHEN psm.project_status_mapping_id IS NULL THEN NULL ELSE COALESCE(s.is_closed, ss.is_closed, false) END as is_closed'));
    if (!row) throw new CoManagedSharedWorkError();
    candidates = {
      task_name: { value: text(row.task_name), sources: ['project_tasks.task_name'] },
      wbs_code: { value: text(row.wbs_code), sources: ['project_tasks.wbs_code'] },
      project: { value: reference(resource.tenant, 'project', row.project_id, row.project_name), sources: ['project_id', 'project_name', 'projects'] },
      phase: { value: reference(resource.tenant, 'project_phase', row.phase_id, row.phase_name), sources: ['phase_id', 'phase_name', 'project_phases'] },
      status: { value: reference(resource.tenant, 'project_status_mapping', row.project_status_mapping_id, row.status_name),
        sources: ['project_status_mapping_id', 'project_tasks.project_status_mapping_id', 'status_id', 'status_name', 'custom_name', 'project_status_mappings', 'statuses', 'standard_statuses'] },
      is_closed: { value: row.is_closed == null ? null : Boolean(row.is_closed), sources: ['status', 'status_id', 'project_status_mapping_id', 'project_tasks.project_status_mapping_id', 'project_status_mappings', 'statuses', 'standard_statuses'] },
      due_date: { value: date(row.due_date), sources: ['project_tasks.due_date'] },
      created_at: { value: date(row.created_at), sources: ['project_tasks.created_at'] },
      updated_at: { value: date(row.updated_at), sources: ['project_tasks.updated_at'] },
    };
  }
  return candidates;
}

async function readSummary(context: CoManagedSharedWorkContext): Promise<CoManagedSharedWorkSummary> {
  const { trx, resource, revision, redactedFields } = context;
  return { resource, revision, fields: visibleFields(await readCoManagedSummaryCandidates(trx, resource), redactedFields) };
}

/** No row spreading, linked resources, rich text, people, commercial fields,
 * comments, attachments, or counts. Those require their own audience/grant
 * adapters. Each qualified display reference is context, not permission to open
 * the underlying local resource through an ordinary action. */
export async function getCoManagedSharedWorkSummary(db: Knex, actor: CoManagedSessionActor,
  resource: CoManagedSharedResource): Promise<CoManagedSharedWorkSummary> {
  return actor?.tenant === resource?.tenant && resource?.kind === 'ticket'
    ? withCoManagedCustomerTicket(db, actor, resource, 'read', readSummary)
    : withCoManagedSharedWork(db, actor, resource, 'read', readSummary);
}
