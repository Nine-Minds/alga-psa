import type { Knex } from 'knex';

import { composeAclHints } from './acl';
import { buildTsvectorSql } from './sql';
import type { SearchDoc, SearchObjectType } from '@alga-psa/types';

export async function upsertSearchDoc(knex: Knex, doc: SearchDoc): Promise<void> {
  const vector = buildTsvectorSql(doc.title, doc.subtitle, doc.body);
  const acl = composeAclHints(doc.acl);
  // Citus rejects non-IMMUTABLE functions (e.g. now()) in the DO UPDATE SET
  // target list of upserts on distributed tables, so bind the timestamp here.
  const indexedAt = new Date();

  await knex.raw(
    `
      INSERT INTO app_search_index (
        tenant,
        object_type,
        object_id,
        parent_type,
        parent_id,
        title,
        subtitle,
        body,
        url,
        metadata,
        visible_to_user_ids,
        visible_to_roles,
        is_internal_only,
        is_private,
        client_scope_id,
        required_permission,
        search_vector,
        search_lang,
        source_updated_at,
        indexed_at
      )
      VALUES (
        ?::uuid,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?::jsonb,
        ?::uuid[],
        ?::text[],
        ?,
        ?,
        ?::uuid,
        ?,
        ${vector.sql},
        'english',
        ?,
        ?
      )
      ON CONFLICT (tenant, object_type, object_id)
      DO UPDATE SET
        parent_type = EXCLUDED.parent_type,
        parent_id = EXCLUDED.parent_id,
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        body = EXCLUDED.body,
        url = EXCLUDED.url,
        metadata = EXCLUDED.metadata,
        visible_to_user_ids = EXCLUDED.visible_to_user_ids,
        visible_to_roles = EXCLUDED.visible_to_roles,
        is_internal_only = EXCLUDED.is_internal_only,
        is_private = EXCLUDED.is_private,
        client_scope_id = EXCLUDED.client_scope_id,
        required_permission = EXCLUDED.required_permission,
        search_vector = EXCLUDED.search_vector,
        search_lang = EXCLUDED.search_lang,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = ?
    `,
    [
      doc.tenant,
      doc.objectType,
      doc.objectId,
      doc.parentType ?? null,
      doc.parentId ?? null,
      doc.title,
      doc.subtitle ?? null,
      doc.body ?? null,
      doc.url,
      JSON.stringify(doc.metadata ?? {}),
      acl.visibleToUserIds,
      acl.visibleToRoles,
      acl.isInternalOnly,
      acl.isPrivate,
      acl.clientScopeId ?? null,
      acl.requiredPermission ?? null,
      ...vector.bindings,
      doc.sourceUpdatedAt,
      indexedAt,
      indexedAt,
    ] as Knex.RawBinding[],
  );
}

export async function deleteSearchDoc(
  knex: Knex,
  tenant: string,
  objectType: SearchObjectType,
  objectId: string,
): Promise<void> {
  await knex('app_search_index')
    .where({ tenant, object_type: objectType, object_id: objectId })
    .delete();
}
