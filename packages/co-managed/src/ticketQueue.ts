import { applyCoManagedQueuePolicy } from './queuePolicy';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization';
import { getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedSessionUnexpired, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedSessionIdentity, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

/**
 * Callout signals: shared tickets that need MSP action. Each is a reader filter
 * so a deep link and its count are the same authorized relation.
 *
 * - `escalated_unassigned`: open, MSP-responsible, no MSP user or team assigned.
 * - `awaiting_reply`: open, assigned to the user or one of the user's teams, and
 *   the owner ticket's `response_state` is `awaiting_internal`.
 *
 * A row whose driving field is redacted is excluded from the signal; nothing is
 * inferred from a hidden value.
 */
export type CoManagedTicketQueueSignal = 'escalated_unassigned' | 'awaiting_reply';
export const CO_MANAGED_TICKET_QUEUE_SIGNALS: readonly CoManagedTicketQueueSignal[] = ['escalated_unassigned', 'awaiting_reply'];

export interface CoManagedTicketQueueRequest {
  view: 'working' | 'oversight';
  workspaceTenant?: string;
  /** Filters shared work by the relationship's sponsor client. Native home tickets are never part of this relation. */
  clientId?: string;
  /** Restrict to one callout signal (combine with `state: 'open'`, the default, to match its count). */
  signal?: CoManagedTicketQueueSignal;
  search?: string;
  state?: 'open' | 'closed' | 'all';
  sort?: 'updated' | 'created' | 'title' | 'number';
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}
export interface CoManagedTicketQueueItem {
  tenant: string;
  relationshipId: string | null;
  ticketId: string;
  workspaceName: string;
  fields: {
    ticket_number?: string | null; title?: string | null; status_name?: string | null;
    priority_name?: string | null; is_closed?: boolean | null;
    responsibility?: 'msp' | 'customer' | null; entered_at?: string | null; updated_at?: string | null;
    work_revision?: number | null;
    /**
     * True when the qualified MSP reference says an MSP user or team is assigned
     * to this shared record. Present only when assignment aliases are visible
     * under the read policy; omitted (not false) when redacted. It describes
     * assignment presence, not write permission.
     */
    has_msp_assignment?: boolean | null;
  };
}
/** What the callout strip, the menu badge and presentation gating read; counts only, never rows. */
export interface CoManagedWorkSignals {
  /** Active relationships on which the user holds a staff assignment. */
  assignedRelationshipCount: number;
  signals: { escalatedUnassigned: number; awaitingReply: number };
}
export interface CoManagedTicketQueuePage {
  items: CoManagedTicketQueueItem[];
  workspaces: Array<{ tenant: string; name: string }>;
  totalCount: number;
  openCount: number;
  closedCount: number;
  page: number;
  pageSize: number;
  /**
   * Open-ticket callout counts over the client-narrowed authorized relation.
   * Independent of workspace, search, state, view and page, so each count equals
   * the rows returned by `{ signal, state: 'open' }` with the same client.
   */
  signals: { escalatedUnassigned: number; awaitingReply: number };
  /** Active relationships on which the actor holds a staff assignment (the discovery this read already performs). */
  assignedRelationshipCount: number;
}
const sources = {
  ticket_number: ['ticket_number', 'tickets.ticket_number'], title: ['title', 'tickets.title'],
  status_name: ['status', 'status_id', 'status_name', 'tickets.status_id', 'statuses'],
  priority_name: ['priority', 'priority_id', 'priority_name', 'tickets.priority_id', 'priorities'],
  is_closed: ['is_closed', 'status', 'status_id', 'tickets.status_id', 'statuses'],
  responsibility: ['responsibility', 'work', 'co_management_ticket_work'],
  work_revision: ['work_revision', 'values.work_revision', 'tickets.work_revision', 'revision', 'work', 'co_management_ticket_work', 'co_management_ticket_work.revision'],
  entered_at: ['entered_at', 'tickets.entered_at'], updated_at: ['updated_at', 'tickets.updated_at'],
  has_msp_assignment: [
    'mspAssignment', 'values.mspAssignment', 'tickets.mspAssignment',
    'msp_assignment', 'values.msp_assignment', 'tickets.msp_assignment',
    'assigned_to', 'values.assigned_to', 'tickets.assigned_to',
    'assigned_team_id', 'values.assigned_team_id', 'tickets.assigned_team_id',
    'assignee', 'values.assignee', 'tickets.assignee',
    'work', 'values.work', 'tickets.work',
    'co_managed_ticket_references', 'values.co_managed_ticket_references', 'tickets.co_managed_ticket_references',
  ],
};
// Redaction aliases for the owner-ticket response state that drives the awaiting-reply signal.
const responseStateAliases = ['response_state', 'tickets.response_state', 'values.response_state'];
function snapshotRequest(input: CoManagedTicketQueueRequest): Required<Omit<CoManagedTicketQueueRequest, 'workspaceTenant' | 'clientId' | 'signal'>> & { workspaceTenant?: string; clientId?: string; signal?: CoManagedTicketQueueSignal } {
  if (!input || !['working', 'oversight'].includes(input.view) ||
      (input.workspaceTenant !== undefined && !isCoManagedUuid(input.workspaceTenant)) ||
      (input.clientId !== undefined && !isCoManagedUuid(input.clientId)) ||
      (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      (input.signal !== undefined && !CO_MANAGED_TICKET_QUEUE_SIGNALS.includes(input.signal)) ||
      (input.state !== undefined && !['open', 'closed', 'all'].includes(input.state)) ||
      (input.sort !== undefined && !['updated', 'created', 'title', 'number'].includes(input.sort)) ||
      (input.direction !== undefined && !['asc', 'desc'].includes(input.direction)) ||
      (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000)) ||
      (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100))) throw new CoManagedSharedWorkError();
  return { view: input.view, workspaceTenant: input.workspaceTenant?.toLowerCase(), clientId: input.clientId?.toLowerCase(), signal: input.signal,
    search: input.search ?? '', state: input.state ?? 'open',
    sort: input.sort ?? 'updated', direction: input.direction ?? 'desc', page: input.page ?? 1, pageSize: input.pageSize ?? 25 };
}

/** One authorized SQL relation drives search, sorting, pagination and counts.
 * No independently paginated tenant lists, cached permissions, or shadow tickets. */
export async function getCoManagedTicketQueue(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedTicketQueueRequest): Promise<CoManagedTicketQueuePage> {
  return readCoManagedTicketQueue(db, inputActor, input, true);
}

/** Export the complete filtered relation in one snapshot. Page controls are
 * deliberately absent: concatenating page reads can skip or duplicate tickets. */
export async function exportCoManagedTicketQueue(db: Knex, actor: CoManagedSessionActor, input: Omit<CoManagedTicketQueueRequest, 'page' | 'pageSize'>): Promise<CoManagedTicketQueueItem[]> {
  const result = await readCoManagedTicketQueue(db, actor, { ...input, page: 1, pageSize: 25 }, false);
  return result.items;
}

async function readCoManagedTicketQueue(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedTicketQueueRequest, paginate: boolean): Promise<CoManagedTicketQueuePage> {
  const actor = snapshotCoManagedSessionActor(inputActor), request = snapshotRequest(input);
  return withTransaction(db, async trx => {
    // LEVERAGE: pattern co-managed-read-admission — detail and federated query paths share trust/session locks but need distinct record projections.
    const home = tenantDb(trx, actor.tenant);
    // Discovery is not authority. Acquire lifecycle locks before home identity
    // and policy locks, then recheck each discovered relationship and assignment.
    const teamIds = (await home.table('team_members').where('user_id', actor.userId).select('team_id')).map(row => row.team_id);
    const discovered = await home.table('co_management_staff_assignments').where(function () {
      this.where({ principal_type: 'user', principal_id: actor.userId }).orWhere(function () { this.where('principal_type', 'team').whereIn('principal_id', teamIds); });
    }).distinct('customer_tenant', 'relationship_id').orderBy('customer_tenant').orderBy('relationship_id');
    for (const target of discovered) {
      // Removed workspaces are omitted; dangling historical assignments confer nothing.
      if (await tenantDb(trx, target.customer_tenant).table('tenants').first('tenant')) await getCoManagedOperationalState(trx, target.customer_tenant);
    }
    const workspace = await home.table('tenants').forShare().first('product_code', 'suspended_at', 'client_name');
    if (workspace?.product_code !== 'psa' || workspace.suspended_at) throw new CoManagedSharedWorkError();
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'ticket', 'read', true)) throw new CoManagedSharedWorkError();
    const rules = (await resolveBundleNarrowingRulesForEvaluation(trx, { subject, resource: { type: 'ticket', action: 'read' }, knex: trx }, { lock: true }))
      .filter(rule => rule.resource === 'ticket' && rule.action === 'read');
    const redactions = rules.flatMap(rule => rule.redactedFields ?? []);
    const visible = Object.fromEntries(Object.entries(sources).map(([field, aliases]) => [field, !isCoManagedReadFieldHidden(redactions, aliases)]));
    // Assignment presence is a projection of the same redaction policy that
    // gates the working-queue membership test, read from the qualified MSP
    // reference in this query — never a browser-side directory lookup.
    const assignmentVisible = visible.has_msp_assignment;
    // Callout signals read responsibility, assignment and response state. If any
    // field that drives a signal is redacted, the signal is false for the row.
    const responseStateVisible = !isCoManagedReadFieldHidden(redactions, responseStateAliases);
    const escalatedSignalVisible = visible.responsibility && assignmentVisible;
    const awaitingSignalVisible = responseStateVisible && assignmentVisible;
    const queries: Knex.QueryBuilder[] = [];
    // Native tickets in the home tenant are never part of this relation (the
    // customer tickets page lists shared work only); every projection is a
    // shared record read through its qualified relationship.
    function projection(ownerTenant: string, name: string, relationship: any, boardIds: string[] = []) {
      const owner = tenantDb(trx, ownerTenant);
      const base = owner.table('tickets as t');
      owner.tenantJoin(base, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      owner.tenantJoin(base, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
      owner.tenantJoin(base, 'co_management_ticket_work as w', 't.ticket_id', 'w.ticket_id', { type: 'left',
        on: join => join.andOn('w.relationship_id', '=', trx.raw('?', [relationship.relationship_id])) });
      // Explicitly join the HOME facade's tenant literal, never the ticket owner's tenant.
      home.tenantJoin(base, 'co_managed_ticket_references as r', 't.ticket_id', 'r.ticket_id', { type: 'left', tenantPredicate: 'literal',
        on: join => join.andOn('r.customer_tenant', '=', trx.raw('?', [ownerTenant]))
          .andOn('r.relationship_id', '=', trx.raw('?', [relationship.relationship_id]))
          .andOn('r.client_id', '=', trx.raw('?', [relationship.sponsor_client_id])).andOn('r.work_id', '=', 'w.work_id') });
      base.where(function () {
        this.where(function () { this.whereNotNull('w.work_id').whereNull('w.grant_revoked_at'); }).orWhereIn('t.board_id', boardIds);
      });
      if (request.view === 'working') base.whereNotNull('r.reference_id').where(function () {
        if (visible.responsibility) this.where('w.responsibility', 'msp');
        if (assignmentVisible) this.orWhereNotNull('r.assigned_to').orWhereNotNull('r.assigned_team_id');
        if (!visible.responsibility && !assignmentVisible) this.whereRaw('false');
      });
      const policyColumns = { auth_owner: trx.raw('NULL::uuid'), auth_client: trx.raw('?::uuid', [relationship.sponsor_client_id]), auth_board: 'r.board_id', auth_assigned: 'r.assigned_to', auth_team: 'r.assigned_team_id' };
      base.select({ tenant: 't.tenant', ticket_id: 't.ticket_id', relationship_id: trx.raw('?::uuid', [relationship.relationship_id]),
        workspace_name: trx.raw('?::text', [name]), ticket_number: 't.ticket_number', title: 't.title', status_name: 's.name', priority_name: 'p.priority_name',
        is_closed: 's.is_closed', responsibility: trx.raw("COALESCE(w.responsibility, 'customer')"),
        client_id: trx.raw('?::uuid', [relationship.sponsor_client_id]),
        entered_at: 't.entered_at', updated_at: 't.updated_at', work_revision: 'w.revision',
        has_msp_assignment: assignmentVisible
          ? trx.raw('(r.assigned_to IS NOT NULL OR r.assigned_team_id IS NOT NULL)')
          : trx.raw('NULL::boolean'),
        // Signal membership is decided here, from the same joined reference and
        // owner ticket as the row, so the count and the filter cannot diverge.
        sig_escalated: escalatedSignalVisible
          ? trx.raw("(r.reference_id IS NOT NULL AND COALESCE(w.responsibility, 'customer') = 'msp' AND r.assigned_to IS NULL AND r.assigned_team_id IS NULL)")
          : trx.raw('false'),
        sig_awaiting: awaitingSignalVisible
          ? trx.raw("(r.reference_id IS NOT NULL AND (r.assigned_to = ?::uuid OR r.assigned_team_id = ANY(?::uuid[])) AND t.response_state = 'awaiting_internal')", [actor.userId, subject.teamIds ?? []])
          : trx.raw('false'),
        ...policyColumns });
      const authorized = trx.from(base.as('q'));
      applyCoManagedQueuePolicy(authorized, subject, rules, { resourceType: 'ticket', shared: true });
      authorized.select('q.tenant', 'q.ticket_id', 'q.relationship_id', 'q.workspace_name', 'q.client_id', 'q.sig_escalated', 'q.sig_awaiting');
      for (const field of Object.keys(sources)) authorized.select(visible[field] ? `q.${field}` : trx.raw(`NULL::${['is_closed', 'has_msp_assignment'].includes(field) ? 'boolean' : field === 'work_revision' ? 'integer' : ['entered_at', 'updated_at'].includes(field) ? 'timestamptz' : 'text'} as ??`, [field]));
      queries.push(authorized);
    }
    let assignedRelationshipCount = 0;
    for (const target of discovered) {
      const owner = tenantDb(trx, target.customer_tenant);
      const relationship = await owner.table('co_management_relationships').where({ relationship_id: target.relationship_id, sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at').forShare().first();
      const customer = await owner.table('tenants').forShare().first('product_code', 'suspended_at', 'client_name');
      if (!relationship || customer?.product_code !== 'co_managed' || customer.suspended_at) continue;
      const staff = await home.table('co_management_staff_assignments').where({ customer_tenant: target.customer_tenant, relationship_id: target.relationship_id })
        .where(function () { this.where({ principal_type: 'user', principal_id: actor.userId }).orWhere(function () { this.where('principal_type', 'team').whereIn('principal_id', subject.teamIds ?? []); }); }).forShare().first();
      if (!staff) continue;
      const boards = relationship.visibility_mode === 'board_scope' ? await owner.table('co_management_board_scopes').where('relationship_id', target.relationship_id).forShare().select('board_id') : [];
      assignedRelationshipCount += 1;
      projection(target.customer_tenant, customer.client_name, relationship, boards.map(row => row.board_id));
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    if (!queries.length) return { items: [], workspaces: [], totalCount: 0, openCount: 0, closedCount: 0, page: request.page, pageSize: request.pageSize,
      signals: { escalatedUnassigned: 0, awaitingReply: 0 }, assignedRelationshipCount };
    const combined = trx.queryBuilder().unionAll(queries, true);
    // Client narrowing is applied once, before workspace options, search, state,
    // counts and pagination. The chooser therefore lists only workspaces the
    // selected client can actually produce — derived from the authorized
    // relation, never from the displayed page or a foreign workspace directory.
    // Sponsor-client matching is by relationship.
    const scoped = trx.from('authorized');
    if (request.clientId) scoped.where('client_id', request.clientId);
    const filtered = trx.from('scoped');
    if (request.workspaceTenant) filtered.where('tenant', request.workspaceTenant);
    if (request.search) {
      const search = `%${request.search.replace(/[\\%_]/g, '\\$&')}%`;
      filtered.where(function () { this.whereILike('title', search).orWhereILike('ticket_number', search); });
    }
    if (request.state !== 'all') filtered.where('is_closed', request.state === 'closed');
    if (request.signal) filtered.where(request.signal === 'escalated_unassigned' ? 'sig_escalated' : 'sig_awaiting', true);
    const sort = { updated: 'updated_at', created: 'entered_at', title: 'title', number: 'ticket_number' }[request.sort];
    const page = trx.from('filtered').select('*').orderBy(sort, request.direction, 'last').orderBy('tenant').orderBy('ticket_id');
    if (paginate) page.limit(request.pageSize).offset((request.page - 1) * request.pageSize);
    // A single statement snapshot keeps rows and counts coherent during local ticket edits.
    const result = await trx.with('authorized', combined).with('scoped', scoped).with('filtered', filtered).with('page_rows', page)
      .select(trx.raw("COALESCE((SELECT json_agg(workspaces ORDER BY name, tenant) FROM (SELECT DISTINCT tenant, workspace_name AS name FROM scoped) workspaces), '[]'::json) AS workspaces"),
        trx.raw('(SELECT count(*) FROM filtered) AS total_count'),
        trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = false) AS open_count'),
        trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = true) AS closed_count'),
        trx.raw('(SELECT count(*) FROM scoped WHERE is_closed = false AND sig_escalated) AS escalated_count'),
        trx.raw('(SELECT count(*) FROM scoped WHERE is_closed = false AND sig_awaiting) AS awaiting_count'),
        trx.raw("COALESCE((SELECT json_agg(page_rows) FROM page_rows), '[]'::json) AS items")).first();
    await assertCoManagedSessionUnexpired(trx, actor);
    const items = result.items.map((row: any) => ({ tenant: row.tenant, relationshipId: row.relationship_id, ticketId: row.ticket_id, workspaceName: row.workspace_name,
      fields: Object.fromEntries(Object.keys(sources).filter(field => visible[field]).map(field => [field, row[field]])) }));
    return { items, workspaces: result.workspaces, totalCount: Number(result.total_count), openCount: Number(result.open_count), closedCount: Number(result.closed_count), page: request.page, pageSize: request.pageSize,
      signals: { escalatedUnassigned: Number(result.escalated_count), awaitingReply: Number(result.awaiting_count) }, assignedRelationshipCount };
  });
}
