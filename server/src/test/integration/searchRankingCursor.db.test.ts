import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { applyTicketReadAuthorizationSql } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { countSearchMatchesByType, encodeSearchCursor, runSearchQuery } from '@alga-psa/search/query';
import type { TenantScopedQuery } from '@alga-psa/db';

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
const TICKET_TABLE = `search_authz_ticket_${randomUUID().replaceAll('-', '')}`;
const ALLOWED_CLIENT = randomUUID();
const DENIED_CLIENT = randomUUID();
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
    await db.raw(`CREATE TABLE ${TICKET_TABLE} (tenant uuid NOT NULL, ticket_id text NOT NULL, client_id uuid, PRIMARY KEY (tenant, ticket_id))`);
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
    await db?.raw(`DROP TABLE IF EXISTS ${TICKET_TABLE}`);
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

  it('uses the ticket list SQL compiler to filter exact counts and stable pages in PostgreSQL', async () => {
    const ticketHits = Array.from({ length: 24 }, (_, index) => {
      const ticketId = `authz-${String(index + 1).padStart(3, '0')}`;
      return {
        tenant: TENANT,
        object_type: 'ticket',
        object_id: ticketId,
        title: 'Needle ticket support',
        url: `/msp/tickets/${ticketId}`,
        source_updated_at: MATCHED_AT,
        metadata: JSON.stringify({}),
        body: 'needle support',
        required_permission: 'ticket:read',
      };
    });
    await db(TABLE).insert(ticketHits);
    await db(TICKET_TABLE).insert(ticketHits.map((hit, index) => ({
      tenant: TENANT,
      ticket_id: hit.object_id,
      client_id: index >= 19 ? ALLOWED_CLIENT : DENIED_CLIENT,
    })));

    const context = {
      authorizationSubject: {
        tenant: TENANT,
        userId: USER.user_id,
        userType: 'internal',
        roleIds: [],
        teamIds: [],
        managedUserIds: [],
        clientId: null,
        portfolioClientIds: [],
      },
      selectedBoardIds: undefined,
      contactVisibility: undefined,
      ticketReadBundleNarrowingRules: [{
        resource: 'ticket',
        action: 'read',
        templateKey: 'selected_clients',
        selectedClientIds: [ALLOWED_CLIENT],
      }],
    } as any;
    const builder = db(`${TICKET_TABLE} as t`).where('t.tenant', TENANT);
    builder.whereRaw('t.ticket_id = s.object_id');
    const scopedQuery = { tenant: TENANT, builder } as unknown as TenantScopedQuery;
    const compiled = applyTicketReadAuthorizationSql(scopedQuery, db, TENANT, context);
    expect(compiled.supported).toBe(true);
    const sql = builder.toSQL();
    const acl = {
      userId: USER.user_id,
      tenant: TENANT,
      permissions: ['ticket:read'],
      roles: [],
      isInternal: true,
      clientAccess: { mode: 'all' as const },
      ticketPolicySqlSupported: true,
      ticketVisibilitySql: {
        sql: `(s.object_type <> 'ticket' OR EXISTS (${sql.sql}))`,
        bindings: [...sql.bindings],
      },
    };
    const searchOptions = {
      knex: db,
      tenant: TENANT,
      query: 'needle',
      allowedTypes: ['ticket'] as any,
      acl: acl as any,
      rankingAsOf: MATCHED_AT,
      searchIndex: SEARCH_INDEX,
    };

    const counts = await countSearchMatchesByType(searchOptions);
    expect(counts.ticket).toBe(5);
    const first = await runSearchQuery({ ...searchOptions, limit: 2 });
    expect(first.map(({ id }) => id)).toEqual(['authz-020', 'authz-021']);
    const nextCursor = encodeSearchCursor(first[1], MATCHED_AT);
    const second = await runSearchQuery({ ...searchOptions, limit: 2, cursor: nextCursor });
    expect(second.map(({ id }) => id)).toEqual(['authz-022', 'authz-023']);
    expect(new Set([...first, ...second].map(({ id }) => id)).size).toBe(4);

    const unrestrictedBuilder = db(`${TICKET_TABLE} as t`).where('t.tenant', TENANT);
    unrestrictedBuilder.whereRaw('t.ticket_id = s.object_id');
    const unrestrictedContext = { ...context, ticketReadBundleNarrowingRules: [] };
    const unrestrictedCompiled = applyTicketReadAuthorizationSql(
      { tenant: TENANT, builder: unrestrictedBuilder } as unknown as TenantScopedQuery,
      db,
      TENANT,
      unrestrictedContext,
    );
    expect(unrestrictedCompiled.supported).toBe(true);
    const unrestrictedSql = unrestrictedBuilder.toSQL();
    const unrestrictedAcl = {
      ...acl,
      ticketVisibilitySql: {
        sql: `(s.object_type <> 'ticket' OR EXISTS (${unrestrictedSql.sql}))`,
        bindings: [...unrestrictedSql.bindings],
      },
    };
    const unrestrictedOptions = { ...searchOptions, acl: unrestrictedAcl as any };
    expect((await countSearchMatchesByType(unrestrictedOptions)).ticket).toBe(24);
    expect((await runSearchQuery({ ...unrestrictedOptions, limit: 2 })).map(({ id }) => id))
      .toEqual(['authz-001', 'authz-002']);
  }, 30_000);
});
