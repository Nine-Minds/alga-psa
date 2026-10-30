import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { serves } from '@alga-psa/core/capability';
import { getCoManagedLocalProjectSearchPolicy, isCoManagedReadFieldHidden, type CoManagedSearchAuthentication } from '@alga-psa/co-managed/localProjectSearchPolicy';
import { listCoManagedSharedProjects } from '@alga-psa/co-managed/projectTaskQueue';
import { isCoManagedWorkspace } from '@alga-psa/co-managed/coManagedWorkspace';
import type { CoManagedSessionActor } from '@alga-psa/co-managed/sharedWorkIdentity';
import { countSearchMatches, countSearchMatchesByType, runSearchQuery, runSearchTypeaheadQuery, type SearchIndexHit, type SearchQueryOptions } from './query';

export type SearchAuthentication = CoManagedSearchAuthentication;
export const PROJECT_SEARCH_TYPES = ['project', 'project_phase', 'project_task'] as const;
const COLUMNS = ['tenant', 'object_type', 'object_id', 'parent_type', 'parent_id', 'title', 'subtitle', 'body', 'url', 'metadata',
  'visible_to_user_ids', 'visible_to_roles', 'is_internal_only', 'is_private', 'client_scope_id', 'required_permission', 'search_vector', 'source_updated_at'];

/**
 * Builds the admitted project relation. `projects` decides which project rows exist (the policy);
 * redacted aliases are nulled, and the search vector is rebuilt from the masked projection, BEFORE
 * ranking, counts or typeahead see the relation. Filtering output afterwards would still leak masked
 * terms through ranks, pagination and counts. Comments are excluded: task conversations are L4c.
 */
function projectRelation(trx: Knex.Transaction, tenant: string, projects: Knex.QueryBuilder, redactedFields: readonly string[],
  neutralAcl: boolean, shared: { relationshipId: string } | null): Knex.QueryBuilder[] {
  const owner = tenantDb(trx, tenant), hidden = (names: readonly string[]) => isCoManagedReadFieldHidden(redactedFields, names);
  const branches: Knex.QueryBuilder[] = [];
  for (const kind of PROJECT_SEARCH_TYPES) {
    const isTask = kind === 'project_task', isPhase = kind === 'project_phase';
    const query = owner.table('app_search_index as i').where('i.object_type', kind);
    if (isTask) query.joinRaw('JOIN project_tasks t ON t.tenant = i.tenant AND t.task_id::text = i.object_id');
    if (isTask || isPhase) query.joinRaw(`JOIN project_phases ph ON ph.tenant = i.tenant AND ${isTask ? 'ph.phase_id = t.phase_id' : 'ph.phase_id::text = i.object_id'}`);
    query.join(projects.clone().as('p'), join => join.on('p.tenant', '=', 'i.tenant').andOn(trx.raw(isTask || isPhase ? 'p.project_id = ph.project_id' : 'p.project_id::text = i.object_id')));
    const source = isTask ? 'project_tasks' : isPhase ? 'project_phases' : 'projects';
    const id = isTask ? 'task_id' : isPhase ? 'phase_id' : 'project_id';
    const titleName = isTask ? 'task_name' : isPhase ? 'phase_name' : 'project_name';
    const titleColumn = isTask ? 't.task_name' : isPhase ? 'ph.phase_name' : 'p.project_name';
    // LEVERAGE: pattern project-search-field-sources — task editors, queues and global search must hide aliases of the same canonical value.
    const title = hidden(['title', titleName, `values.${titleName}`, `${source}.${titleName}`, ...(isTask ? [] : isPhase ? ['phaseName'] : ['projectName'])])
      ? trx.raw('?::text', [isTask ? 'Project task' : isPhase ? 'Project phase' : 'Project']) : trx.ref(titleColumn);
    const subtitle = kind === 'project' || hidden(['subtitle', 'project', 'projectName', 'project_name', 'values.project_name', 'projects.project_name']) ? trx.raw('NULL::text') : trx.ref('p.project_name');
    const body = hidden(['body', 'description', 'values.description', `${source}.description`]) ? trx.raw('NULL::text') : trx.ref(isTask ? 't.description' : isPhase ? 'ph.description' : 'p.description');
    if (hidden([id, `${source}.${id}`, 'project', 'projectId', 'project_id', 'projects.project_id', 'url', 'parent_id', 'source_updated_at', 'updated_at', 'created_at', `${source}.updated_at`, `${source}.created_at`]) ||
        (isTask && hidden(['taskId', 'task_id', 'project_tasks.task_id']))) query.whereRaw('false');
    const suffix = isTask ? "'/tasks/' || t.task_id::text" : isPhase ? "'/phases/' || ph.phase_id::text" : "''";
    query.select('i.tenant', 'i.object_type', 'i.object_id',
      trx.raw('?::text as parent_type', [kind === 'project' ? null : 'project']),
      trx.raw((kind === 'project' ? 'NULL::text' : 'p.project_id::text') + ' as parent_id'),
      { title, subtitle, body }, (shared
        // Shared Tasks surface addresses work by customer workspace + relationship (a locator; admission re-checks it).
        ? trx.raw(isTask ? "'/msp/co-management/tasks/' || ?::text || '/' || ?::text || '/' || t.task_id::text as url" : "'/msp/co-management/projects/' || ?::text || '/' || ?::text || '/' || p.project_id::text as url", [tenant, shared.relationshipId])
        : trx.raw(`'/msp/projects/' || p.project_id::text || ${suffix} as url`)), trx.raw("'{}'::jsonb as metadata"),
      ...(neutralAcl
        // Shared mode: the customer's index ACL describes customer principals and must not shape an MSP
        // reader's view. Project admission already decided access, so the ACL columns are projected neutrally.
        ? [trx.raw("'{}'::uuid[] as visible_to_user_ids"), trx.raw("'{}'::text[] as visible_to_roles"), trx.raw('false as is_internal_only'),
           trx.raw('false as is_private'), trx.raw('NULL::uuid as client_scope_id'), trx.raw('NULL::text as required_permission')]
        : ['i.visible_to_user_ids', 'i.visible_to_roles', 'i.is_internal_only', 'i.is_private', { client_scope_id: 'p.client_id' }, trx.raw("'project:read'::text as required_permission")]),
      trx.raw("''::tsvector as search_vector"),
      { source_updated_at: trx.raw('COALESCE(??, ??, i.source_updated_at)', [isTask ? 't.updated_at' : isPhase ? 'ph.updated_at' : 'p.updated_at', isTask ? 't.created_at' : isPhase ? 'ph.created_at' : 'p.created_at']) });
    // The vector comes from the masked projection, never the cached vector.
    branches.push(trx.from(query.as('safe')).select(COLUMNS.map(name => name === 'search_vector'
      ? trx.raw("setweight(public.process_large_lexemes(COALESCE(safe.title, '')), 'A') || setweight(public.process_large_lexemes(COALESCE(safe.subtitle, '')), 'B') || setweight(public.process_large_lexemes(COALESCE(safe.body, '')), 'C') as search_vector") : `safe.${name}`)));
  }
  return branches;
}

/** Customer-workspace staff: ordinary index minus project families, plus the admitted project relation. */
export async function withProjectSearchAccess<T>(db: Knex, tenant: string, inputUser: IUserWithRoles,
  resolveAuthentication: () => Promise<SearchAuthentication | undefined>,
  work: (knex: Knex, searchIndex?: SearchQueryOptions['searchIndex']) => Promise<T>): Promise<T> {
  // Flag off, no entitlement or kill switch: no transaction, no session lookup; the caller's knex is untouched.
  if (!(await serves('co-managed', tenant)).served) return work(db);
  // A served PSA sponsor is still native here: only a co_managed workspace gets the local project policy.
  if (!await isCoManagedWorkspace(db, tenant)) return work(db);
  const authentication = await resolveAuthentication();
  const actor = { tenant, userId: inputUser.user_id, userType: inputUser.user_type };
  if (inputUser.tenant !== tenant) throw new Error('Search principal does not belong to this tenant');
  const auth = authentication ? { ...authentication } : undefined;
  return withTransaction(db, async trx => {
    const policy = await getCoManagedLocalProjectSearchPolicy(trx, actor, auth);
    if (!policy) return work(trx);
    // Time search requires its own current source and private-note policy; project families and comments
    // are replaced here (comments are L4c), everything else keeps its own index ACL.
    const ordinary = tenantDb(trx, tenant).table('app_search_index as i')
      .whereNotIn('i.object_type', [...PROJECT_SEARCH_TYPES, 'project_task_comment', 'time_entry']).select(COLUMNS.map(name => `i.${name}`));
    const relation = trx.unionAll([ordinary, ...projectRelation(trx, tenant, policy.projects, policy.redactedFields, false, null)], true).toSQL();
    const result = await work(trx, { sql: `(${relation.sql}) s`, bindings: [...relation.bindings] as Knex.RawBinding[] });
    await policy.assertCurrent();
    return result;
  });
}

/**
 * MSP staff searching ONE relationship's shared projects. The customer's index is read tenant-locally
 * (no federation), narrowed to the projects `listCoManagedSharedProjects` re-admitted through L2, so an
 * unshared project is absent from results, counts and typeahead alike. Hands `work` the customer tenant
 * and a relation; callers must run counts and the page against the same relation.
 */
export async function withSharedProjectSearchAccess<T>(db: Knex, actor: CoManagedSessionActor, relationshipId: string,
  work: (knex: Knex, customerTenant: string, searchIndex: NonNullable<SearchQueryOptions['searchIndex']>) => Promise<T>): Promise<T> {
  const admitted: Array<{ customerTenant: string; projectId: string }> = [];
  let after: { relationshipId: string; projectId: string } | undefined;
  for (;;) {
    const page = await listCoManagedSharedProjects(db, actor, { relationshipId, limit: 100, after });
    admitted.push(...page.rows.map(row => ({ customerTenant: row.customerTenant, projectId: row.projectId })));
    if (!page.next) break;
    after = page.next;
  }
  const customerTenant = admitted[0]?.customerTenant;
  return withTransaction(db, async trx => {
    if (!customerTenant) {
      // Nothing admitted: an empty relation, still of the right shape.
      const noneTypes: Record<string, string> = { tenant: 'uuid', metadata: 'jsonb', visible_to_user_ids: 'uuid[]', visible_to_roles: 'text[]',
        is_internal_only: 'boolean', is_private: 'boolean', client_scope_id: 'uuid', search_vector: 'tsvector', source_updated_at: 'timestamptz' };
      const none = trx.raw(`(SELECT ${COLUMNS.map(c => `NULL::${noneTypes[c] ?? 'text'} AS ${c}`).join(', ')} WHERE false) s`).toSQL();
      return work(trx, actor.tenant, { sql: none.sql, bindings: [] });
    }
    const ids = admitted.map(row => row.projectId);
    const base = tenantDb(trx, customerTenant).table('projects').whereRaw('project_id = ANY(?::uuid[])', [ids])
      .select('tenant', 'project_id', 'client_id', 'project_name', 'description', 'created_at', 'updated_at');
    const projects = trx.from(base.as('q')).select('q.*');
    const relation = trx.unionAll(projectRelation(trx, customerTenant, projects, [], true, { relationshipId }), true).toSQL();
    return work(trx, customerTenant, { sql: `(${relation.sql}) s`, bindings: [...relation.bindings] as Knex.RawBinding[] });
  });
}

export interface SharedProjectSearchResult {
  results: SearchIndexHit[]; typeahead: SearchIndexHit[]; totalCount: number; groups: Record<string, number>;
}

/**
 * One relationship's shared-project search for the Shared Tasks surface. The page, the typeahead strip and
 * every count are produced in ONE `withSharedProjectSearchAccess` call from the SAME admitted relation, so a
 * masked or unshared row cannot appear in any of them. The customer's ACL columns are projected neutrally
 * (project admission already decided access), hence an internal principal with no index permissions.
 */
export async function searchSharedProjects(db: Knex, actor: CoManagedSessionActor, relationshipId: string,
  input: { query: string; limit?: number }): Promise<SharedProjectSearchResult> {
  const limit = Math.max(1, Math.min(Math.floor(Number(input.limit ?? 30)) || 30, 100));
  return withSharedProjectSearchAccess(db, actor, relationshipId, async (knex, tenant, searchIndex) => {
    const acl = { userId: actor.userId, tenant, permissions: [], roles: [], isInternal: true, clientAccess: { mode: 'all' as const } };
    const base = { knex, tenant, query: input.query, allowedTypes: [...PROJECT_SEARCH_TYPES], acl, searchIndex };
    const [results, typeahead, groups, totalCount] = await Promise.all([
      runSearchQuery({ ...base, limit, includeSnippets: false }),
      runSearchTypeaheadQuery(base),
      countSearchMatchesByType(base),
      countSearchMatches(base),
    ]);
    return { results, typeahead, groups: groups as Record<string, number>, totalCount };
  });
}
