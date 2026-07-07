import { describe, expect, it } from 'vitest';
import knexFactory, { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  applyClientListIndexedSearchFilter,
  buildContactListSearchQuery,
  tenantScopedDerivedTableSql,
} from './listSearchSql';

// These tests compile the real search SQL (no database needed) and assert it is
// structurally valid. They exist because the source-text contract tests cannot
// see compiled output: a refactor once dropped the parentheses around derived
// tables (`FROM select * from ...`), which broke clients and contacts search in
// production with `syntax error at or near "select"` while every contract test
// stayed green.

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = '33333333-3333-3333-3333-333333333333';

const knex = knexFactory({ client: 'pg' });
const trx = knex as unknown as Knex.Transaction;

function parenDepthIsBalanced(sql: string): boolean {
  let depth = 0;
  for (const ch of sql) {
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function expectStructurallyValidSql(sql: string, bindings: readonly unknown[]) {
  // The exact production failure mode: a derived table interpolated without
  // parentheses/alias compiles to `FROM select ...` or `JOIN select ...`.
  expect(sql).not.toMatch(/\b(?:from|join)\s+select\b/i);
  // Fragment interpolation must keep parentheses balanced.
  expect(parenDepthIsBalanced(sql)).toBe(true);
  // Every placeholder needs a binding and vice versa; a drift here surfaces in
  // production as values bound to the wrong parameters.
  expect((sql.match(/\?/g) ?? []).length).toBe(bindings.length);
}

describe('tenantScopedDerivedTableSql', () => {
  it('emits a parenthesized, aliased derived table', () => {
    const fragment = tenantScopedDerivedTableSql(tenantDb(knex, TENANT), 'app_search_index', 'si');

    expect(fragment.sql).toBe('(select * from "app_search_index" where "app_search_index"."tenant" = ?) si');
    expect(fragment.bindings).toEqual([TENANT]);
  });
});

describe('client list indexed search', () => {
  function compileClientSearch(searchTerm: string, user: Parameters<typeof applyClientListIndexedSearchFilter>[3]) {
    const baseQuery = tenantDb(trx, TENANT).table('clients as c');
    return applyClientListIndexedSearchFilter(
      trx,
      baseQuery,
      TENANT,
      user,
      searchTerm,
      ['client:read', 'document:read', 'interaction:read']
    );
  }

  it('compiles to structurally valid SQL for an internal user', () => {
    const compiled = compileClientSearch('Acme urgent AB-123', { user_id: USER_ID, user_type: 'internal' }).toSQL();

    expectStructurallyValidSql(compiled.sql, compiled.bindings);
    // Every UNION ALL leg reads from a parenthesized, aliased derived table.
    expect(compiled.sql).toContain(') si');
    expect(compiled.sql).toContain(') c2');
    expect(compiled.sql).toContain(') cl_search');
    expect(compiled.sql).toContain('as "im"');
    expect(compiled.sql).toContain('as "da"');
    expect(compiled.sql).toContain('as sm');
  });

  it('compiles the paginated count query shape that failed in production', () => {
    const countQuery = compileClientSearch('Acme', { user_id: USER_ID, user_type: 'internal' })
      .clone()
      .countDistinct('c.client_id as count');
    const compiled = countQuery.toSQL();

    expectStructurallyValidSql(compiled.sql, compiled.bindings);
    expect(compiled.sql).toMatch(/^select count\(distinct "c"\."client_id"\) as "count"/);
  });

  it('keeps bindings aligned for a client-portal user with a client scope', () => {
    const compiled = compileClientSearch('Acme', {
      user_id: USER_ID,
      user_type: 'client',
      clientId: CLIENT_ID,
    }).toSQL();

    expectStructurallyValidSql(compiled.sql, compiled.bindings);
    expect(compiled.sql).toContain('si.client_scope_id = ?::uuid');
    expect(compiled.bindings).toContain(CLIENT_ID);
  });

  it('returns the base query untouched when there is no search term', () => {
    const baseQuery = tenantDb(trx, TENANT).table('clients as c');
    const result = applyClientListIndexedSearchFilter(trx, baseQuery, TENANT, { user_id: USER_ID }, '   ', []);

    expect(result.toSQL().sql).not.toContain('sm');
  });
});

describe('contact list indexed search', () => {
  it('compiles to structurally valid SQL', () => {
    const { sql, bindings } = buildContactListSearchQuery(
      trx,
      TENANT,
      'Acme AB-123',
      ['contact:read', 'document:read', 'interaction:read'],
      USER_ID
    );

    expectStructurallyValidSql(sql, bindings);
    expect(sql).toContain(') si');
    expect(sql).toContain('as "interaction_match"');
    expect(sql).toContain('as "note_contact"');
    expect(sql).toContain('as "document_contact_match"');
    // knex accepts the fragment as a raw statement with these bindings.
    expect(() => knex.raw(sql, bindings as Knex.RawBinding[]).toSQL().toNative()).not.toThrow();
  });

  it('compiles when the search term produces no identifier or tsquery tokens', () => {
    const { sql, bindings } = buildContactListSearchQuery(trx, TENANT, '@@@', ['contact:read'], USER_ID);

    expectStructurallyValidSql(sql, bindings);
  });
});
