import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { ITag, IUserWithRoles, TaggedEntityType } from '@alga-psa/types';
import { resolveTagReadScope } from './tagReadScope';

/**
 * Distinct tag definitions of one entity type that the user may see: the body of the
 * `findAllTagsByType` action, shared with the batched reference-list loader so both narrow the
 * list identically (`resolveTagReadScope`). Not a server action; the caller supplies the
 * authenticated user and tenant. Throws on failure; the action maps expected failures.
 */
export async function loadTagsByType(
  db: Knex,
  tenant: string,
  user: IUserWithRoles,
  entityType: TaggedEntityType
): Promise<ITag[]> {
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    // Get tag definitions that have at least one mapping or reference (filter out orphans)
    // Use DISTINCT ON for deduplication by tag_text (PostgreSQL-specific but works with Citus)
    const scopedDb = tenantDb(trx, tenant);
    const tagMappingsQuery = scopedDb.table('tag_mappings as tm')
      .select(trx.raw('1'))
      .whereRaw('?? = ??', ['tm.tag_id', 'td.tag_id']);
    scopedDb.tenantWhereColumn(tagMappingsQuery, 'tm.tenant', 'td.tenant');

    // A definition something refers to is listed even with no mappings, so a referrer's tag can
    // still be picked in filters and settings.
    const tagReferencesQuery = scopedDb.table('tag_references as tr')
      .select(trx.raw('1'))
      .whereRaw('?? = ??', ['tr.tag_id', 'td.tag_id']);
    scopedDb.tenantWhereColumn(tagReferencesQuery, 'tr.tenant', 'td.tenant');

    // A narrowed subject is offered only tags attached to records it may read (see resolveTagReadScope).
    const readScope = await resolveTagReadScope(trx, tenant, user);
    const definitions = await scopedDb.table('tag_definitions as td')
      .distinctOn('td.tag_text')
      .select('td.*')
      .where('td.tagged_type', entityType)
      .where((builder) => builder.whereExists(tagMappingsQuery).orWhereExists(tagReferencesQuery))
      .modify((query) => readScope?.applyToDefinitions(query, 'td'))
      .orderBy('td.tag_text', 'asc')
      .orderBy('td.created_at', 'asc');

    // Convert to ITag format (use definition ID as tag_id since these are unique)
    return definitions.map((def: any) => ({
      tag_id: def.tag_id,
      tenant,
      board_id: def.board_id || undefined,
      tag_text: def.tag_text,
      tagged_id: '', // No specific entity for unique tags
      tagged_type: def.tagged_type,
      background_color: def.background_color,
      text_color: def.text_color
    }));
  });
}
