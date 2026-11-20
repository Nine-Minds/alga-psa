import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const benchmark = vi.hoisted(() => ({
  readableIds: new Set<string>(),
  principal: {} as any,
  evaluatedRows: 0,
  restrictive: true,
}));

vi.mock('@alga-psa/search/acl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/search/acl')>();
  return {
    ...actual,
    resolveSearchAclPrincipal: async () => benchmark.principal,
    verifyResultVisibility: async (_knex: Knex, _acl: unknown, rows: Array<{ id: string; type: string }>) => {
      benchmark.evaluatedRows += rows.length;
      return rows.filter((row) => row.type !== 'ticket' || !benchmark.restrictive || benchmark.readableIds.has(row.id));
    },
  };
});

import { runAppSearch } from '@alga-psa/search/runAppSearch';
import { encodeSearchCursor, runSearchQuery } from '@alga-psa/search/query';

const TENANT = randomUUID();
const USER = { user_id: randomUUID(), tenant: TENANT, user_type: 'internal', roles: [] } as any;
const ALLOWED_CLIENT = randomUUID();
const DENIED_CLIENT = randomUUID();
const TABLE = `search_authz_bench_${randomUUID().replaceAll('-', '')}`;
const TICKET_TABLE = `ticket_authz_bench_${randomUUID().replaceAll('-', '')}`;
const SEARCH_INDEX = { sql: `(SELECT * FROM ${TABLE}) s`, bindings: [] };
const MATCHED_AT = '2026-01-01T00:00:00.000Z';
const MATCHES = 1_500;
const SAMPLE_COUNT = 20;
const WARMUP_COUNT = 3;

describe('ticket search authorization PostgreSQL benchmark fixture', () => {
  let db: Knex;
  let postgresVersion = '';
  let statementCount = 0;
  const measuredKnex = {
    raw: (...args: any[]) => {
      statementCount += 1;
      return db.raw(...args);
    },
  } as unknown as Knex;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    const version = await db.raw('SHOW server_version');
    postgresVersion = String(version.rows[0].server_version);
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
        required_permission text NOT NULL DEFAULT 'ticket:read'
      )
    `);
    await db.raw(`CREATE TABLE ${TICKET_TABLE} (tenant uuid NOT NULL, ticket_id text NOT NULL, client_id uuid NOT NULL, PRIMARY KEY (tenant, ticket_id))`);
    const searchRows = [];
    const ticketRows = [];
    const readableIds = new Set<string>();
    for (let index = 1; index <= MATCHES; index += 1) {
      const id = `authz-bench-${String(index).padStart(6, '0')}`;
      const readable = index % 10 === 0;
      if (readable) readableIds.add(id);
      searchRows.push({
        tenant: TENANT,
        object_type: 'ticket',
        object_id: id,
        title: 'Needle support ticket',
        url: `/msp/tickets/${id}`,
        source_updated_at: MATCHED_AT,
        metadata: JSON.stringify({}),
        body: 'needle support',
        required_permission: 'ticket:read',
      });
      ticketRows.push({ tenant: TENANT, ticket_id: id, client_id: readable ? ALLOWED_CLIENT : DENIED_CLIENT });
    }
    for (let start = 0; start < MATCHES; start += 1_000) {
      await db.batchInsert(TABLE, searchRows.slice(start, start + 1_000), 1_000);
      await db.batchInsert(TICKET_TABLE, ticketRows.slice(start, start + 1_000), 1_000);
    }

    benchmark.readableIds = readableIds;
    const sql = `(s.object_type <> 'ticket' OR EXISTS (
      SELECT 1 FROM ${TICKET_TABLE} t
      WHERE t.tenant = ?::uuid AND t.ticket_id = s.object_id AND t.client_id = ?::uuid
    ))`;
    benchmark.principal = {
      userId: USER.user_id,
      tenant: TENANT,
      permissions: ['ticket:read'],
      roles: [],
      isInternal: true,
      clientAccess: { mode: 'all' },
      ticketPolicySqlSupported: true,
      ticketVisibilitySql: { sql, bindings: [TENANT, ALLOWED_CLIENT] },
    };
  }, 300_000);

  afterAll(async () => {
    await db?.raw(`DROP TABLE IF EXISTS ${TABLE}`);
    await db?.raw(`DROP TABLE IF EXISTS ${TICKET_TABLE}`);
    await db?.destroy();
  });

  it('records equivalent identities, totals, latency and request SQL counts for four representative requests', async () => {
    const firstHit = (await runSearchQuery({
      knex: db,
      tenant: TENANT,
      query: 'needle',
      allowedTypes: ['ticket'],
      limit: 1,
      rankingAsOf: MATCHED_AT,
      searchIndex: SEARCH_INDEX,
    }))[0];
    const laterCursor = encodeSearchCursor({ ...firstHit, id: 'authz-bench-001000' }, MATCHED_AT);
    const scenarios = [
      { name: 'broad-typeahead-unrestricted', expected: 1_500, client: null, cursor: undefined, ids: Array.from({ length: 5 }, (_, i) => `authz-bench-${String(i + 1).padStart(6, '0')}`) },
      { name: 'broad-typeahead-restrictive', expected: 150, client: ALLOWED_CLIENT, cursor: undefined, ids: Array.from({ length: 5 }, (_, i) => `authz-bench-${String((i + 1) * 10).padStart(6, '0')}`) },
      { name: 'later-page-unrestricted', expected: 1_500, client: null, cursor: laterCursor, ids: Array.from({ length: 5 }, (_, i) => `authz-bench-${String(1_001 + i).padStart(6, '0')}`) },
      { name: 'later-page-restrictive', expected: 150, client: ALLOWED_CLIENT, cursor: laterCursor, ids: Array.from({ length: 5 }, (_, i) => `authz-bench-${String(1_010 + i * 10).padStart(6, '0')}`) },
    ];
    const measurements: Array<Record<string, unknown>> = [];

    for (const scenario of scenarios) {
      benchmark.restrictive = scenario.client !== null;
      benchmark.principal.ticketVisibilitySql.bindings = scenario.client ? [TENANT, scenario.client] : [];
      benchmark.principal.ticketVisibilitySql.sql = scenario.client
        ? `(s.object_type <> 'ticket' OR EXISTS (SELECT 1 FROM ${TICKET_TABLE} t WHERE t.tenant = ?::uuid AND t.ticket_id = s.object_id AND t.client_id = ?::uuid))`
        : 'TRUE';
      const request = () => runAppSearch(measuredKnex, TENANT, USER, {
        query: 'needle',
        types: ['ticket'] as any,
        limit: 5,
        cursor: scenario.cursor,
      }, SEARCH_INDEX);
      for (let warmup = 0; warmup < WARMUP_COUNT; warmup += 1) await request();

      const latencies: number[] = [];
      const queryCounts: number[] = [];
      const evaluatedRowCounts: number[] = [];
      const expectedTotal = scenario.client ? 150 : MATCHES;
      for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
        statementCount = 0;
        benchmark.evaluatedRows = 0;
        const startedAt = performance.now();
        const result = await request();
        latencies.push(performance.now() - startedAt);
        queryCounts.push(statementCount);
        evaluatedRowCounts.push(benchmark.evaluatedRows);
        expect(result.results.map(({ id }) => id)).toEqual(scenario.ids);
        expect(result.totalCount).toBe(expectedTotal);
        expect(result.groups.ticket).toBe(expectedTotal);
      }
      latencies.sort((a, b) => a - b);
      queryCounts.sort((a, b) => a - b);
      evaluatedRowCounts.sort((a, b) => a - b);
      measurements.push({
        scenario: scenario.name,
        p95_ms: Number(latencies[Math.ceil(SAMPLE_COUNT * 0.95) - 1].toFixed(2)),
        query_count_per_request: queryCounts[Math.floor(SAMPLE_COUNT / 2)],
        median_candidate_rows_evaluated: evaluatedRowCounts[Math.floor(SAMPLE_COUNT / 2)],
        warmup_samples: WARMUP_COUNT,
        measured_samples: SAMPLE_COUNT,
        concurrency: 1,
      });
    }

    console.log(JSON.stringify({ revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded', postgresVersion, fixture: { matchingTickets: MATCHES, readableTickets: 150, deniedTickets: 1_350 }, measurements }));
  }, 300_000);
});
