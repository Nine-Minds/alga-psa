import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { compileResourceReadAuthorizationSql, resolveBundleNarrowingRulesForEvaluation, type AuthorizationSubject, type BundleNarrowingRule } from '@alga-psa/authorization';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedSessionUnexpired, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedSessionIdentity, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedTicketQueueRequest {
  view: 'working' | 'oversight';
  workspaceTenant?: string;
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
  };
}
export interface CoManagedTicketQueuePage {
  items: CoManagedTicketQueueItem[];
  workspaces: Array<{ tenant: string; name: string }>;
  totalCount: number;
  openCount: number;
  closedCount: number;
  page: number;
  pageSize: number;
}
const sources = {
  ticket_number: ['ticket_number', 'tickets.ticket_number'], title: ['title', 'tickets.title'],
  status_name: ['status', 'status_id', 'status_name', 'tickets.status_id', 'statuses'],
  priority_name: ['priority', 'priority_id', 'priority_name', 'tickets.priority_id', 'priorities'],
  is_closed: ['is_closed', 'status', 'status_id', 'tickets.status_id', 'statuses'],
  responsibility: ['responsibility', 'work', 'co_management_ticket_work'],
  entered_at: ['entered_at', 'tickets.entered_at'], updated_at: ['updated_at', 'tickets.updated_at'],
};
function snapshotRequest(input: CoManagedTicketQueueRequest): Required<Omit<CoManagedTicketQueueRequest, 'workspaceTenant'>> & { workspaceTenant?: string } {
  if (!input || !['working', 'oversight'].includes(input.view) ||
      (input.workspaceTenant !== undefined && !isCoManagedUuid(input.workspaceTenant)) ||
      (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      (input.state !== undefined && !['open', 'closed', 'all'].includes(input.state)) ||
      (input.sort !== undefined && !['updated', 'created', 'title', 'number'].includes(input.sort)) ||
      (input.direction !== undefined && !['asc', 'desc'].includes(input.direction)) ||
      (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000)) ||
      (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100))) throw new CoManagedSharedWorkError();
  return { view: input.view, workspaceTenant: input.workspaceTenant?.toLowerCase(), search: input.search ?? '', state: input.state ?? 'open',
    sort: input.sort ?? 'updated', direction: input.direction ?? 'desc', page: input.page ?? 1, pageSize: input.pageSize ?? 25 };
}

/** The compiler sees only home-policy projections. A shared ticket has no MSP
 * owner, and its queue/assignee exist only through the verified MSP work reference. */
function applyPolicy(query: Knex.QueryBuilder, subject: AuthorizationSubject, rules: BundleNarrowingRule[], shared: boolean) {
  const result = compileResourceReadAuthorizationSql(query, { resourceType: 'ticket', action: 'read', builtinRules: [], bundleRules: rules,
    ctx: { subject, adapter: { ownerColumn: 'q.auth_owner', clientColumn: 'q.auth_client', boardColumn: 'q.auth_board', teamColumn: 'q.auth_team',
      applyAssignedUsers: (builder, ids) => { builder.whereIn('q.auth_assigned', ids); } } } });
  // Do not execute a partially compiled policy if the kernel gains a new guard.
  if (!result.supported) throw new CoManagedSharedWorkError();
  const columns: Record<string, string | undefined> = { client_id: 'q.auth_client', board_id: 'q.auth_board',
    owner_user_id: shared ? undefined : 'q.auth_owner', assigned_to: 'q.auth_assigned' };
  for (const rule of rules) for (const constraint of rule.constraints ?? []) {
    const column = columns[constraint.field];
    if (!column) { query.whereRaw('false'); continue; }
    // The shared command's absent local queue/assignee is undefined, not null.
    if ((shared && constraint.field !== 'client_id') || constraint.field === 'assigned_to') query.whereNotNull(column);
    if (constraint.operator === 'eq') {
      if (isCoManagedUuid(constraint.value) || constraint.value === null) query.where(column, constraint.value);
      else query.whereRaw('false');
    }
    else if (constraint.operator === 'in' && Array.isArray(constraint.value)) {
      query.where(function () {
        this.whereIn(column, (constraint.value as unknown[]).filter(isCoManagedUuid));
        if (!shared && (constraint.value as unknown[]).includes(null)) this.orWhereNull(column);
      });
    } else query.whereRaw('false');
  }
}

/** One authorized SQL relation drives search, sorting, pagination and counts.
 * No independently paginated tenant lists, cached permissions, or shadow tickets. */
export async function getCoManagedTicketQueue(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedTicketQueueRequest): Promise<CoManagedTicketQueuePage> {
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
    const queries: Knex.QueryBuilder[] = [];
    function projection(ownerTenant: string, name: string, relationship?: any, boardIds: string[] = []) {
      const owner = tenantDb(trx, ownerTenant), shared = Boolean(relationship);
      const base = owner.table('tickets as t');
      owner.tenantJoin(base, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      owner.tenantJoin(base, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
      if (shared) {
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
        if (request.view === 'working') base.where('w.responsibility', 'msp').whereNotNull('r.reference_id');
        if (request.view === 'working' && !visible.responsibility) base.whereRaw('false');
      }
      const policyColumns = shared
        ? { auth_owner: trx.raw('NULL::uuid'), auth_client: trx.raw('?::uuid', [relationship.sponsor_client_id]), auth_board: 'r.board_id', auth_assigned: 'r.assigned_to', auth_team: 'r.assigned_team_id' }
        : { auth_owner: 't.entered_by', auth_client: 't.client_id', auth_board: 't.board_id', auth_assigned: 't.assigned_to', auth_team: 't.assigned_team_id' };
      base.select({ tenant: 't.tenant', ticket_id: 't.ticket_id', relationship_id: trx.raw('?::uuid', [relationship?.relationship_id ?? null]),
        workspace_name: trx.raw('?::text', [name]), ticket_number: 't.ticket_number', title: 't.title', status_name: 's.name', priority_name: 'p.priority_name',
        is_closed: 's.is_closed', responsibility: shared ? trx.raw("COALESCE(w.responsibility, 'customer')") : trx.raw("'msp'::text"),
        entered_at: 't.entered_at', updated_at: 't.updated_at', ...policyColumns });
      const authorized = trx.from(base.as('q'));
      applyPolicy(authorized, subject, rules, shared);
      authorized.select('q.tenant', 'q.ticket_id', 'q.relationship_id', 'q.workspace_name');
      for (const field of Object.keys(sources)) authorized.select(visible[field] ? `q.${field}` : trx.raw(`NULL::${field === 'is_closed' ? 'boolean' : ['entered_at', 'updated_at'].includes(field) ? 'timestamptz' : 'text'} as ??`, [field]));
      queries.push(authorized);
    }
    if (request.view === 'working') projection(actor.tenant, workspace.client_name);
    for (const target of discovered) {
      const owner = tenantDb(trx, target.customer_tenant);
      const relationship = await owner.table('co_management_relationships').where({ relationship_id: target.relationship_id, sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at').forShare().first();
      const customer = await owner.table('tenants').forShare().first('product_code', 'suspended_at', 'client_name');
      if (!relationship || customer?.product_code !== 'co_managed' || customer.suspended_at) continue;
      const staff = await home.table('co_management_staff_assignments').where({ customer_tenant: target.customer_tenant, relationship_id: target.relationship_id })
        .where(function () { this.where({ principal_type: 'user', principal_id: actor.userId }).orWhere(function () { this.where('principal_type', 'team').whereIn('principal_id', subject.teamIds ?? []); }); }).forShare().first();
      if (!staff) continue;
      const boards = relationship.visibility_mode === 'board_scope' ? await owner.table('co_management_board_scopes').where('relationship_id', target.relationship_id).forShare().select('board_id') : [];
      projection(target.customer_tenant, customer.client_name, relationship, boards.map(row => row.board_id));
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    if (!queries.length) return { items: [], workspaces: [], totalCount: 0, openCount: 0, closedCount: 0, page: request.page, pageSize: request.pageSize };
    const combined = trx.queryBuilder().unionAll(queries, true);
    const filtered = trx.from('authorized');
    if (request.workspaceTenant) filtered.where('tenant', request.workspaceTenant);
    if (request.search) {
      const search = `%${request.search.replace(/[\\%_]/g, '\\$&')}%`;
      filtered.where(function () { this.whereILike('title', search).orWhereILike('ticket_number', search); });
    }
    if (request.state !== 'all') filtered.where('is_closed', request.state === 'closed');
    const sort = { updated: 'updated_at', created: 'entered_at', title: 'title', number: 'ticket_number' }[request.sort];
    const page = trx.from('filtered').select('*').orderBy(sort, request.direction, 'last').orderBy('tenant').orderBy('ticket_id').limit(request.pageSize).offset((request.page - 1) * request.pageSize);
    // A single statement snapshot keeps rows and counts coherent during local ticket edits.
    const result = await trx.with('authorized', combined).with('filtered', filtered).with('page_rows', page)
      .select(trx.raw("COALESCE((SELECT json_agg(workspaces ORDER BY name, tenant) FROM (SELECT DISTINCT tenant, workspace_name AS name FROM authorized) workspaces), '[]'::json) AS workspaces"),
        trx.raw('(SELECT count(*) FROM filtered) AS total_count'),
        trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = false) AS open_count'),
        trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = true) AS closed_count'),
        trx.raw("COALESCE((SELECT json_agg(page_rows) FROM page_rows), '[]'::json) AS items")).first();
    await assertCoManagedSessionUnexpired(trx, actor);
    const items = result.items.map((row: any) => ({ tenant: row.tenant, relationshipId: row.relationship_id, ticketId: row.ticket_id, workspaceName: row.workspace_name,
      fields: Object.fromEntries(Object.keys(sources).filter(field => visible[field]).map(field => [field, row[field]])) }));
    return { items, workspaces: result.workspaces, totalCount: Number(result.total_count), openCount: Number(result.open_count), closedCount: Number(result.closed_count), page: request.page, pageSize: request.pageSize };
  });
}
