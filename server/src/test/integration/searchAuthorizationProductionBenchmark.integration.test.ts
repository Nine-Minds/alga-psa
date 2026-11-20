import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { runAppSearch } from '@alga-psa/search/runAppSearch';
import { TestContext } from '../../../test-utils/testContext';
import { createCloseRulesFixture } from './helpers/closeRulesFixture';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const SEARCH_INDEX = undefined;
const FIXED_RANKING = '2026-01-01T00:00:00.000Z';
const BROAD_MATCHES = 500;
const SMALL_MATCHES = 150;
const WARMUPS = 1;
const SAMPLES = 5;

type Scenario = { name: string; restrictive: boolean; later?: boolean; query: string; count: number; expectedIds: string[] };

function uuidAt(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

describe('production search authorization PostgreSQL benchmark', () => {
  let ctx: TestContext;
  let db: Knex;
  let fixture: Awaited<ReturnType<typeof createCloseRulesFixture>>;
  let deniedClient: string;
  let bundleId: string;
  let allowedIds: string[];
  let unrestrictedIds: string[];

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['authorization_bundle_assignments', 'authorization_bundle_rules', 'authorization_bundle_revisions', 'authorization_bundles'] });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    db = ctx.db;
    fixture = await createCloseRulesFixture(db, ctx.tenantId, ctx.user.user_id);
    deniedClient = randomUUID();
    await tenantDb(db, ctx.tenantId).table('clients').insert({
      tenant: ctx.tenantId, client_id: deniedClient, client_name: `benchmark-denied-${randomUUID()}`,
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });

    const sourceRoleId = randomUUID();
    const permissionId = randomUUID();
    await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: sourceRoleId, role_name: `Benchmark ticket reader ${sourceRoleId}`, msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: permissionId, resource: 'ticket', action: 'read', msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: sourceRoleId, permission_id: permissionId });
    await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: sourceRoleId });

    const bundle = await createAuthorizationBundle(db, { tenant: ctx.tenantId, name: `Benchmark selected clients ${randomUUID()}`, actorUserId: ctx.user.user_id });
    bundleId = bundle.bundleId;
    await upsertBundleRule(db, {
      tenant: ctx.tenantId, bundleId, revisionId: bundle.revisionId, resourceType: 'ticket', action: 'read',
      templateKey: 'selected_clients', config: { selectedClientIds: [fixture.clientId] }, actorUserId: ctx.user.user_id,
    });
    await publishBundleRevision(db as any, { tenant: ctx.tenantId, bundleId, revisionId: bundle.revisionId, actorUserId: ctx.user.user_id });
    await createBundleAssignment(db, { tenant: ctx.tenantId, bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId: ctx.user.user_id });

    const tickets = Array.from({ length: BROAD_MATCHES }, (_, offset) => {
      const sequence = offset + 1;
      return {
        tenant: ctx.tenantId,
        ticket_id: uuidAt(sequence),
        ticket_number: `AUTHZ-BENCH-${String(sequence).padStart(5, '0')}`,
        title: sequence <= SMALL_MATCHES ? 'Needle small support case' : 'Needle broad support case',
        client_id: sequence % 10 === 0 ? fixture.clientId : deniedClient,
        contact_name_id: null,
        board_id: fixture.boardId,
        status_id: fixture.openStatusId,
        priority_id: fixture.priorityId,
        entered_by: ctx.user.user_id,
        entered_at: FIXED_RANKING,
        updated_at: FIXED_RANKING,
      };
    });
    await db.batchInsert('tickets', tickets, 500);
    const indexRows = tickets.map((ticket, offset) => ({
      body: offset + 1 <= SMALL_MATCHES ? 'needle support small' : 'needle support broad',
      tenant: ctx.tenantId,
      object_type: 'ticket',
      object_id: ticket.ticket_id,
      title: ticket.title,
      url: `/msp/tickets/${ticket.ticket_id}`,
      source_updated_at: FIXED_RANKING,
      metadata: JSON.stringify({}),
      required_permission: 'ticket:read',
      search_vector: db.raw(offset + 1 <= SMALL_MATCHES
        ? "to_tsvector('english', 'needle support small')"
        : "to_tsvector('english', 'needle support broad')"),
    }));
    await db.batchInsert('app_search_index', indexRows, 500);
    allowedIds = tickets.filter((ticket) => ticket.client_id === fixture.clientId).map((ticket) => ticket.ticket_id);
    unrestrictedIds = tickets.map((ticket) => ticket.ticket_id);
  }, HOOK_TIMEOUT);

  afterEach(async () => { await helpers.afterEach(); });
  afterAll(async () => { await helpers.afterAll(); }, HOOK_TIMEOUT);

  it('measures production resolver, evaluator/compiler and every request SQL statement', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const scenarios: Scenario[] = [
        { name: 'broad-five-hit-typeahead-unrestricted', restrictive: false, query: 'needle', count: BROAD_MATCHES, expectedIds: unrestrictedIds.slice(0, 5) },
        { name: 'broad-five-hit-typeahead-restrictive', restrictive: true, query: 'needle', count: 50, expectedIds: allowedIds.slice(0, 5) },
        { name: 'later-search-page-unrestricted', restrictive: false, later: true, query: 'needle', count: BROAD_MATCHES, expectedIds: unrestrictedIds.slice(5, 10) },
        { name: 'later-search-page-restrictive', restrictive: true, later: true, query: 'needle', count: 50, expectedIds: allowedIds.slice(5, 10) },
      ];

      const measurements: Array<Record<string, unknown>> = [];
      for (const scenario of scenarios) {
        if (scenario.restrictive) {
          // Keep the pre-seeded principal assignment active for this request.
        } else {
          await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
        }
        if (scenario.restrictive && !(await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId }).first())) {
          await createBundleAssignment(db, { tenant: ctx.tenantId, bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId: ctx.user.user_id });
        }

        const cursor = scenario.later
          ? (await runAppSearch(db, ctx.tenantId, ctx.user, { query: scenario.query, types: ['ticket'] as any, limit: 5 }, SEARCH_INDEX)).nextCursor
          : undefined;
        if (scenario.later) expect(typeof cursor).toBe('string');
        const request = () => runAppSearch(db, ctx.tenantId, ctx.user, {
          query: scenario.query, types: ['ticket'] as any, limit: 5, cursor,
        }, SEARCH_INDEX);
        for (let i = 0; i < WARMUPS; i += 1) {
          const warmed = await request();
          expect(warmed.totalCount).toBe(scenario.count);
          expect(warmed.results.map(({ id }) => id), scenario.name).toEqual(scenario.expectedIds);
        }

        const latencies: number[] = [];
        const statementCounts: number[] = [];
        for (let i = 0; i < SAMPLES; i += 1) {
          let statements = 0;
          const onQuery = () => { statements += 1; };
          db.on('query', onQuery);
          const started = performance.now();
          const result = await request();
          latencies.push(performance.now() - started);
          db.removeListener('query', onQuery);
          statementCounts.push(statements);
          expect(result.totalCount).toBe(scenario.count);
          expect(result.groups.ticket).toBe(scenario.count);
          expect(result.results.map(({ id }) => id), scenario.name).toEqual(scenario.expectedIds);
        }
        latencies.sort((a, b) => a - b);
        statementCounts.sort((a, b) => a - b);
        measurements.push({
          scenario: scenario.name,
          p95_ms: Number(latencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
          query_count_per_request: statementCounts[Math.floor(SAMPLES / 2)],
          warmup_requests: WARMUPS,
          measured_requests: SAMPLES,
          fixture_matches: BROAD_MATCHES,
          fixture_readable: allowedIds.length,
          concurrency: 1,
        });
      }

      // Match-count growth check on the compiled path: 150 -> 500 candidates.
      await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
      await createBundleAssignment(db, { tenant: ctx.tenantId, bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId: ctx.user.user_id });
      const scaling: Array<Record<string, unknown>> = [];
      for (const [query, matches, readable] of [['small', SMALL_MATCHES, 15], ['needle', BROAD_MATCHES, 50]] as const) {
        const counts: number[] = [];
        for (let i = 0; i < SAMPLES; i += 1) {
          let statements = 0;
          const onQuery = () => { statements += 1; };
          db.on('query', onQuery);
          const result = await runAppSearch(db, ctx.tenantId, ctx.user, { query, types: ['ticket'] as any, limit: 5 }, SEARCH_INDEX);
          db.removeListener('query', onQuery);
          counts.push(statements);
          expect(result.totalCount).toBe(readable);
          expect(result.groups.ticket).toBe(readable);
        }
        scaling.push({ matches, readable, median_query_count_per_request: [...counts].sort((a, b) => a - b)[Math.floor(SAMPLES / 2)] });
      }
      console.log(JSON.stringify({ revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded', postgresVersion: (await db.raw('SHOW server_version')).rows[0].server_version, fixture: { matching_tickets: BROAD_MATCHES, readable_tickets: allowedIds.length, denied_tickets: BROAD_MATCHES - allowedIds.length, ticket_source: 'public.tickets UUID columns', search_source: 'public.app_search_index' }, procedure: { warmups: WARMUPS, samples: SAMPLES, concurrency: 1, statement_method: 'Knex query event on the transaction connection during runAppSearch, including principal resolution, policy resolution, evaluator/source loads, counts and pages' }, measurements, compiled_path_scaling: scaling }));
    });
  }, 900_000);
});
