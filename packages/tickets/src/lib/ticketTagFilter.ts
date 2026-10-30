import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import type { PredicateGroup } from '@alga-psa/predicates';
import { createTicketQuerySchema } from './ticketQuerySchema';

/**
 * Resolves legacy ticket tag TEXT (the toolbar / URL wire format of `ITicketListFilters.tags`) to
 * ticket tag definition ids. Unknown texts are absent from the result.
 */
export async function resolveTicketTagIdsByText(
  conn: Knex | Knex.Transaction,
  tenant: string,
  texts: readonly string[] | undefined,
): Promise<Record<string, string>> {
  const byText: Record<string, string> = {};
  if (!texts || texts.length === 0) return byText;
  const rows = await tenantDb(conn, tenant)
    .table('tag_definitions')
    .select('tag_id', 'tag_text')
    .where('tagged_type', 'ticket')
    .whereIn('tag_text', texts as string[]);
  for (const row of rows as Array<{ tag_id: string; tag_text: string }>) {
    byText[row.tag_text] = row.tag_id;
  }
  return byText;
}

/**
 * Compiles a tag-id filter through the predicate compiler (path `tags`, keyed by tag_id) as a
 * tenant-correlated boolean over the `t` ticket alias. An empty id list matches nothing.
 */
export function compileTicketTagIdsFilter(tagIds: readonly string[]): { sql: string; bindings: unknown[] } {
  const group: PredicateGroup = {
    join: 'and',
    clauses: [{ path: 'tags', operator: 'in', value: Array.from(new Set(tagIds)) }],
  };
  return compilePredicateFragment(createTicketQuerySchema(() => new Date().toISOString()), group, { rootAlias: 't' });
}
