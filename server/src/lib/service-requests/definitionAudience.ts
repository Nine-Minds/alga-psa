import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isPredicateGroup, predicateGroupSchema, validatePredicate } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup, PredicateNode } from '@alga-psa/predicates';
import { audienceSchema } from './audienceSchema';
import { isEditorAudience } from './audiencePredicate';
export { EVERYONE_PREDICATE, isAudienceSatisfied, isEditorAudience } from './audiencePredicate';

export type RequesterRecord = {
  client: { id: string; tags: string[] } | null;
  contact: { id: string; tags: string[]; group: { id: string } | null } | null;
  user: { id: string } | null;
};

/** Hydrates access attributes directly, without the display-tag permission or display rules. */
export async function loadRequesterRecord(
  knex: Knex | Knex.Transaction,
  tenant: string,
  requester: { requesterUserId: string; clientId: string; contactId?: string | null },
): Promise<RequesterRecord> {
  const db = tenantDb(knex, tenant);
  const [client, contact, user] = await Promise.all([
    db.table('clients').where({ client_id: requester.clientId }).first('client_id') as Promise<{ client_id: string } | undefined>,
    requester.contactId
      ? db.table('contacts').where({ contact_name_id: requester.contactId, client_id: requester.clientId })
          .first('contact_name_id', 'portal_visibility_group_id') as Promise<{ contact_name_id: string; portal_visibility_group_id: string | null } | undefined>
      : Promise.resolve(undefined),
    db.table('users').where({ user_id: requester.requesterUserId, user_type: 'client' }).first('user_id') as Promise<{ user_id: string } | undefined>,
  ]);
  const group = contact?.portal_visibility_group_id ? await db.table('client_portal_visibility_groups').where({ group_id: contact.portal_visibility_group_id, client_id: requester.clientId }).first('group_id') as { group_id: string } | undefined : undefined;
  const tags = await db.table('tag_mappings').where((query) => {
    if (client) query.orWhere({ tagged_type: 'client', tagged_id: client.client_id });
    if (contact) query.orWhere({ tagged_type: 'contact', tagged_id: contact.contact_name_id });
    if (!client && !contact) query.whereRaw('false');
  }).select('tagged_type', 'tag_id') as Array<{ tagged_type: string; tag_id: string }>;
  return {
    client: client ? { id: client.client_id, tags: tags.filter((t) => t.tagged_type === 'client').map((t) => t.tag_id) } : null,
    contact: contact ? {
      id: contact.contact_name_id,
      tags: tags.filter((t) => t.tagged_type === 'contact').map((t) => t.tag_id),
      group: group ? { id: group.group_id } : null,
    } : null,
    user: user ? { id: user.user_id } : null,
  };
}

export function audienceClauses(node: PredicateNode): PredicateClause[] {
  return isPredicateGroup(node) ? node.clauses.flatMap(audienceClauses) : [node];
}

/** Validates references and client/group exclusivity using only rows from this tenant. */
export async function validateAudienceReferences(knex: Knex | Knex.Transaction, tenant: string, value: unknown): Promise<string[]> {
  const parsed = predicateGroupSchema.safeParse(value);
  if (!parsed.success || validatePredicate(audienceSchema, parsed.data).length) return ['Invalid audience predicate'];
  const db = tenantDb(knex, tenant);
  const clauses = audienceClauses(parsed.data);
  const entries: Array<[string, string, string, string | null]> = [
    ['client.id', 'clients', 'client_id', null], ['contact.id', 'contacts', 'contact_name_id', null],
    ['contact.group.id', 'client_portal_visibility_groups', 'group_id', null], ['user.id', 'users', 'user_id', null],
    ['client.tags', 'tag_definitions', 'tag_id', 'client'], ['contact.tags', 'tag_definitions', 'tag_id', 'contact'],
  ];
  const errors: string[] = [];
  let clientIds: string[] = [];
  let groups: Array<{ group_id: string; client_id: string }> = [];
  for (const [path, table, column, taggedType] of entries) {
    const ids = [...new Set(clauses.filter((clause) => clause.path === path).flatMap((clause) => Array.isArray(clause.value) ? clause.value.filter((v): v is string => typeof v === 'string') : []))];
    if (!ids.length) continue;
    const query = db.table(table).whereIn(column, ids);
    if (taggedType) query.where({ tagged_type: taggedType });
    if (path === 'user.id') query.where({ user_type: 'client' });
    const rows = await query.select(column, ...(path === 'contact.group.id' ? ['client_id'] : [])) as Array<Record<string, string>>;
    if (rows.length !== ids.length) errors.push(`Audience references missing or inaccessible ${path}`);
    if (path === 'client.id') clientIds = ids;
    if (path === 'contact.group.id') groups = rows as Array<{ group_id: string; client_id: string }>;
  }
  if (isEditorAudience(value) && groups.some((group) => clientIds.includes(group.client_id))) errors.push('Choose either all users or specific groups for a client');
  for (const clause of isEditorAudience(value) ? clauses.filter((entry) => entry.path === 'contact.group.id') : []) {
    const groupIds = Array.isArray(clause.value) ? clause.value : [];
    const owners = new Set(groups.filter((group) => groupIds.includes(group.group_id)).map((group) => group.client_id));
    if (owners.size > 1) errors.push('Groups in one entry must belong to the same client');
  }
  return errors;
}

export function audienceTagIds(value: PredicateGroup): string[] {
  return [...new Set(audienceClauses(value).filter((clause) => clause.path === 'client.tags' || clause.path === 'contact.tags')
    .flatMap((clause) => Array.isArray(clause.value) ? clause.value.filter((v): v is string => typeof v === 'string') : []))];
}

/** Remove stale selections from an editable working copy without widening narrowed entries. */
export async function cleanAudienceReferences(knex: Knex | Knex.Transaction, tenant: string, value: PredicateGroup): Promise<{ audience: PredicateGroup; removed: string[] }> {
  if (!isEditorAudience(value) || value.join !== 'or') return { audience: value, removed: [] };
  const db = tenantDb(knex, tenant);
  const sources: Record<string, { table: string; column: string; type?: string }> = {
    'client.id': { table: 'clients', column: 'client_id' },
    'contact.id': { table: 'contacts', column: 'contact_name_id' },
    'contact.group.id': { table: 'client_portal_visibility_groups', column: 'group_id' },
    'client.tags': { table: 'tag_definitions', column: 'tag_id', type: 'client' },
    'contact.tags': { table: 'tag_definitions', column: 'tag_id', type: 'contact' },
  };
  const available = new Map<string, Set<string>>();
  const removed = new Set<string>();
  for (const [path, source] of Object.entries(sources)) {
    const ids = [...new Set(audienceClauses(value).filter((part) => part.path === path).flatMap((part) => Array.isArray(part.value) ? part.value.filter((id): id is string => typeof id === 'string') : []))];
    if (!ids.length) continue;
    const query = db.table(source.table).whereIn(source.column, ids);
    if (source.type) query.where({ tagged_type: source.type });
    const rows = await query.select(source.column) as Array<Record<string, string>>;
    available.set(path, new Set(rows.map((row) => row[source.column])));
  }
  const cleanClause = (part: PredicateClause): PredicateClause | null => {
    const ids = Array.isArray(part.value) ? part.value.filter((id): id is string => typeof id === 'string') : [];
    const kept = ids.filter((id) => available.get(part.path)?.has(id));
    if (kept.length !== ids.length) removed.add(part.path);
    return kept.length ? { ...part, value: kept } : null;
  };
  const clauses = value.clauses.flatMap((entry): PredicateNode[] => {
    if (!isPredicateGroup(entry)) { const part = cleanClause(entry); return part ? [part] : []; }
    const base = cleanClause(entry.clauses[0] as PredicateClause);
    const narrowing = cleanClause(entry.clauses[1] as PredicateClause);
    return base && narrowing ? [{ join: 'and', clauses: [base, narrowing] }] : [];
  });
  return { audience: { join: 'or', clauses }, removed: [...removed] };
}
