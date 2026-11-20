import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createCloseRulesFixture, insertResolutionComment } from './helpers/closeRulesFixture';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const SEARCH_INDEX = undefined;
const FIXED_RANKING = '2026-01-01T00:00:00.000Z';
const BROAD_MATCHES = 500;
const SMALL_MATCHES = 150;
const MIXED_NON_TICKET_MATCHES = 500;
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
  let projectIds: string[];
  let commentIds: string[];

  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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

    const projectRoleId = randomUUID();
    const projectPermissionId = randomUUID();
    await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: projectRoleId, role_name: `Benchmark project reader ${projectRoleId}`, msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: projectPermissionId, resource: 'project', action: 'read', msp: true, client: false });
    await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: projectRoleId, permission_id: projectPermissionId });
    await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: projectRoleId });

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
    const projectStatus = await tenantDb(db, ctx.tenantId).table('statuses')
      .where({ status_type: 'project' }).first('status_id');
    const projects = Array.from({ length: MIXED_NON_TICKET_MATCHES }, (_, offset) => {
      const sequence = offset + 1;
      return {
        tenant: ctx.tenantId,
        project_id: uuidAt(10_000 + sequence),
        project_name: sequence <= SMALL_MATCHES ? 'Needle small migration project' : 'Needle broad migration project',
        project_number: `MIXED-${String(sequence).padStart(5, '0')}`,
        client_id: fixture.clientId,
        status: projectStatus?.status_id ?? fixture.openStatusId,
        wbs_code: `MIXED-${sequence}`,
        is_inactive: false,
      };
    });
    await db.batchInsert('projects', projects, 500);
    const comments = [];
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      comments.push(await insertResolutionComment(db, fixture, uuidAt(sequence * 10), {
        is_internal: sequence % 2 === 0,
        publish_state: 'published',
      }));
    }
    commentIds = comments;
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
    indexRows.push(...projects.map((project, offset) => ({
      body: offset + 1 <= SMALL_MATCHES ? 'needle migration small' : 'needle migration broad',
      tenant: ctx.tenantId,
      object_type: 'project',
      object_id: project.project_id,
      title: project.project_name,
      url: `/msp/projects/${project.project_id}`,
      source_updated_at: FIXED_RANKING,
      metadata: JSON.stringify({}),
      required_permission: 'project:read',
      search_vector: db.raw(offset + 1 <= SMALL_MATCHES
        ? "to_tsvector('english', 'needle migration small')"
        : "to_tsvector('english', 'needle migration broad')"),
    })));
    indexRows.push({
      body: 'needle stale project', tenant: ctx.tenantId, object_type: 'project',
      object_id: uuidAt(99_999), title: 'Needle stale project', url: '/msp/projects/stale',
      source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'project:read',
      search_vector: db.raw("to_tsvector('english', 'needle stale project')"),
    });
    indexRows.push(...comments.map((commentId) => ({
      body: 'needle resolution comment', tenant: ctx.tenantId, object_type: 'ticket_comment',
      object_id: commentId, title: 'Needle resolution comment', url: `/msp/tickets/${commentId}`,
      source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'ticket:read',
      search_vector: db.raw("to_tsvector('english', 'needle resolution comment')"),
    })));
    await db.batchInsert('app_search_index', indexRows, 500);
    allowedIds = tickets.filter((ticket) => ticket.client_id === fixture.clientId).map((ticket) => ticket.ticket_id);
    unrestrictedIds = tickets.map((ticket) => ticket.ticket_id);
    projectIds = projects.map((project) => project.project_id);
  }, HOOK_TIMEOUT);

  afterEach(async () => { await helpers.afterEach(); });
  afterAll(async () => { await helpers.afterAll(); vi.restoreAllMocks(); }, HOOK_TIMEOUT);

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
        const rawLatencySamples = latencies.map((value) => Number(value.toFixed(2)));
        const rawStatementSamples = [...statementCounts];
        latencies.sort((a, b) => a - b);
        statementCounts.sort((a, b) => a - b);
        measurements.push({
          scenario: scenario.name,
          p95_ms: Number(latencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
          query_count_per_request: statementCounts[Math.floor(SAMPLES / 2)],
          raw_latency_samples_ms: rawLatencySamples,
          raw_query_count_samples: rawStatementSamples,
          warmup_requests: WARMUPS,
          measured_requests: SAMPLES,
          fixture_matches: BROAD_MATCHES,
          fixture_readable: allowedIds.length,
          concurrency: 1,
        });
      }

      // Match-count growth check under the restrictive policy: 150 -> 500 candidates.
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
      console.log(JSON.stringify({ revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded', postgresVersion: (await db.raw('SHOW server_version')).rows[0].server_version, fixture: { matching_tickets: BROAD_MATCHES, readable_tickets: allowedIds.length, denied_tickets: BROAD_MATCHES - allowedIds.length, ticket_source: 'public.tickets UUID columns', search_source: 'public.app_search_index' }, procedure: { warmups: WARMUPS, samples: SAMPLES, concurrency: 1, statement_method: 'Knex query event on the transaction connection during runAppSearch, including principal resolution, policy resolution, evaluator/source loads, counts and pages' }, measurements, match_count_scaling: scaling }));
    });
  }, 900_000);

  it('measures mixed candidate authorization at typeahead, cursor and maximum-page sizes', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const types = ['ticket', 'ticket_comment', 'project'] as any;
      const scenarios = [
        { name: 'mixed-first-five-unrestricted', restrictive: false, limit: 5, later: false },
        { name: 'mixed-first-five-bundle-restricted', restrictive: true, limit: 5, later: false },
        { name: 'mixed-later-five-unrestricted', restrictive: false, limit: 5, later: true },
        { name: 'mixed-later-five-bundle-restricted', restrictive: true, limit: 5, later: true },
        { name: 'mixed-first-100-unrestricted', restrictive: false, limit: 100, later: false },
        { name: 'mixed-later-100-unrestricted', restrictive: false, limit: 100, later: true },
        { name: 'mixed-first-100-bundle-restricted', restrictive: true, limit: 100, later: false },
        { name: 'mixed-later-100-bundle-restricted', restrictive: true, limit: 100, later: true },
      ] as const;
      const measurements: Array<Record<string, unknown>> = [];
      const expectedCount = (restrictive: boolean) => MIXED_NON_TICKET_MATCHES + (restrictive ? 50 : BROAD_MATCHES) + commentIds.length;

      for (const scenario of scenarios) {
        const assignment = tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId });
        if (scenario.restrictive) {
          if (!(await assignment.first())) await createBundleAssignment(db, {
            tenant: ctx.tenantId, bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId: ctx.user.user_id,
          });
        } else {
          await assignment.delete();
        }
        const prior = scenario.later
          ? await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types, limit: scenario.limit }, SEARCH_INDEX)
          : undefined;
        const cursor = prior?.nextCursor;
        if (scenario.later) expect(cursor, scenario.name).toBeTruthy();
        const request = () => runAppSearch(db, ctx.tenantId, ctx.user, {
          query: 'needle', types, limit: scenario.limit, cursor,
        }, SEARCH_INDEX);
        const expectedTotal = expectedCount(scenario.restrictive);
        const expectedTicketCount = scenario.restrictive ? 50 : BROAD_MATCHES;
        const expectedCommentCount = commentIds.length;
        const validate = (result: Awaited<ReturnType<typeof runAppSearch>>) => {
          expect(result.totalCount, scenario.name).toBe(expectedTotal);
          expect(result.groups.ticket).toBe(expectedTicketCount);
          expect(result.groups.ticket_comment).toBe(expectedCommentCount);
          expect(result.groups.project).toBe(MIXED_NON_TICKET_MATCHES);
          expect(new Set(result.results.map(({ id }) => id)).size).toBe(result.results.length);
          expect(result.results.every(({ id }) => projectIds.includes(id) || unrestrictedIds.includes(id) || commentIds.includes(id))).toBe(true);
        };
        validate(await request());
        const latencies: number[] = [];
        const statementCounts: number[] = [];
        for (let sample = 0; sample < SAMPLES; sample += 1) {
          let statements = 0;
          const onQuery = () => { statements += 1; };
          db.on('query', onQuery);
          const started = performance.now();
          const result = await request();
          latencies.push(performance.now() - started);
          db.removeListener('query', onQuery);
          statementCounts.push(statements);
          validate(result);
        }
        const rawLatencySamples = latencies.map((value) => Number(value.toFixed(2)));
        const rawStatementSamples = [...statementCounts];
        latencies.sort((a, b) => a - b);
        statementCounts.sort((a, b) => a - b);
        measurements.push({
          scenario: scenario.name,
          p95_ms: Number(latencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
          query_count_per_request: statementCounts[Math.floor(SAMPLES / 2)],
          raw_latency_samples_ms: rawLatencySamples,
          raw_query_count_samples: rawStatementSamples,
          warmup_requests: 1,
          measured_requests: SAMPLES,
          concurrency: 1,
          page_size: scenario.limit,
          matching_tickets: BROAD_MATCHES,
          matching_comments: commentIds.length,
          matching_projects: MIXED_NON_TICKET_MATCHES,
          indexed_project_candidates: MIXED_NON_TICKET_MATCHES + 1,
          stale_project_index_rows: 1,
          readable_tickets: expectedTicketCount,
          readable_comments: expectedCommentCount,
          readable_projects: MIXED_NON_TICKET_MATCHES,
          authorized_total: expectedTotal,
        });
        console.log(JSON.stringify({ mixed_sample: measurements[measurements.length - 1] }));
      }

      // Exact-size growth demonstrates whether project verification remains per candidate.
      const scaling: Array<Record<string, unknown>> = [];
      for (const [query, matches] of [['small', SMALL_MATCHES], ['needle', MIXED_NON_TICKET_MATCHES]] as const) {
        const counts: number[] = [];
        const latencies: number[] = [];
        for (let sample = 0; sample < SAMPLES; sample += 1) {
          let statements = 0;
          const onQuery = () => { statements += 1; };
          db.on('query', onQuery);
          const started = performance.now();
          const result = await runAppSearch(db, ctx.tenantId, ctx.user, { query, types: ['project'] as any, limit: 5 }, SEARCH_INDEX);
          latencies.push(performance.now() - started);
          db.removeListener('query', onQuery);
          counts.push(statements);
          expect(result.totalCount).toBe(matches);
          expect(result.groups.project).toBe(matches);
        }
        const sortedLatency = [...latencies].sort((a, b) => a - b);
        scaling.push({ matching_projects: matches, raw_query_count_samples: counts, raw_latency_samples_ms: latencies.map((value) => Number(value.toFixed(2))), p95_ms: Number(sortedLatency[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)), median_statements: [...counts].sort((a, b) => a - b)[Math.floor(SAMPLES / 2)] });
      }
      console.log(JSON.stringify({ mixed_project_match_growth: scaling }));
      expect(scaling[1].median_statements).toBe(scaling[0].median_statements);

      // Walk all public pages once to prove exact identity coverage and cursor termination.
      await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle', types, limit: 100, cursor }, SEARCH_INDEX);
        page.results.forEach(({ id }) => seen.add(id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen.size).toBe(expectedCount(false));
      expect(seen).toEqual(new Set([...unrestrictedIds, ...commentIds, ...projectIds]));

      const version = (await db.raw('SHOW server_version')).rows[0].server_version;
      console.log(JSON.stringify({
        revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded', postgresVersion: version,
        fixture: { matching_tickets: BROAD_MATCHES, matching_comments: commentIds.length, matching_projects: MIXED_NON_TICKET_MATCHES, indexed_project_candidates: MIXED_NON_TICKET_MATCHES + 1, stale_project_index_rows: 1, project_growth_queries: [SMALL_MATCHES, MIXED_NON_TICKET_MATCHES], sources: ['public.tickets', 'public.comments', 'public.projects', 'public.app_search_index'] },
        procedure: { warmups: 1, samples: SAMPLES, concurrency: 1, statement_method: 'Knex query events during runAppSearch, including principal and policy resolution, count and result SQL; fixture and cursor setup excluded', latency_method: 'performance.now wall-clock request duration; nearest-rank p95, sample 5 of 5' },
        measurements, project_match_growth: scaling,
      }));
    });
  }, 900_000);
});
