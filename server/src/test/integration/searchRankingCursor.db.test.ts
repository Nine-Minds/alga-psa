import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({ readableIds: new Set<string>() }));

vi.mock('@alga-psa/search/acl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/search/acl')>();
  return {
    ...actual,
    resolveSearchAclPrincipal: async (_knex: Knex, user: any, clientAccess: any) => ({
      userId: user.user_id,
      tenant: user.tenant,
      permissions: ['client:read'],
      roles: [],
      isInternal: true,
      clientAccess,
      authorizationUser: user,
    }),
    verifyResultVisibility: async (_knex: Knex, _acl: unknown, rows: Array<{ id: string }>) =>
      rows.filter((row) => state.readableIds.has(row.id)),
  };
});

import { runAppSearch } from '@alga-psa/search/runAppSearch';
import { decodeSearchCursor } from '@alga-psa/search/query';

const TENANT = randomUUID();
const USER = {
  user_id: randomUUID(),
  tenant: TENANT,
  user_type: 'internal',
  roles: [{ role_id: randomUUID() }],
} as any;
const TABLE = `search_cursor_rank_${randomUUID().replaceAll('-', '')}`;
const SEARCH_INDEX = { sql: `(SELECT * FROM ${TABLE}) s`, bindings: [] };
const READABLE_IDS = ['client-101', 'client-102'];
const MATCHED_AT = '2025-01-01T00:00:00.000Z';

describe('authorized search cursors against PostgreSQL ranking', () => {
  let db: Knex;
  let rawCalls = 0;
  let rankingTimes: string[] = [];
  const rankingKnex = {
    raw: async (...args: any[]) => {
      if (rawCalls > 0) await new Promise((resolve) => setTimeout(resolve, 30));
      rawCalls += 1;
      if (String(args[0]).includes('AS ranked_at')) rankingTimes.push(args[1][5]);
      return db.raw(...args);
    },
  } as unknown as Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    await db.raw(`
      CREATE TABLE ${TABLE} (
        tenant uuid NOT NULL,
        object_type text NOT NULL,
        object_id text PRIMARY KEY,
        parent_type text,
        parent_id text,
        title text NOT NULL,
        subtitle text,
        url text NOT NULL,
        source_updated_at timestamptz NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        body text NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
        ) STORED,
        visible_to_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
        visible_to_roles text[] NOT NULL DEFAULT '{}'::text[],
        is_internal_only boolean NOT NULL DEFAULT false,
        is_private boolean NOT NULL DEFAULT false,
        client_scope_id uuid,
        required_permission text NOT NULL DEFAULT 'client:read'
      )
    `);
  }, 300_000);

  beforeEach(async () => {
    await db(TABLE).delete();
    const rows = Array.from({ length: 102 }, (_, index) => {
      const sequence = index + 1;
      const id = `client-${String(sequence).padStart(3, '0')}`;
      return {
        tenant: TENANT,
        object_type: 'client',
        object_id: id,
        title: 'Needle support record',
        url: `/msp/clients/${id}`,
        source_updated_at: MATCHED_AT,
        metadata: JSON.stringify({}),
        body: 'needle support',
      };
    });
    await db(TABLE).insert(rows);
    state.readableIds = new Set(READABLE_IDS);
    rawCalls = 0;
    rankingTimes = [];
  });

  afterAll(async () => {
    await db?.raw(`DROP TABLE IF EXISTS ${TABLE}`);
    await db?.destroy();
  });

  it('keeps ranking stable across delayed scan batches and public pages', async () => {
    const first = await runAppSearch(
      rankingKnex,
      TENANT,
      USER,
      { query: 'needle', limit: 1 },
      SEARCH_INDEX,
    );

    expect(first.results.map(({ id }) => id)).toEqual(['client-101']);
    expect(first.totalCount).toBe(2);
    expect(first.groups.client).toBe(2);
    expect(first.nextCursor).toBeTruthy();
    const firstCursor = decodeSearchCursor(first.nextCursor);
    expect(firstCursor?.rankingAsOf).toBeTruthy();
    expect(rawCalls).toBeGreaterThanOrEqual(2);
    expect(new Set(rankingTimes)).toEqual(new Set([firstCursor?.rankingAsOf]));

    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await runAppSearch(
      rankingKnex,
      TENANT,
      USER,
      { query: 'needle', limit: 1, cursor: first.nextCursor },
      SEARCH_INDEX,
    );

    expect(second.results.map(({ id }) => id)).toEqual(['client-102']);
    expect(second.totalCount).toBe(2);
    expect(second.groups.client).toBe(2);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.results, ...second.results].map(({ id }) => id)).size).toBe(2);
    expect(rawCalls).toBeGreaterThanOrEqual(4);
    expect(new Set(rankingTimes)).toEqual(new Set([firstCursor?.rankingAsOf]));
  }, 30_000);
});
