import type { Knex } from 'knex';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
/** Native task comments were internal-only even when the legacy thread flag
 * was false. Only explicit, consistent metadata can make them shared. */
export function projectTaskAudienceSql(db: Knex, alias: string) {
  return db.raw("CASE WHEN ??.collaboration_audience = 'requester' AND ??.is_internal = false THEN 'requester' WHEN ??.collaboration_audience = 'shared_it' AND ??.is_internal = true THEN 'shared_it' ELSE 'organization_private' END", [alias, alias, alias, alias]);
}
export function projectTaskAudience(thread: { collaboration_audience?: string | null; is_internal?: boolean | null }): CommentAudience {
  return thread.collaboration_audience === 'requester' && thread.is_internal === false ? 'requester' :
    thread.collaboration_audience === 'shared_it' && thread.is_internal === true ? 'shared_it' : 'organization_private';
}
