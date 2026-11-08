import type { Knex } from 'knex';
import type { TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';

/** The shared relation for displayed tags: tenant, entity type and audience are always enforced. */
export function displayTagsQuery(
  conn: Knex | Knex.Transaction,
  tenant: string,
  audience: TagDisplayAudience,
  taggedType: TagDisplayEntityType,
): Knex.QueryBuilder {
  const db = tenantDb(conn, tenant);
  const query = db.table('tag_mappings as dtm')
    .where('dtm.tagged_type', taggedType);
  db.tenantJoin(query, 'tag_display_rules as dtr', 'dtm.tag_id', 'dtr.tag_id', {
    rootTenantColumn: 'dtm.tenant',
    on: (join) => join.andOn('dtr.tagged_type', '=', 'dtm.tagged_type').andOnVal('dtr.audience', '=', audience),
  });
  db.tenantJoin(query, 'tag_definitions as dtd', 'dtm.tag_id', 'dtd.tag_id', {
    rootTenantColumn: 'dtm.tenant',
  });
  return query;
}

/**
 * Scalar projection for an existing entity query. No extra round trip or row multiplication;
 * missing rules, mappings or entity ids produce [], and tags follow display-rule order.
 * `entityIdColumn` is an outer query identifier, never a value or SQL expression.
 */
export function displayTagsForEntityQuery(
  conn: Knex | Knex.Transaction,
  tenant: string,
  audience: TagDisplayAudience,
  taggedType: TagDisplayEntityType,
  entityIdColumn: string,
): Knex.QueryBuilder {
  return displayTagsQuery(conn, tenant, audience, taggedType)
    .where('dtm.tagged_id', conn.ref(entityIdColumn))
    .select(conn.raw(`COALESCE(jsonb_agg(jsonb_build_object(
      'tag_id', dtd.tag_id,
      'tag_text', dtd.tag_text,
      'background_color', dtd.background_color,
      'text_color', dtd.text_color
    ) ORDER BY dtr.position), '[]'::jsonb)`));
}
