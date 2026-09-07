import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedLocalProjectSearchPolicy, isCoManagedReadFieldHidden, coManagedConversationBodySources,
  type CoManagedSearchAuthentication } from '@alga-psa/co-managed/localProjectSearchPolicy';
import type { SearchQueryOptions } from './query';

export type SearchAuthentication = CoManagedSearchAuthentication;
export const PROJECT_SEARCH_TYPES = ['project', 'project_phase', 'project_task', 'project_task_comment'] as const;

/** Search sees an admitted, redacted relation. Filtering output afterwards would
 * still expose masked terms through ranks, pagination, counts and typeahead. */
export async function withProjectSearchAccess<T>(db: Knex, tenant: string, inputUser: IUserWithRoles, authentication: SearchAuthentication | undefined,
  work: (knex: Knex, searchIndex?: SearchQueryOptions['searchIndex']) => Promise<T>): Promise<T> {
  const actor = { tenant, userId: inputUser.user_id, userType: inputUser.user_type };
  if (inputUser.tenant !== tenant) throw new Error('Search principal does not belong to this tenant');
  const auth = authentication ? { ...authentication } : undefined;
  return withTransaction(db, async trx => {
    const policy = await getCoManagedLocalProjectSearchPolicy(trx, actor, auth);
    if (!policy) return work(trx);
    const owner = tenantDb(trx, tenant), hidden = (names: readonly string[]) => isCoManagedReadFieldHidden(policy.redactedFields, names);
    // The union has a deliberately small explicit schema; cached metadata, URLs,
    // parents and vectors cannot sneak into a redacted project result.
    const columns = ['tenant', 'object_type', 'object_id', 'parent_type', 'parent_id', 'title', 'subtitle', 'body', 'url', 'metadata',
      'visible_to_user_ids', 'visible_to_roles', 'is_internal_only', 'is_private', 'client_scope_id', 'required_permission', 'search_vector', 'source_updated_at'];
    // Time search requires its own current source and private-note policy. A legacy
    // cached ACL cannot authorize newly writable operational effort.
    const ordinary = owner.table('app_search_index as i').whereNotIn('i.object_type', [...PROJECT_SEARCH_TYPES, 'time_entry']).select(columns.map(name => `i.${name}`));
    const branches: Knex.QueryBuilder[] = [ordinary];
    for (const kind of PROJECT_SEARCH_TYPES) {
      const isComment = kind === 'project_task_comment', isTask = kind === 'project_task' || isComment, isPhase = kind === 'project_phase';
      const query = owner.table('app_search_index as i').where('i.object_type', kind);
      if (isComment) query.joinRaw('JOIN project_task_comments c ON c.tenant = i.tenant AND c.task_comment_id::text = i.object_id').whereNull('c.deleted_at');
      if (isTask) query.joinRaw(`JOIN project_tasks t ON t.tenant = i.tenant AND ${isComment ? 't.task_id = c.task_id' : 't.task_id::text = i.object_id'}`);
      if (isTask || isPhase) query.joinRaw(`JOIN project_phases ph ON ph.tenant = i.tenant AND ${isTask ? 'ph.phase_id = t.phase_id' : 'ph.phase_id::text = i.object_id'}`);
      query.join(policy.projects.clone().as('p'), join => join.on('p.tenant', '=', 'i.tenant').andOn(trx.raw(isTask || isPhase ? 'p.project_id = ph.project_id' : 'p.project_id::text = i.object_id')));
      const source = isComment ? 'project_task_comments' : isTask ? 'project_tasks' : isPhase ? 'project_phases' : 'projects';
      const id = isComment ? 'task_comment_id' : isTask ? 'task_id' : isPhase ? 'phase_id' : 'project_id';
      const titleName = isTask ? 'task_name' : isPhase ? 'phase_name' : 'project_name';
      const titleTable = isTask ? 'project_tasks' : isPhase ? 'project_phases' : 'projects';
      const titleColumn = isTask ? 't.task_name' : isPhase ? 'ph.phase_name' : 'p.project_name';
      // LEVERAGE: pattern project-search-field-sources — task editors, queues and global search must hide aliases of the same canonical value.
      const title = hidden(['title', titleName, `values.${titleName}`, `${titleTable}.${titleName}`, ...(isTask ? [] : isPhase ? ['phaseName'] : ['projectName'])]) ? trx.raw('?::text', [isComment ? 'Task comment' : isTask ? 'Project task' : isPhase ? 'Project phase' : 'Project']) : trx.ref(titleColumn);
      const subtitle = kind === 'project' || hidden(['subtitle', 'project', 'projectName', 'project_name', 'values.project_name', 'projects.project_name']) ? trx.raw('NULL::text') : trx.ref('p.project_name');
      const body = hidden(['body', 'description', 'values.description', `${source}.description`, ...(isComment ? [...coManagedConversationBodySources, 'project_task_comments.note', 'project_task_comments.markdown_content'] : [])])
        ? trx.raw('NULL::text') : trx.ref(isComment ? 'i.body' : isTask ? 't.description' : isPhase ? 'ph.description' : 'p.description');
      if (hidden([id, `${source}.${id}`, 'project', 'projectId', 'project_id', 'projects.project_id', 'url', 'parent_id', 'source_updated_at', 'updated_at', 'created_at', `${source}.updated_at`, `${source}.created_at`]) ||
          (isTask && hidden(['taskId', 'task_id', 'project_tasks.task_id'])) ||
          (isComment && hidden([...coManagedConversationBodySources, 'project_task_comments', 'comment_threads']))) query.whereRaw('false');
      // An old body is not made current by an unrelated event or parent move.
      // Rolling indexes without a revision are omitted until rebuilt.
      if (isComment) query.whereRaw("i.metadata->>'sourceRevision' = c.collaboration_revision::text")
        .whereRaw("i.source_updated_at = date_trunc('milliseconds', COALESCE(c.edited_at, c.updated_at, c.created_at))");
      const parentId = isComment ? 't.task_id' : 'p.project_id';
      const suffix = isComment ? "'/tasks/' || t.task_id::text || '#comment-' || c.task_comment_id::text" : isTask ? "'/tasks/' || t.task_id::text" : isPhase ? "'/phases/' || ph.phase_id::text" : "''";
      query.select('i.tenant', 'i.object_type', 'i.object_id',
        trx.raw('?::text as parent_type', [kind === 'project' ? null : isComment ? 'project_task' : 'project']),
        trx.raw((kind === 'project' ? 'NULL::text' : parentId + '::text') + ' as parent_id'),
        { title, subtitle, body }, trx.raw(`'/msp/projects/' || p.project_id::text || ${suffix} as url`), trx.raw("'{}'::jsonb as metadata"),
        'i.visible_to_user_ids', 'i.visible_to_roles', 'i.is_internal_only', 'i.is_private', { client_scope_id: 'p.client_id' },
        trx.raw("'project:read'::text as required_permission"),
        // Filled from the masked projection below, never the cached vector.
        trx.raw("''::tsvector as search_vector"),
        { source_updated_at: isComment ? trx.ref('i.source_updated_at') : trx.raw('COALESCE(??, ??, i.source_updated_at)', [isTask ? 't.updated_at' : isPhase ? 'ph.updated_at' : 'p.updated_at', isTask ? 't.created_at' : isPhase ? 'ph.created_at' : 'p.created_at']) });
      const projected = trx.from(query.as('safe')).select(columns.map(name => name === 'search_vector'
        ? trx.raw("setweight(public.process_large_lexemes(COALESCE(safe.title, '')), 'A') || setweight(public.process_large_lexemes(COALESCE(safe.subtitle, '')), 'B') || setweight(public.process_large_lexemes(COALESCE(safe.body, '')), 'C') as search_vector") : `safe.${name}`));
      branches.push(projected);
    }
    const relation = trx.unionAll(branches, true).toSQL();
    const result = await work(trx, { sql: `(${relation.sql}) s`, bindings: [...relation.bindings] as Knex.RawBinding[] });
    await policy.assertCurrent();
    return result;
  });
}
