import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  parentVisibleViaChildClients,
  polymorphicClientsHook,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import {
  applyReadScope,
  resolveNarrowedReadScope,
  type NarrowedReadScope,
} from '@alga-psa/authorization/readScope';

/**
 * What a narrowed subject may read of the tag lists.
 *
 * A tag mapping is read when the record it is attached to belongs to a client in scope (the
 * tagged_entity resolver). A tag definition is read when SOME mapping of it is: the same
 * parent-visible-via-polymorphic-child rule documents use (`parentVisibleViaChildClients`).
 * Kinds with no client (workflow_form, knowledge_base_article, document) and definitions
 * nothing is mapped to resolve to no client, so they are not read: fail closed.
 *
 * Tags follow the `tag` resource type. A subject with no bundle rule naming it is not narrowed.
 */
export interface TagReadScope {
  /** Narrow a query over `tag_mappings` (aliased `mappingAlias`) to mappings on readable records. */
  applyToMappings(query: Knex.QueryBuilder, mappingAlias: string): void;
  /** Narrow a query over `tag_definitions` (aliased `definitionAlias`) to definitions with a readable mapping. */
  applyToDefinitions(query: Knex.QueryBuilder, definitionAlias: string): void;
}

// Tags have no owner, assignee, team or client-visibility column: those templates match nothing.
const noOwnerAdapter = {
  applyAssignedUsers: (builder: Knex.QueryBuilder) => {
    builder.whereRaw('1 = 0');
  },
} satisfies Pick<RelationshipSqlAdapter, 'applyAssignedUsers'>;

/** The subject's tag read scope, or null when nothing narrows it: add no clause. */
export async function resolveTagReadScope(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<TagReadScope | null> {
  const scope: NarrowedReadScope | null = await resolveNarrowedReadScope(conn, {
    tenant,
    user,
    resourceType: 'tag',
  });
  if (!scope) return null;

  return {
    applyToMappings(query, mappingAlias) {
      applyReadScope(query, scope, {
        resourceType: 'tag',
        adapter: { ...noOwnerAdapter, applyClients: polymorphicClientsHook('tag_mappings', mappingAlias) },
      });
    },
    applyToDefinitions(query, definitionAlias) {
      applyReadScope(query, scope, {
        resourceType: 'tag',
        adapter: {
          ...noOwnerAdapter,
          applyClients: parentVisibleViaChildClients(
            { table: 'tag_mappings', parentKeyColumn: 'tag_id', alias: 'scope_tm' },
            { tenantRef: `${definitionAlias}.tenant`, keyRef: `${definitionAlias}.tag_id` }
          ),
        },
      });
    },
  };
}
