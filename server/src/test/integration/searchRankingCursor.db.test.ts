import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { applyTicketReadAuthorizationSql } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { countSearchMatchesByType, encodeSearchCursor, runSearchQuery } from '@alga-psa/search/query';
import { registerSearchVisibilityVerifier } from '@alga-psa/search/acl';
import type { TenantScopedQuery } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({ readableIds: new Set<string>(), permissions: ['client:read'], aclOverride: undefined as any }));

vi.mock('@alga-psa/search/acl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/search/acl')>();
  return {
    ...actual,
    resolveSearchAclPrincipal: async (_knex: Knex, user: any, clientAccess: any) => ({
      userId: user.user_id,
      tenant: user.tenant,
      permissions: state.permissions,
      roles: [],
      isInternal: true,
      clientAccess,
      authorizationUser: user,
      ...(state.aclOverride ?? {}),
    }),
    verifyResultVisibility: async (_knex: Knex, _acl: unknown, rows: Array<{ id: string }>) =>
      rows.filter((row) => state.readableIds.has(row.id)),
  };
});

import { runAppSearch } from '@alga-psa/search/runAppSearch';
import { decodeSearchCursor } from '@alga-psa/search/query';

// Exercise the authorized batched-scan path with delayed batches while the
// production client path remains SQL-admitted by its index ACL.
registerSearchVisibilityVerifier('client', async (_knex, _acl, row) => state.readableIds.has(row.id));

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
    await db.raw(`CREATE TABLE ${TICKET_TABLE} (tenant uuid NOT NULL, ticket_id uuid NOT NULL, client_id uuid, PRIMARY KEY (tenant, ticket_id))`);
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
    state.permissions = ['client:read'];
    state.aclOverride = undefined;
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
    const ticketIds = Array.from({ length: 24 }, () => randomUUID());
    const ticketHits = Array.from({ length: 24 }, (_, index) => {
      const ticketId = ticketIds[index];
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
    builder.whereRaw(
      `t.ticket_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END`,
      ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
    );
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
    const allowedTicketIds = ticketIds.slice(19).sort();
    const allTicketIds = [...ticketIds].sort();

    const counts = await countSearchMatchesByType(searchOptions);
    expect(counts.ticket).toBe(5);
    const first = await runSearchQuery({ ...searchOptions, limit: 2 });
    expect(first.map(({ id }) => id)).toEqual(allowedTicketIds.slice(0, 2));
    const nextCursor = encodeSearchCursor(first[1], MATCHED_AT);
    const second = await runSearchQuery({ ...searchOptions, limit: 2, cursor: nextCursor });
    expect(second.map(({ id }) => id)).toEqual(allowedTicketIds.slice(2, 4));
    expect(new Set([...first, ...second].map(({ id }) => id)).size).toBe(4);

    const unrestrictedBuilder = db(`${TICKET_TABLE} as t`).where('t.tenant', TENANT);
    unrestrictedBuilder.whereRaw(
      `t.ticket_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END`,
      ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
    );
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
      .toEqual(allTicketIds.slice(0, 2));

    state.permissions = ['ticket:read'];
    state.aclOverride = {
      ticketPolicySqlSupported: true,
      ticketVisibilitySql: {
        sql: `(s.object_type <> 'ticket' OR EXISTS (
          SELECT 1 FROM ${TICKET_TABLE} t
          WHERE t.tenant = ?::uuid
            AND t.ticket_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END
            AND t.client_id = ?::uuid
        ))`,
        bindings: [TENANT, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', ALLOWED_CLIENT],
      },
    };
    const appPage1 = await runAppSearch(rankingKnex, TENANT, USER, { query: 'needle', types: ['ticket'] as any, limit: 2 }, SEARCH_INDEX);
    const appPage2 = await runAppSearch(rankingKnex, TENANT, USER, { query: 'needle', types: ['ticket'] as any, limit: 2, cursor: appPage1.nextCursor }, SEARCH_INDEX);
    const appPage3 = await runAppSearch(rankingKnex, TENANT, USER, { query: 'needle', types: ['ticket'] as any, limit: 2, cursor: appPage2.nextCursor }, SEARCH_INDEX);
    expect(appPage1.results.map(({ id }) => id)).toEqual(allowedTicketIds.slice(0, 2));
    expect(appPage2.results.map(({ id }) => id)).toEqual(allowedTicketIds.slice(2, 4));
    expect(appPage3.results.map(({ id }) => id)).toEqual(allowedTicketIds.slice(4));
    expect(appPage1.nextCursor).toBeTruthy();
    expect(appPage2.nextCursor).toBeTruthy();
    expect(appPage3.nextCursor).toBeUndefined();
    expect(new Set([...appPage1.results, ...appPage2.results, ...appPage3.results].map(({ id }) => id)).size).toBe(5);
  }, 30_000);

  it('returns a complete mixed 100-result page and terminates across later public cursors', async () => {
    await db(TABLE).delete();
    await db(TICKET_TABLE).delete();
    const total = 205;
    const tickets: Array<{ id: string; type: 'ticket' | 'client' }> = [];
    const rows = Array.from({ length: total }, (_, index) => {
      const id = index % 2 === 0 ? randomUUID() : `client-${String(index + 1).padStart(3, '0')}`;
      const type = index % 2 === 0 ? 'ticket' as const : 'client' as const;
      tickets.push({ id, type });
      return {
        tenant: TENANT,
        object_type: type,
        object_id: id,
        title: 'Needle mixed result',
        url: `/${type}/${id}`,
        source_updated_at: MATCHED_AT,
        metadata: JSON.stringify({}),
        body: 'needle mixed',
        required_permission: `${type}:read`,
      };
    });
    rows.push({
      tenant: TENANT,
      object_type: 'ticket',
      object_id: 'legacy-non-uuid-ticket-id',
      title: 'Needle malformed indexed ID',
      url: '/msp/tickets/legacy-non-uuid-ticket-id',
      source_updated_at: MATCHED_AT,
      metadata: JSON.stringify({}),
      body: 'needle mixed',
      required_permission: 'ticket:read',
    } as any);
    await db.batchInsert(TABLE, rows, 500);
    await db.batchInsert(TICKET_TABLE, tickets.filter(({ type }) => type === 'ticket').map(({ id }) => ({
      tenant: TENANT,
      ticket_id: id,
      client_id: ALLOWED_CLIENT,
    })), 500);

    state.permissions = ['client:read', 'ticket:read'];
    state.readableIds = new Set(tickets.map(({ id }) => id));
    state.aclOverride = {
      ticketPolicySqlSupported: true,
      ticketVisibilitySql: {
        sql: `(s.object_type <> 'ticket' OR EXISTS (
          SELECT 1 FROM ${TICKET_TABLE} t
          WHERE t.tenant = ?::uuid
            AND t.ticket_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END
        ))`,
        bindings: [TENANT, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
      },
    };

    const pages: string[][] = [];
    let cursor: string | undefined;
    let final: Awaited<ReturnType<typeof runAppSearch>> | undefined;
    do {
      final = await runAppSearch(rankingKnex, TENANT, USER, {
        query: 'needle',
        types: ['ticket', 'client'] as any,
        limit: 100,
        cursor,
      }, SEARCH_INDEX);
      pages.push(final.results.map(({ id }) => id));
      cursor = final.nextCursor;
      if (pages.length > 4) throw new Error('100-result search cursor did not terminate');
    } while (cursor);

    const pageIds = pages.flat();
    expect(pages.map((page) => page.length)).toEqual([100, 100, 5]);
    expect(pageIds).toHaveLength(total);
    expect(new Set(pageIds).size).toBe(total);
    expect(new Set(pageIds)).toEqual(new Set(tickets.map(({ id }) => id)));
    expect(final?.totalCount).toBe(total);
    expect(final?.groups.ticket).toBe(103);
    expect(final?.groups.client).toBe(102);
    expect(pageIds.some((id) => tickets.find((hit) => hit.id === id)?.type === 'ticket')).toBe(true);
    expect(pageIds.some((id) => tickets.find((hit) => hit.id === id)?.type === 'client')).toBe(true);
  }, 30_000);
});
