import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

const LIST_SEARCH_TSQUERY_UNSAFE_RE = /[^\p{L}\p{N}\s]+/gu;
export const LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN = /\b[A-Z]+-?\d+\b/i;
export const CONTACT_LIST_SEARCH_TYPES = ['contact', 'document', 'interaction'] as const;

export function buildListSearchPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(LIST_SEARCH_TSQUERY_UNSAFE_RE, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(' & ');
}

export function tenantScopedDerivedTableSql(
  facade: ReturnType<typeof tenantDb>,
  tableName: string,
  alias: string
): { subquery: Knex.QueryBuilder; sql: string; bindings: Knex.RawBinding[] } {
  const subquery = facade
    .subquery(tableName)
    .select('*')
    .as(alias);
  const scoped = subquery.toSQL();

  return {
    subquery,
    // Knex ignores .as() when compiling a top-level builder, so wrap the
    // fragment ourselves — it is interpolated into raw FROM clauses.
    sql: `(${scoped.sql}) ${alias}`,
    bindings: scoped.bindings as Knex.RawBinding[],
  };
}

export function tenantJoinSubquerySql(
  facade: ReturnType<typeof tenantDb>,
  conn: Knex | Knex.Transaction,
  subquery: Knex.QueryBuilder | Knex.Raw,
  left: string | Knex.Raw,
  right: string | Knex.Raw,
  options: Parameters<ReturnType<typeof tenantDb>['tenantJoinSubquery']>[4]
): { sql: string; bindings: Knex.RawBinding[] } {
  const fragmentSource = (conn as Knex)('__tenant_join_fragment__').select(conn.raw('1'));

  facade.tenantJoinSubquery(
    fragmentSource,
    subquery as unknown as Knex.QueryBuilder,
    left as unknown as string,
    right as unknown as string,
    options
  );

  const compiled = fragmentSource.toSQL();
  const marker = ' from "__tenant_join_fragment__" ';
  const markerIndex = compiled.sql.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error('Unable to compile tenant join subquery SQL fragment');
  }

  return {
    sql: compiled.sql.slice(markerIndex + marker.length),
    bindings: compiled.bindings as Knex.RawBinding[],
  };
}

export function applyClientListIndexedSearchFilter(
  trx: Knex.Transaction,
  baseQuery: Knex.QueryBuilder,
  tenant: string,
  user: { user_id: string; user_type?: string; clientId?: string | null },
  rawSearchInput: string | undefined,
  permissions: string[]
): Knex.QueryBuilder {
  const rawSearch = rawSearchInput?.replace(/\s+/g, ' ').trim();
  if (!rawSearch) {
    return baseQuery;
  }

  const prefixTsquery = buildListSearchPrefixTsquery(rawSearch);
  const identifier = rawSearch.match(LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN)?.[0]?.toLowerCase() ?? null;
  const isInternalUser = user.user_type !== 'client';
  const clientScopePredicate = isInternalUser
    ? 'TRUE'
    : user.clientId
      ? '(si.client_scope_id IS NULL OR si.client_scope_id = ?::uuid)'
      : 'si.client_scope_id IS NULL';
  const clientScopeBindings = isInternalUser || !user.clientId ? [] : [user.clientId];
  const ilikePattern = `%${rawSearch}%`;
  const scopedDb = tenantDb(trx, tenant);
  const searchIndex = tenantScopedDerivedTableSql(scopedDb, 'app_search_index', 'si');
  const interactions = tenantScopedDerivedTableSql(scopedDb, 'interactions', 'im');
  const documentAssociations = tenantScopedDerivedTableSql(scopedDb, 'document_associations', 'da');
  const titleSearchClients = tenantScopedDerivedTableSql(scopedDb, 'clients', 'c2');
  const locationSearchClients = tenantScopedDerivedTableSql(scopedDb, 'client_locations', 'cl_search');
  const interactionJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    interactions.subquery,
    trx.raw('??::text', ['im.interaction_id']),
    'si.object_id',
    {
      rootTenantColumn: 'si.tenant',
      joinedTenantColumn: 'im.tenant',
    }
  );
  const documentAssociationJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    documentAssociations.subquery,
    trx.raw('??::text', ['da.document_id']),
    'si.object_id',
    {
      rootTenantColumn: 'si.tenant',
      joinedTenantColumn: 'da.tenant',
      on: (join) => {
        join.andOn('da.entity_type', '=', trx.raw("'client'"));
      },
    }
  );

  // Citus cannot push down an OR that mixes correlated EXISTS across multiple
  // distributed tables (app_search_index, interactions, document_associations,
  // client_locations). Rewrite as UNION ALL of single-distributed-table legs
  // producing (client_id, tenant); each leg is independently pushdown-safe and
  // the outer INNER JOIN is co-located on the distribution column. Mirrors the
  // ticket search rewrite in optimizedTicketActions.ts (PR #2547).
  const qCte = `
    CROSS JOIN (
      SELECT
        websearch_to_tsquery('english', ?) AS tsq,
        CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
        ?::text AS raw,
        ?::text AS identifier
    ) q
  `;
  const qBindings: Knex.RawBinding[] = [rawSearch, prefixTsquery, prefixTsquery, rawSearch, identifier];

  const siFilters = `
    AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
    AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
    AND (si.is_internal_only = false OR ?::boolean = true)
    AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
    AND ${clientScopePredicate}
    AND (
      si.search_vector @@ q.tsq
      OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
      OR si.title ILIKE '%' || q.raw || '%'
      OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
      OR si.title % q.raw
      OR coalesce(si.subtitle, '') % q.raw
      OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier)
      OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%')
    )
  `;
  const siFilterBindings: Knex.RawBinding[] = [
    permissions,
    user.user_id,
    isInternalUser,
    user.user_id,
    ...clientScopeBindings,
  ];

  const legA = `
    SELECT si.object_id::uuid AS client_id, si.tenant
    FROM ${searchIndex.sql}
    ${qCte}
    WHERE si.object_type = 'client'
      ${siFilters}
  `;
  const legABindings: Knex.RawBinding[] = [
    ...searchIndex.bindings,
    ...qBindings,
    ...siFilterBindings,
  ];

  const legB = `
    SELECT im.client_id AS client_id, im.tenant
    FROM ${searchIndex.sql}
    ${qCte}
    ${interactionJoin.sql}
    WHERE si.object_type = 'interaction'
      ${siFilters}
  `;
  const legBBindings: Knex.RawBinding[] = [
    ...searchIndex.bindings,
    ...qBindings,
    ...interactionJoin.bindings,
    ...siFilterBindings,
  ];

  const legC = `
    SELECT da.entity_id::uuid AS client_id, da.tenant
    FROM ${searchIndex.sql}
    ${qCte}
    ${documentAssociationJoin.sql}
    WHERE si.object_type = 'document'
      ${siFilters}
  `;
  const legCBindings: Knex.RawBinding[] = [
    ...searchIndex.bindings,
    ...qBindings,
    ...documentAssociationJoin.bindings,
    ...siFilterBindings,
  ];

  const legD = `
    SELECT c2.client_id, c2.tenant
    FROM ${titleSearchClients.sql}
    WHERE (
        c2.client_name ILIKE ?
        OR c2.billing_email ILIKE ?
        OR c2.url ILIKE ?
        OR c2.notes ILIKE ?
      )
  `;
  const legDBindings: Knex.RawBinding[] = [
    ...titleSearchClients.bindings,
    ilikePattern,
    ilikePattern,
    ilikePattern,
    ilikePattern,
  ];

  const legE = `
    SELECT cl_search.client_id, cl_search.tenant
    FROM ${locationSearchClients.sql}
    WHERE (
        cl_search.phone ILIKE ?
        OR cl_search.email ILIKE ?
        OR cl_search.address_line1 ILIKE ?
        OR cl_search.address_line2 ILIKE ?
        OR cl_search.city ILIKE ?
        OR cl_search.state_province ILIKE ?
        OR cl_search.postal_code ILIKE ?
        OR cl_search.country_name ILIKE ?
      )
  `;
  const legEBindings: Knex.RawBinding[] = [
    ...locationSearchClients.bindings,
    ilikePattern, ilikePattern, ilikePattern, ilikePattern,
    ilikePattern, ilikePattern, ilikePattern, ilikePattern,
  ];

  const searchMatchesSql = `
    (
      SELECT DISTINCT client_id, tenant FROM (
        ${legA}
        UNION ALL
        ${legB}
        UNION ALL
        ${legC}
        UNION ALL
        ${legD}
        UNION ALL
        ${legE}
      ) u
    ) as sm
  `;
  const searchMatchesBindings: Knex.RawBinding[] = [
    ...legABindings,
    ...legBBindings,
    ...legCBindings,
    ...legDBindings,
    ...legEBindings,
  ];
  const searchMatchesJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    trx.raw(searchMatchesSql, searchMatchesBindings),
    'sm.client_id',
    'c.client_id',
    {
      rootTenantColumn: 'c.tenant',
      joinedTenantColumn: 'sm.tenant',
    }
  );

  return baseQuery.joinRaw(searchMatchesJoin.sql, searchMatchesJoin.bindings as unknown as Knex.Value[]);
}

export function buildContactListSearchQuery(
  trx: Knex.Transaction,
  tenant: string,
  rawSearch: string,
  permissions: string[],
  userId: string
): { sql: string; bindings: Knex.RawBinding[] } {
  const prefixTsquery = buildListSearchPrefixTsquery(rawSearch);
  const identifier = rawSearch.match(LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN)?.[0]?.toLowerCase() ?? null;
  const scopedDb = tenantDb(trx, tenant);
  const searchIndex = tenantScopedDerivedTableSql(scopedDb, 'app_search_index', 'si');
  const interactions = tenantScopedDerivedTableSql(scopedDb, 'interactions', 'interaction_match');
  const noteContacts = tenantScopedDerivedTableSql(scopedDb, 'contacts', 'note_contact');
  const documentAssociations = tenantScopedDerivedTableSql(scopedDb, 'document_associations', 'document_contact_match');
  const interactionJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    interactions.subquery,
    trx.raw('??::text', ['interaction_match.interaction_id']),
    'si.object_id',
    {
      type: 'left',
      rootTenantColumn: 'si.tenant',
      joinedTenantColumn: 'interaction_match.tenant',
      on: (join) => {
        join.andOn('si.object_type', '=', trx.raw("'interaction'"));
      },
    }
  );
  const noteContactJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    noteContacts.subquery,
    trx.raw('??::text', ['note_contact.notes_document_id']),
    'si.object_id',
    {
      type: 'left',
      rootTenantColumn: 'si.tenant',
      joinedTenantColumn: 'note_contact.tenant',
      on: (join) => {
        join.andOn('si.object_type', '=', trx.raw("'document'"));
      },
    }
  );
  const documentAssociationJoin = tenantJoinSubquerySql(
    scopedDb,
    trx,
    documentAssociations.subquery,
    trx.raw('??::text', ['document_contact_match.document_id']),
    'si.object_id',
    {
      type: 'left',
      rootTenantColumn: 'si.tenant',
      joinedTenantColumn: 'document_contact_match.tenant',
      on: (join) => {
        join.andOn('si.object_type', '=', trx.raw("'document'"));
        join.andOn('document_contact_match.entity_type', '=', trx.raw("'contact'"));
      },
    }
  );

  const sql = `
        WITH q AS (
          SELECT
            websearch_to_tsquery('english', ?) AS tsq,
            CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
            ?::text AS raw,
            ?::text AS identifier
        ),
        matched AS (
          SELECT DISTINCT
            CASE
              WHEN si.object_type = 'contact' THEN si.object_id
              WHEN si.object_type = 'interaction' THEN interaction_match.contact_name_id::text
              WHEN si.object_type = 'document' THEN coalesce(note_contact.contact_name_id::text, document_contact_match.entity_id::text)
            END AS contact_id
          FROM ${searchIndex.sql}
          CROSS JOIN q
          ${interactionJoin.sql}
          ${noteContactJoin.sql}
          ${documentAssociationJoin.sql}
          WHERE si.object_type = ANY(?::text[])
            AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
            AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND (si.is_internal_only = false OR ?::boolean = true)
            AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND (
              si.search_vector @@ q.tsq
              OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
              OR si.title ILIKE '%' || q.raw || '%'
              OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
              OR si.title % q.raw
              OR coalesce(si.subtitle, '') % q.raw
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier
              )
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%'
              )
            )
        )
        SELECT contact_id
        FROM matched
        WHERE contact_id IS NOT NULL
      `;

  const bindings: Knex.RawBinding[] = [
    rawSearch,
    prefixTsquery,
    prefixTsquery,
    rawSearch,
    identifier,
    ...searchIndex.bindings,
    ...interactionJoin.bindings,
    ...noteContactJoin.bindings,
    ...documentAssociationJoin.bindings,
    [...CONTACT_LIST_SEARCH_TYPES],
    permissions,
    userId,
    true,
    userId,
  ];

  return { sql, bindings };
}
