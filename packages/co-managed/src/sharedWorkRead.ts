import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { lockCoManagedLocalAuthentication } from './localAuthentication';
import { evaluateCoManagedAccess, type CoManagedVisibilityMode } from './policy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { withCoManagedSharedWork, CoManagedSharedWorkError, loadCoManagedHomeFacts, loadCoManagedLifecycleFacts,
  loadCoManagedStaffRoles, type CoManagedSessionActor, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { coManagedDisplayName } from './actorReferences';

export interface CoManagedDisplayReference {
  tenant: string;
  kind: 'board' | 'status' | 'priority' | 'project' | 'project_phase' | 'project_status_mapping';
  id: string;
  name: string | null;
}
export type CoManagedSummaryValue = string | number | boolean | CoManagedDisplayReference;
export interface CoManagedSharedWorkSummary {
  resource: CoManagedSharedResource;
  revision: number;
  /** Allowlisted metadata only. A key is ABSENT when the source is empty or redacted; never a placeholder null. */
  fields: Record<string, CoManagedSummaryValue>;
}
export type CoManagedSummaryCandidate = { value: CoManagedSummaryValue | null; sources: string[] };

/** Redact derived values together with their source fields: a hidden `status_id` also removes `status`
 * (the qualified display reference carrying `status.name`) and `is_closed`. A nested redaction omits the
 * containing display value instead of returning a partially identifying reference. Empty values are
 * omitted rather than reported as null. */
export function visibleCoManagedFields(candidates: Record<string, CoManagedSummaryCandidate>, redactions: readonly string[]) {
  if (redactions.some(field => typeof field !== 'string')) throw new CoManagedSharedWorkError();
  const fields: Record<string, CoManagedSummaryValue> = {};
  for (const [key, candidate] of Object.entries(candidates)) {
    if (candidate.value === null || candidate.value === undefined) continue;
    if (!isCoManagedReadFieldHidden(redactions, [key, ...candidate.sources])) fields[key] = candidate.value;
  }
  return fields;
}
const text = (value: unknown): string | null => value == null ? null : String(value);
const date = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
function reference(tenant: string, kind: CoManagedDisplayReference['kind'], id: unknown, name: unknown): CoManagedDisplayReference | null {
  return id == null ? null : { tenant, kind, id: String(id), name: text(name) };
}

/** Allowlist of ticket columns (no row spreading, linked resources, rich text, people, commercial fields,
 * comments or counts). Each is context, not permission to open the underlying resource. */
export function ticketSummaryCandidates(tenant: string, row: any): Record<string, CoManagedSummaryCandidate> {
  return {
    ticket_number: { value: text(row.ticket_number), sources: ['tickets.ticket_number'] },
    title: { value: text(row.title), sources: ['tickets.title'] },
    board: { value: reference(tenant, 'board', row.board_id, row.board_name), sources: ['board_id', 'board_name', 'tickets.board_id', 'boards'] },
    status: { value: reference(tenant, 'status', row.status_id, row.status_name), sources: ['status_id', 'status_name', 'tickets.status_id', 'statuses'] },
    is_closed: { value: row.is_closed == null ? null : Boolean(row.is_closed), sources: ['status', 'status_id', 'tickets.status_id', 'statuses'] },
    priority: { value: reference(tenant, 'priority', row.priority_id, row.priority_name), sources: ['priority_id', 'priority_name', 'tickets.priority_id', 'priorities'] },
    entered_at: { value: date(row.entered_at), sources: ['tickets.entered_at'] },
    updated_at: { value: date(row.updated_at), sources: ['tickets.updated_at'] },
    closed_at: { value: date(row.closed_at), sources: ['tickets.closed_at'] },
    // The creator's display name only (null-safe, never an id); hidden together with its source column.
    opened_by: { value: openedByName(row), sources: ['tickets.entered_by', 'users'] },
  };
}
/** Handoff state of one ticket in one relationship; absent work row = never escalated, customer-handled, revision 0.
 * Single-ticket reads only: list rows do not join the work table and must not default these. */
function ticketWorkCandidates(row: any): Record<string, CoManagedSummaryCandidate> {
  const sources = ['work', 'co_management_ticket_work'];
  return {
    work_revision: { value: Number(row.work_revision ?? 0), sources },
    responsibility: { value: row.responsibility ?? 'customer', sources },
    first_escalated_at: { value: date(row.first_escalated_at), sources },
    last_transition_at: { value: date(row.last_transition_at), sources },
    // An explicit grant exists once the ticket has been escalated and until it is revoked.
    explicit_grant_active: { value: row.first_escalated_at != null && row.grant_revoked_at == null, sources: [...sources, 'grant_revoked_at'] },
  };
}
function openedByName(row: any): string | null {
  return coManagedDisplayName({ first_name: row.opened_by_first_name, last_name: row.opened_by_last_name }, '') || null;
}
const TICKET_COLUMNS = ['tickets.ticket_id', 'tickets.ticket_number', 'tickets.title', 'tickets.board_id', 'boards.board_name',
  'tickets.status_id', 'statuses.name as status_name', 'statuses.is_closed', 'tickets.priority_id', 'priorities.priority_name',
  'tickets.entered_at', 'tickets.updated_at', 'tickets.closed_at', 'opener.first_name as opened_by_first_name', 'opener.last_name as opened_by_last_name'];
function ticketQuery(trx: Knex.Transaction, tenant: string) {
  const owner = tenantDb(trx, tenant);
  const query = owner.table('tickets');
  owner.tenantJoin(query, 'boards', 'tickets.board_id', 'boards.board_id', { type: 'left' });
  owner.tenantJoin(query, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' });
  owner.tenantJoin(query, 'priorities', 'tickets.priority_id', 'priorities.priority_id', { type: 'left' });
  owner.tenantJoin(query, 'users as opener', 'tickets.entered_by', 'opener.user_id', { type: 'left' });
  return query;
}

/** Internal metadata projection. Callers retain their live read authority; this function grants none. */
export async function readCoManagedSummaryCandidates(trx: Knex.Transaction, resource: CoManagedSharedResource): Promise<Record<string, CoManagedSummaryCandidate>> {
  const owner = tenantDb(trx, resource.tenant);
  if (resource.kind === 'ticket') {
    // The work row is per (tenant, relationship, ticket): tenantJoin leads the join with the tenant, the relationship is pinned here.
    const query = ticketQuery(trx, resource.tenant).where('tickets.ticket_id', resource.id);
    owner.tenantJoin(query, 'co_management_ticket_work as work', 'tickets.ticket_id', 'work.ticket_id', { type: 'left',
      on: join => join.andOn('work.relationship_id', '=', trx.raw('?', [resource.relationshipId])) });
    const row = await query.first(...TICKET_COLUMNS, 'work.revision as work_revision', 'work.responsibility',
      'work.first_escalated_at', 'work.last_transition_at', 'work.grant_revoked_at');
    if (!row) throw new CoManagedSharedWorkError();
    return { ...ticketWorkCandidates(row), ...ticketSummaryCandidates(resource.tenant, row) };
  }
  if (resource.kind === 'project') {
    const query = owner.table('projects').where('projects.project_id', resource.id);
    owner.tenantJoin(query, 'statuses', 'projects.status', 'statuses.status_id', { type: 'left' });
    const row = await query.first('projects.project_number', 'projects.project_name', 'projects.status', 'statuses.name as status_name',
      'statuses.is_closed', 'projects.start_date', 'projects.end_date', 'projects.created_at', 'projects.updated_at');
    if (!row) throw new CoManagedSharedWorkError();
    return {
      project_number: { value: text(row.project_number), sources: ['projects.project_number'] },
      project_name: { value: text(row.project_name), sources: ['projects.project_name'] },
      status: { value: reference(resource.tenant, 'status', row.status, row.status_name), sources: ['status_id', 'status_name', 'projects.status', 'statuses'] },
      is_closed: { value: row.is_closed == null ? null : Boolean(row.is_closed), sources: ['status', 'status_id', 'projects.status', 'statuses'] },
      start_date: { value: date(row.start_date), sources: ['projects.start_date'] },
      end_date: { value: date(row.end_date), sources: ['projects.end_date'] },
      created_at: { value: date(row.created_at), sources: ['projects.created_at'] },
      updated_at: { value: date(row.updated_at), sources: ['projects.updated_at'] },
    };
  }
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
  return {
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

async function readSummary(context: CoManagedSharedWorkContext): Promise<CoManagedSharedWorkSummary> {
  const { trx, resource, revision, redactedFields } = context;
  return { resource, revision, fields: visibleCoManagedFields(await readCoManagedSummaryCandidates(trx, resource), redactedFields) };
}

/** Authorized read of one shared work item. A denial in ANY matrix layer is the same opaque error (404). */
export async function getCoManagedSharedWorkSummary(db: Knex, actor: CoManagedSessionActor,
  resource: CoManagedSharedResource): Promise<CoManagedSharedWorkSummary> {
  return actor?.tenant === resource?.tenant && resource?.kind === 'ticket'
    ? withCoManagedCustomerTicket(db, actor, resource, 'read', readSummary)
    : withCoManagedSharedWork(db, actor, resource, 'read', readSummary);
}

// ---------------------------------------------------------------------------
// Customer Tickets queue
// ---------------------------------------------------------------------------

export interface CoManagedCustomerTicketRow {
  resource: CoManagedSharedResource;
  /** Display name of the customer workspace; never an id. */
  customerName: string;
  fields: Record<string, CoManagedSummaryValue>;
}
export interface CoManagedCustomerTicketPage { rows: CoManagedCustomerTicketRow[]; page: number; pageSize: number; hasMore: boolean }

/** Every ticket the actor may read right now, across the relationships they are assigned to. Facts are
 * reloaded on every call (no cross-request cache), and each ticket is admitted through the single
 * evaluator, so a revoked board, assignment, permission or relationship drops out on the next read. */
export async function listCoManagedCustomerTickets(db: Knex, actor: CoManagedSessionActor,
  options: { page?: number; pageSize?: number } = {}): Promise<CoManagedCustomerTicketPage> {
  if (!actor || ![actor.tenant, actor.userId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? 25), 1), 100), page = Math.max(Math.trunc(options.page ?? 0), 0);
  return withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    const subject = credential.subject;
    const assigned = await tenantDb(trx, actor.tenant).table('co_management_staff_assignments')
      .where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
        .orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', subject.teamIds ?? [])))
      .distinct('customer_tenant', 'relationship_id').orderBy('customer_tenant').orderBy('relationship_id');
    const collected: Array<CoManagedCustomerTicketRow & { entered: string }> = [];
    for (const { customer_tenant: customerTenant, relationship_id: relationshipId } of assigned) {
      const lifecycle = await loadCoManagedLifecycleFacts(trx, actor.tenant, customerTenant, relationshipId);
      if (!lifecycle?.relationship) continue;
      const mode = lifecycle.relationship.visibility_mode as CoManagedVisibilityMode;
      const roles = await loadCoManagedStaffRoles(trx, actor, customerTenant, relationshipId, subject.teamIds ?? []);
      const home = await loadCoManagedHomeFacts(trx, actor, subject, 'ticket',
        { id: `${customerTenant}:ticket`, clientId: lifecycle.relationship.sponsor_client_id, assignedUserIds: [], teamIds: [] });
      // Cheap pre-filter: a relationship whose non-grant layers already refuse cannot list anything.
      const probe = evaluateCoManagedAccess({ lifecycle: lifecycle.lifecycle, staff: { roles }, home: home.facts,
        grant: { visibilityMode: mode, scope: { canCollaborate: false } } });
      if (!probe.read) continue;
      // Every ticket on a board shares that board's scope row: read it once per board (shared lock), not once per ticket.
      const boards = await tenantDb(trx, customerTenant).table('co_management_board_scopes').where('relationship_id', relationshipId).forShare()
        .select('board_id', 'can_collaborate');
      // L3b1: escalated tickets are explicit grants, readable in either mode and on boards with no scope row.
      const explicit = new Map<string, { canCollaborate: boolean }>((await tenantDb(trx, customerTenant).table('co_management_ticket_work')
        .where('relationship_id', relationshipId).whereNull('grant_revoked_at').whereNotNull('first_escalated_at').forShare()
        .select('ticket_id', 'can_collaborate')).map((w: any) => [w.ticket_id, { canCollaborate: w.can_collaborate }]));
      if (!boards.length && !explicit.size) continue;
      const scopeByBoard = new Map<string, { canCollaborate: boolean }>(boards.map((b: any) => [b.board_id, { canCollaborate: b.can_collaborate }]));
      const rows = await ticketQuery(trx, customerTenant).where(scoped => scoped.whereIn('tickets.board_id', boards.map((b: any) => b.board_id))
        .orWhereIn('tickets.ticket_id', [...explicit.keys()])).forShare('tickets')
        .orderBy('tickets.entered_at', 'desc').orderBy('tickets.ticket_id').limit((page + 1) * pageSize + 1).select(...TICKET_COLUMNS);
      const customer = await tenantDb(trx, customerTenant).table('tenants').first('client_name');
      for (const row of rows) {
        const resource: CoManagedSharedResource = { tenant: customerTenant, relationshipId, kind: 'ticket', id: row.ticket_id };
        const scope = scopeByBoard.get(row.board_id) ?? null;
        const grant = { visibilityMode: mode, scope, explicit: explicit.get(row.ticket_id) ?? null };
        if (!evaluateCoManagedAccess({ lifecycle: lifecycle.lifecycle, staff: { roles }, grant, home: home.facts }).read) continue;
        collected.push({ resource, customerName: customer?.client_name ?? '', entered: date(row.entered_at) ?? '',
          fields: visibleCoManagedFields(ticketSummaryCandidates(customerTenant, row), home.redactedFields.concat(lifecycle.relationship.redacted_fields ?? [])) });
      }
    }
    collected.sort((a, b) => b.entered.localeCompare(a.entered) || a.resource.id.localeCompare(b.resource.id));
    const slice = collected.slice(page * pageSize, (page + 1) * pageSize + 1);
    return { rows: slice.slice(0, pageSize).map(({ entered, ...row }) => row), page, pageSize, hasMore: slice.length > pageSize };
  });
}
