import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedLocalPermission } from './localPermission';
import { applyCoManagedQueuePolicy } from './queuePolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedTaskQueueRequest {
  view: 'working' | 'oversight'; workspaceTenant?: string; search?: string; state?: 'open' | 'closed' | 'all';
  assignment?: 'all' | 'mine' | 'my_teams'; sort?: 'updated' | 'due' | 'name' | 'project'; direction?: 'asc' | 'desc'; page?: number; pageSize?: number;
}
export interface CoManagedTaskQueueItem {
  tenant: string; relationshipId: string | null; taskId: string; projectId?: string; workspaceName?: string;
  fields: { task_name?: string | null; project_name?: string | null; phase_name?: string | null; status_name?: string | null;
    is_closed?: boolean | null; due_date?: string | null; updated_at?: string | null; assignee_name?: string | null };
}
export interface CoManagedTaskQueuePage {
  items: CoManagedTaskQueueItem[]; workspaces: Array<{ tenant: string; name: string }>;
  totalCount: number; openCount: number; closedCount: number; page: number; pageSize: number; canOversight: boolean;
}
// LEVERAGE: pattern project-search-field-sources — task editors, queues and global search must hide aliases of the same canonical value.
const sources = {
  task_name: ['task_name', 'values.task_name', 'project_tasks.task_name'], project_name: ['project', 'projectName', 'project_id', 'project_name', 'projects'],
  phase_name: ['phase', 'phaseName', 'phase_id', 'phase_name', 'project_phases'],
  status_name: ['status', 'status_id', 'status_name', 'selectedStatus', 'project_status_mapping_id', 'values.project_status_mapping_id', 'project_tasks.project_status_mapping_id', 'project_status_mappings', 'statuses', 'standard_statuses'],
  is_closed: ['is_closed', 'status', 'status_id', 'status_name', 'selectedStatus', 'values.project_status_mapping_id', 'project_status_mapping_id', 'project_tasks.project_status_mapping_id', 'project_status_mappings', 'statuses', 'standard_statuses'],
  due_date: ['due_date', 'values.due_date', 'project_tasks.due_date'], updated_at: ['updated_at', 'project_tasks.updated_at'],
  assignee_name: ['assignee', 'assignee_name', 'mspAssignment', 'msp_assignment', 'assigned_to', 'assigned_team_id', 'project_tasks.assigned_to', 'project_tasks.assigned_team_id', 'users', 'teams', 'task_resources', 'co_managed_project_task_references'],
};
const deny = () => { throw new CoManagedSharedWorkError(); };
function requestSnapshot(input: CoManagedTaskQueueRequest) {
  if (!input || !['working', 'oversight'].includes(input.view) || (input.workspaceTenant !== undefined && !isCoManagedUuid(input.workspaceTenant)) ||
    (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200 || input.search.includes('\0'))) ||
    (input.state !== undefined && !['open', 'closed', 'all'].includes(input.state)) || (input.assignment !== undefined && !['all', 'mine', 'my_teams'].includes(input.assignment)) ||
    (input.sort !== undefined && !['updated', 'due', 'name', 'project'].includes(input.sort)) || (input.direction !== undefined && !['asc', 'desc'].includes(input.direction)) ||
    (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000)) ||
    (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100))) deny();
  return { view: input.view, workspaceTenant: input.workspaceTenant?.toLowerCase(), search: input.search ?? '', state: input.state ?? 'open',
    assignment: input.assignment ?? 'all', sort: input.sort ?? 'updated', direction: input.direction ?? 'desc', page: input.page ?? 1, pageSize: input.pageSize ?? 25 };
}

/** Native work and shared tasks are one authorized SQL relation before any
 * filtering or pagination. Sharing alone never creates an MSP working row. */
export async function getCoManagedProjectTaskQueue(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedTaskQueueRequest): Promise<CoManagedTaskQueuePage> {
  const actor = snapshotCoManagedSessionActor(inputActor), request = requestSnapshot(input);
  return withTransaction(db, async trx => {
    const home = tenantDb(trx, actor.tenant), initial = await home.table('tenants').first('product_code');
    // LEVERAGE: pattern co-managed-read-admission — lifecycle before retained home identity, followed by current relationship/staff checks.
    const teams = (await home.table('team_members').where('user_id', actor.userId).select('team_id')).map(row => row.team_id);
    const discovered = initial?.product_code === 'psa' ? await home.table('co_management_staff_assignments').where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
      .orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', teams))).distinct('customer_tenant', 'relationship_id').orderBy('customer_tenant').orderBy('relationship_id') : [];
    if (initial?.product_code === 'co_managed') await getCoManagedOperationalState(trx, actor.tenant);
    for (const target of discovered) if (await tenantDb(trx, target.customer_tenant).table('tenants').first('tenant')) await getCoManagedOperationalState(trx, target.customer_tenant);
    const workspace = await home.table('tenants').forShare().first('product_code', 'suspended_at', 'client_name');
    if (!['psa', 'co_managed'].includes(workspace?.product_code) || workspace.suspended_at || workspace.product_code !== initial.product_code) deny();
    const customerHome = workspace.product_code === 'co_managed';
    let localRelationship: any = null;
    if (customerHome) {
      localRelationship = await home.table('co_management_relationships').where('state', 'active').whereNull('ended_at').forShare().first();
      if (!localRelationship || request.view !== 'working') deny();
      const sponsor = await tenantDb(trx, localRelationship.sponsor_tenant).table('tenants').forShare().first('product_code', 'suspended_at');
      if (sponsor?.product_code !== 'psa' || sponsor.suspended_at) deny();
    }
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'project', 'read', true)) deny();
    const rules = (await resolveBundleNarrowingRulesForEvaluation(trx, { subject, resource: { type: 'project', action: 'read' }, knex: trx }, { lock: true }))
      .filter(rule => rule.resource === 'project' && rule.action === 'read');
    const redactions = rules.flatMap(rule => rule.redactedFields ?? []), masked = (fields: string[]) => isCoManagedReadFieldHidden(redactions, fields);
    const visible = Object.fromEntries(Object.entries(sources).map(([field, aliases]) => [field, !masked(aliases)]));
    const workspaceVisible = !masked(['client_name', 'organizationName', 'workspaceName', 'tenants']);
    const projectIdVisible = !masked(['project', 'projectId', 'project_id', 'projects']);
    const queries: Knex.QueryBuilder[] = [];
    function projection(ownerTenant: string, name: string, relationship: any, foreign: boolean, projectIds: string[] = []) {
      const owner = tenantDb(trx, ownerTenant), base = owner.table('project_tasks as t');
      owner.tenantJoin(base, 'project_phases as phase', 't.phase_id', 'phase.phase_id');
      owner.tenantJoin(base, 'projects as p', 'phase.project_id', 'p.project_id');
      owner.tenantJoin(base, 'project_status_mappings as mapping', 't.project_status_mapping_id', 'mapping.project_status_mapping_id', { type: 'left',
        on: join => join.andOn('mapping.project_id', '=', 'p.project_id').andOn(nested => nested.on('mapping.phase_id', '=', 'phase.phase_id').orOn(fallback =>
          fallback.onNull('mapping.phase_id').onNotExists(function () { this.select(trx.raw('1')).from('project_status_mappings as overrides')
            .whereRaw('?? = ?? AND ?? = ?? AND ?? = ??', ['overrides.tenant', 't.tenant', 'overrides.project_id', 'p.project_id', 'overrides.phase_id', 'phase.phase_id']); }))) });
      owner.tenantJoin(base, 'statuses as s', 'mapping.status_id', 's.status_id', { type: 'left' });
      owner.tenantJoin(base, 'standard_statuses as ss', 'mapping.standard_status_id', 'ss.standard_status_id', { type: 'left' });
      if (foreign) {
        base.whereIn('p.project_id', projectIds);
        home.tenantJoin(base, 'co_managed_project_task_references as r', 't.task_id', 'r.task_id', { type: 'left', tenantPredicate: 'literal',
          on: join => join.andOn('r.customer_tenant', '=', trx.raw('?::uuid', [ownerTenant])).andOn('r.relationship_id', '=', trx.raw('?::uuid', [relationship.relationship_id]))
            .andOn('r.client_id', '=', trx.raw('?::uuid', [relationship.sponsor_client_id])).andOn('r.active', '=', trx.raw('true')) });
        if (request.view === 'working') { base.whereNotNull('r.reference_id'); if (!visible.assignee_name) base.whereRaw('false'); }
      } else {
        owner.tenantJoin(base, 'users as u', 't.assigned_to', 'u.user_id', { type: 'left' });
        owner.tenantJoin(base, 'teams as team', 't.assigned_team_id', 'team.team_id', { type: 'left' });
      }
      if (masked(['task_id', 'project_tasks.task_id'])) base.whereRaw('false');
      if (request.assignment !== 'all') {
        if (!visible.assignee_name) base.whereRaw('false');
        else if (request.assignment === 'my_teams') base.whereIn(foreign ? 'r.assigned_team_id' : 't.assigned_team_id', subject.teamIds ?? []);
        else if (foreign) base.where('r.assigned_to', actor.userId);
        else base.where(query => query.where('t.assigned_to', actor.userId).orWhereExists(owner.table('task_resources as additional')
          .whereRaw('?? = ??', ['additional.task_id', 't.task_id']).where('additional.additional_user_id', actor.userId).select(trx.raw('1'))));
      }
      base.select({ tenant: 't.tenant', task_id: 't.task_id', project_id: 'p.project_id', relationship_id: trx.raw('?::uuid', [relationship?.relationship_id ?? null]),
        workspace_name: trx.raw('?::text', [name]), task_name: 't.task_name', project_name: 'p.project_name', phase_name: 'phase.phase_name',
        status_name: trx.raw('COALESCE(mapping.custom_name, s.name, ss.name)'), is_closed: trx.raw('COALESCE(s.is_closed, ss.is_closed, false)'),
        due_date: 't.due_date', updated_at: 't.updated_at',
        assignee_name: foreign ? 'r.assignee_name' : trx.raw("NULLIF(CONCAT_WS(' · ', NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), ''), team.team_name), '')"),
        auth_owner: foreign || customerHome ? trx.raw('NULL::uuid') : 'p.assigned_to', auth_client: foreign ? trx.raw('?::uuid', [relationship.sponsor_client_id]) : 'p.client_id',
        auth_board: trx.raw('NULL::uuid'), auth_assigned: foreign ? 'r.assigned_to' : 'p.assigned_to', auth_team: foreign ? 'r.assigned_team_id' : trx.raw('NULL::uuid') });
      const authorized = trx.from(base.as('q'));
      applyCoManagedQueuePolicy(authorized, subject, rules, { resourceType: 'project', shared: foreign, ownerAvailable: !foreign && !customerHome, boardAvailable: false });
      authorized.select('q.tenant', 'q.task_id', 'q.relationship_id', projectIdVisible ? 'q.project_id' : trx.raw('NULL::uuid as project_id'),
        workspaceVisible ? 'q.workspace_name' : trx.raw('NULL::text as workspace_name'));
      for (const field of Object.keys(sources)) authorized.select(visible[field] ? `q.${field}` : trx.raw(`NULL::${field === 'is_closed' ? 'boolean' : ['due_date', 'updated_at'].includes(field) ? 'timestamptz' : 'text'} as ??`, [field]));
      queries.push(authorized);
    }
    if (request.view === 'working') projection(actor.tenant, workspace.client_name, localRelationship, false);
    for (const target of discovered) {
      const owner = tenantDb(trx, target.customer_tenant);
      const relationship = await owner.table('co_management_relationships').where({ relationship_id: target.relationship_id, sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at').forShare().first();
      const customer = await owner.table('tenants').forShare().first('product_code', 'suspended_at', 'client_name');
      if (!relationship || customer?.product_code !== 'co_managed' || customer.suspended_at) continue;
      const staff = await home.table('co_management_staff_assignments').where({ customer_tenant: target.customer_tenant, relationship_id: target.relationship_id })
        .where(query => query.where({ principal_type: 'user', principal_id: actor.userId }).orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', subject.teamIds ?? []))).forShare().first();
      if (!staff) continue;
      const projects = await owner.table('co_management_project_scopes').where('relationship_id', target.relationship_id).forShare().select('project_id');
      await home.table('co_managed_project_task_references').where({ customer_tenant: target.customer_tenant, relationship_id: target.relationship_id }).forShare().select('reference_id');
      projection(target.customer_tenant, customer.client_name, relationship, true, projects.map(row => row.project_id));
    }
    const empty = { items: [], workspaces: [], totalCount: 0, openCount: 0, closedCount: 0, page: request.page, pageSize: request.pageSize, canOversight: !customerHome };
    await assertCoManagedSessionUnexpired(trx, actor); if (!queries.length) return empty;
    const combined = trx.queryBuilder().unionAll(queries, true), filtered = trx.from('authorized');
    if (request.workspaceTenant) filtered.where('tenant', request.workspaceTenant);
    if (request.search) {
      const search = `%${request.search.replace(/[\\%_]/g, '\\$&')}%`;
      filtered.where(query => query.whereILike('task_name', search).orWhereILike('project_name', search).orWhereILike('phase_name', search));
    }
    if (request.state !== 'all') filtered.where('is_closed', request.state === 'closed');
    const sort = { updated: 'updated_at', due: 'due_date', name: 'task_name', project: 'project_name' }[request.sort];
    const page = trx.from('filtered').select('*').orderBy(sort, request.direction, 'last').orderBy('tenant').orderBy('task_id').limit(request.pageSize).offset((request.page - 1) * request.pageSize);
    const result = await trx.with('authorized', combined).with('filtered', filtered).with('page_rows', page).select(
      trx.raw("COALESCE((SELECT json_agg(workspaces ORDER BY name, tenant) FROM (SELECT DISTINCT tenant, workspace_name AS name FROM authorized WHERE workspace_name IS NOT NULL) workspaces), '[]'::json) AS workspaces"),
      trx.raw('(SELECT count(*) FROM filtered) AS total_count'), trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = false) AS open_count'),
      trx.raw('(SELECT count(*) FROM filtered WHERE is_closed = true) AS closed_count'), trx.raw("COALESCE((SELECT json_agg(page_rows) FROM page_rows), '[]'::json) AS items")).first();
    await assertCoManagedSessionUnexpired(trx, actor);
    return { ...empty, totalCount: Number(result.total_count), openCount: Number(result.open_count), closedCount: Number(result.closed_count), workspaces: result.workspaces,
      items: result.items.map((row: any) => ({ tenant: row.tenant, relationshipId: row.relationship_id, taskId: row.task_id,
        ...(projectIdVisible ? { projectId: row.project_id } : {}), ...(workspaceVisible ? { workspaceName: row.workspace_name } : {}),
        fields: Object.fromEntries(Object.keys(sources).filter(field => visible[field]).map(field => [field, row[field]])) })) };
  });
}
