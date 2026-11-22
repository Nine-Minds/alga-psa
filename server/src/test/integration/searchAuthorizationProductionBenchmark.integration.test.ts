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
import { canCompileSearchVisibility, registerSearchVisibilityVerifier, resolveSearchAclPrincipal, verifyResultVisibility } from '@alga-psa/search/acl';
import { runAppSearch, runAuthorizedSearchCandidates } from '@alga-psa/search/runAppSearch';
import { TestContext } from '../../../test-utils/testContext';
import { createCloseRulesFixture, insertResolutionComment } from './helpers/closeRulesFixture';
import { createUser } from '../../../test-utils/testDataFactory';

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
    const comments: string[] = [];
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      comments.push(await insertResolutionComment(db, fixture, uuidAt(sequence * 10), {
        is_internal: sequence % 2 === 0,
        publish_state: 'published',
      }));
    }
    commentIds = comments;
    const indexRows = tickets.map((ticket, offset) => ({
      body: ['needle', offset + 1 <= 50 ? 'mixsmall' : '', offset + 1 <= 167 ? 'mixmedium' : '', 'mixlarge', offset + 1 <= SMALL_MATCHES ? 'support small' : 'support broad'].filter(Boolean).join(' '),
      tenant: ctx.tenantId,
      object_type: 'ticket',
      object_id: ticket.ticket_id,
      title: ticket.title,
      url: `/msp/tickets/${ticket.ticket_id}`,
      source_updated_at: FIXED_RANKING,
      metadata: JSON.stringify({}),
      required_permission: 'ticket:read',
      search_vector: db.raw("to_tsvector('english', ?)", [['needle', offset + 1 <= 50 ? 'mixsmall' : '', offset + 1 <= 167 ? 'mixmedium' : '', 'mixlarge', offset + 1 <= SMALL_MATCHES ? 'support small' : 'support broad'].filter(Boolean).join(' ')]),
    }));
    indexRows.push(...projects.map((project, offset) => ({
      body: ['needle', offset + 1 <= 50 ? 'mixsmall' : '', offset + 1 <= 166 ? 'mixmedium' : '', 'mixlarge', offset + 1 <= SMALL_MATCHES ? 'migration small' : 'migration broad'].filter(Boolean).join(' '),
      tenant: ctx.tenantId,
      object_type: 'project',
      object_id: project.project_id,
      title: project.project_name,
      url: `/msp/projects/${project.project_id}`,
      source_updated_at: FIXED_RANKING,
      metadata: JSON.stringify({}),
      required_permission: 'project:read',
      search_vector: db.raw("to_tsvector('english', ?)", [['needle', offset + 1 <= 50 ? 'mixsmall' : '', offset + 1 <= 166 ? 'mixmedium' : '', 'mixlarge', offset + 1 <= SMALL_MATCHES ? 'migration small' : 'migration broad'].filter(Boolean).join(' ')]),
    })));
    indexRows.push({
      body: 'needle stale project', tenant: ctx.tenantId, object_type: 'project',
      object_id: uuidAt(99_999), title: 'Needle stale project', url: '/msp/projects/stale',
      source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'project:read',
      search_vector: db.raw("to_tsvector('english', 'needle stale project')"),
    });
    indexRows.push(...comments.map((commentId, offset) => ({
      body: ['needle', offset < 50 ? 'mixsmall' : '', 'mixmedium', 'mixlarge', 'resolution comment'].filter(Boolean).join(' '), tenant: ctx.tenantId, object_type: 'ticket_comment',
      object_id: commentId, title: 'Needle resolution comment', url: `/msp/tickets/${commentId}`,
      source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'ticket:read',
      search_vector: db.raw("to_tsvector('english', ?)", [['needle', offset < 50 ? 'mixsmall' : '', 'mixmedium', 'mixlarge', 'resolution comment'].filter(Boolean).join(' ')]),
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

  it('measures one mixed ticket, comment and project search at 150, 500 and 1500 total candidates', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      // The original fixture contributes 50 comments on readable tickets. Add
      // one comment on each denied ticket so the largest query has 500 live
      // matches of every type while the restrictive policy still hides those
      // comments through their ticket parent.
      const moreComments: string[] = [];
      for (let sequence = 1; sequence <= 500; sequence += 1) {
        if (sequence % 10 === 0) continue;
        moreComments.push(await insertResolutionComment(db, fixture, uuidAt(sequence), {
          is_internal: sequence % 2 === 0,
          publish_state: 'published',
        }));
      }
      expect(moreComments).toHaveLength(450);
      const additionalIndexRows = moreComments.map((commentId, offset) => {
        const sequence = offset + 1;
        const body = [sequence <= 117 ? 'mixmedium' : '', 'mixlarge', 'resolution comment'].filter(Boolean).join(' ');
        return {
          body, tenant: ctx.tenantId, object_type: 'ticket_comment', object_id: commentId,
          title: 'Needle resolution comment', url: `/msp/tickets/${commentId}`,
          source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'ticket:read',
          search_vector: db.raw("to_tsvector('english', ?)", [body]),
        };
      });
      await db.batchInsert('app_search_index', additionalIndexRows, 500);
      const allCommentIds = [...commentIds, ...moreComments];
      const deniedCommentIds = new Set(moreComments);
      const scenarios = [
        { query: 'mixsmall', totalCandidates: 150, perType: { ticket: 50, ticket_comment: 50, project: 50 } },
        { query: 'mixmedium', totalCandidates: 500, perType: { ticket: 167, ticket_comment: 167, project: 166 } },
        { query: 'mixlarge', totalCandidates: 1500, perType: { ticket: 500, ticket_comment: 500, project: 500 } },
      ] as const;
      const types = ['ticket', 'ticket_comment', 'project'] as any;
      const measurements: Array<Record<string, unknown>> = [];

      for (const scenario of scenarios) {
        const assignment = tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId });
        await assignment.delete();
        const request = () => runAppSearch(db, ctx.tenantId, ctx.user, {
          query: scenario.query, types, limit: 100,
        }, SEARCH_INDEX);
        const validate = (result: Awaited<ReturnType<typeof runAppSearch>>, restrictive: boolean) => {
          const authorizedTickets = restrictive ? Math.floor(scenario.perType.ticket / 10) : scenario.perType.ticket;
          const authorizedComments = restrictive
            ? scenario.perType.ticket_comment - [...allCommentIds.slice(0, scenario.perType.ticket_comment)].filter((id) => deniedCommentIds.has(id)).length
            : scenario.perType.ticket_comment;
          const expectedTotal = authorizedTickets + authorizedComments + scenario.perType.project;
          expect(result.totalCount, `${scenario.query} total`).toBe(expectedTotal);
          expect(result.groups.ticket, `${scenario.query} tickets`).toBe(authorizedTickets);
          expect(result.groups.ticket_comment, `${scenario.query} comments`).toBe(authorizedComments);
          expect(result.groups.project, `${scenario.query} projects`).toBe(scenario.perType.project);
          expect(result.results).toHaveLength(Math.min(100, expectedTotal));
          expect(new Set(result.results.map(({ id }) => id)).size).toBe(result.results.length);
          expect(result.results.every(({ type, id }) =>
            (type === 'ticket' && unrestrictedIds.includes(id))
            || (type === 'ticket_comment' && allCommentIds.includes(id))
            || (type === 'project' && projectIds.includes(id)))).toBe(true);
          if (restrictive) {
            expect(result.results.every(({ type, id }) => type !== 'ticket' || allowedIds.includes(id))).toBe(true);
            expect(result.results.every(({ type, id }) => type !== 'ticket_comment' || !deniedCommentIds.has(id))).toBe(true);
          }
          return { expectedTotal, authorizedTickets, authorizedComments };
        };

        for (const restrictive of [false, true]) {
          if (restrictive) {
            await createBundleAssignment(db, { tenant: ctx.tenantId, bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId: ctx.user.user_id });
          } else {
            await assignment.delete();
          }
          const expected = validate(await request(), restrictive);
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
            validate(result, restrictive);
          }
          const sortedLatencies = [...latencies].sort((a, b) => a - b);
          const sortedStatements = [...statementCounts].sort((a, b) => a - b);
          measurements.push({
            scenario: `${scenario.query}-${restrictive ? 'bundle-restricted' : 'unrestricted'}`,
            candidate_semantics: 'total matching candidates across ticket, ticket_comment and project',
            total_candidates: scenario.totalCandidates,
            matching_by_type: scenario.perType,
            authorized_by_type: { ticket: expected.authorizedTickets, ticket_comment: expected.authorizedComments, project: scenario.perType.project },
            authorized_total: expected.expectedTotal,
            raw_latency_samples_ms: latencies.map((value) => Number(value.toFixed(2))),
            p95_ms: Number(sortedLatencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
            raw_query_count_samples: statementCounts,
            median_statements: sortedStatements[Math.floor(SAMPLES / 2)],
            warmup_requests: WARMUPS,
            measured_requests: SAMPLES,
            concurrency: 1,
            page_size: 100,
          });
        }
      }

      expect(allCommentIds).toHaveLength(500);
      console.log(JSON.stringify({
        revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded',
        postgresVersion: (await db.raw('SHOW server_version')).rows[0].server_version,
        mixed_total_candidate_measurements: measurements,
        fixture: { matching_tickets: 500, matching_comments: 500, matching_projects: 500, stale_project_index_rows: 1, sources: ['public.tickets', 'public.comments', 'public.projects', 'public.app_search_index'] },
        procedure: { warmups: WARMUPS, samples: SAMPLES, concurrency: 1, page_size: 100, policy: 'unrestricted internal user and selected-client bundle-restricted internal user; comments inherit parent ticket visibility', timing_boundary: 'performance.now around runAppSearch including principal/policy resolution, authorization, counts and page query; fixture and policy setup excluded', percentile: 'nearest-rank p95; with five samples this is the maximum' },
      }));
    });
  }, 900_000);

  it('uses SQL counts and bounded pages for index-ACL-only clients as matches grow', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const roleId = randomUUID();
      const permissionId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('roles').insert({
        tenant: ctx.tenantId, role_id: roleId, role_name: `Index ACL client reader ${roleId}`, msp: true, client: false,
      });
      await tenantDb(db, ctx.tenantId).table('permissions').insert({
        tenant: ctx.tenantId, permission_id: permissionId, resource: 'client', action: 'read', msp: true, client: false,
      });
      await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: roleId, permission_id: permissionId });
      await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: roleId });

      const clients = Array.from({ length: 1500 }, (_, offset) => {
        const sequence = offset + 1;
        return {
          tenant: ctx.tenantId, client_id: uuidAt(30_000 + sequence), client_name: `Index ACL client ${sequence}`,
          created_at: db.fn.now(), updated_at: db.fn.now(),
        };
      });
      await db.batchInsert('clients', clients, 500);
      const indexRows = clients.map((client, offset) => {
        const sequence = offset + 1;
        const segment = sequence <= 150 ? 'narrow medium massive'
          : sequence <= 500 ? 'medium massive' : 'massive';
        return {
          tenant: ctx.tenantId, object_type: 'client', object_id: client.client_id,
          title: client.client_name, body: `aclindex ${segment}`, url: `/msp/clients/${client.client_id}`,
          source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}),
          required_permission: sequence % 5 === 0 ? 'client:secret' : 'client:read',
          visible_to_user_ids: sequence % 5 === 1 ? [randomUUID()] : [],
          visible_to_roles: [], is_internal_only: false, is_private: false, client_scope_id: null,
          search_vector: db.raw(`to_tsvector('english', 'aclindex ${segment}')`),
        };
      });
      await db.batchInsert('app_search_index', indexRows, 500);

      expect(canCompileSearchVisibility('client')).toBe(true);
      const growth = [
        { query: 'narrow', candidates: 150, authorized: 90 },
        { query: 'medium', candidates: 500, authorized: 300 },
        { query: 'massive', candidates: 1500, authorized: 900 },
      ];
      const measurements: Array<Record<string, unknown>> = [];
      let stableStatementCount: number | undefined;
      for (const scenario of growth) {
        const statements: number[] = [];
        const latencies: number[] = [];
        for (let sample = 0; sample < SAMPLES; sample += 1) {
          let count = 0;
          const onQuery = () => { count += 1; };
          db.on('query', onQuery);
          const started = performance.now();
          const result = await runAppSearch(db, ctx.tenantId, ctx.user, {
            query: scenario.query, types: ['client'] as any, limit: 5,
          }, SEARCH_INDEX);
          latencies.push(performance.now() - started);
          db.removeListener('query', onQuery);
          statements.push(count);
          expect(result.totalCount).toBe(scenario.authorized);
          expect(result.groups.client).toBe(scenario.authorized);
          expect(result.results).toHaveLength(5);
        }
        const sortedLatencies = [...latencies].sort((a, b) => a - b);
        const medianStatements = [...statements].sort((a, b) => a - b)[Math.floor(SAMPLES / 2)];
        stableStatementCount ??= medianStatements;
        expect(medianStatements).toBe(stableStatementCount);
        measurements.push({
          matching_clients: scenario.candidates, authorized_clients: scenario.authorized,
          raw_query_count_samples: statements, median_statements: medianStatements,
          raw_latency_samples_ms: latencies.map((value) => Number(value.toFixed(2))),
          p95_ms: Number(sortedLatencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
        });
      }

      const expectedAuthorizedIds = new Set(indexRows
        .filter((row) => row.required_permission === 'client:read' && row.visible_to_user_ids.length === 0)
        .map((row) => row.object_id));
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await runAppSearch(db, ctx.tenantId, ctx.user, {
          query: 'massive', types: ['client'] as any, limit: 100, cursor,
        }, SEARCH_INDEX);
        expect(page.totalCount).toBe(900);
        expect(page.groups.client).toBe(900);
        page.results.forEach(({ id }) => seen.add(id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen.size).toBe(900);
      expect(seen).toEqual(expectedAuthorizedIds);
      console.log(JSON.stringify({ index_acl_client_growth: measurements, page_size: 100, authorized_ids: seen.size }));
    });
  }, 900_000);

  it('uses fallback when a verifier replaces a built-in project verifier', async () => {
    const restoreVerifier = registerSearchVisibilityVerifier('project', async () => false);
    try {
      await runWithTenant(ctx.tenantId, async () => {
        const projectId = projectIds[0];
        await db('app_search_index').where({ tenant: ctx.tenantId, object_type: 'project', object_id: projectId }).delete();
        await db('app_search_index').insert({
          tenant: ctx.tenantId, object_type: 'project', object_id: projectId,
          title: 'Replacement verifier candidate', body: 'replacementonly', url: `/msp/projects/${projectId}`,
          source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'project:read',
          search_vector: db.raw("to_tsvector('english', 'replacementonly')"),
        });
        const acl = await resolveSearchAclPrincipal(db, ctx.user);
        expect(canCompileSearchVisibility('project')).toBe(false);
        await expect(verifyResultVisibility(db, acl, [{ type: 'project', id: projectId }])).resolves.toEqual([]);

        const result = await runAppSearch(db, ctx.tenantId, ctx.user, {
          query: 'replacementonly', types: ['project'] as any, limit: 5,
        });
        expect(result.results).toEqual([]);
        expect(result.groups.project).toBe(0);
        expect(result.totalCount).toBe(0);
      });
    } finally {
      restoreVerifier();
    }
  }, 60_000);

  it('does not retain a superseded project predicate for an allowing replacement verifier', async () => {
    const restoreVerifier = registerSearchVisibilityVerifier('project', async () => true);
    try {
      await runWithTenant(ctx.tenantId, async () => {
        const orphanProjectId = randomUUID();
        await db('app_search_index').insert({
          tenant: ctx.tenantId, object_type: 'project', object_id: orphanProjectId,
          title: 'Allow replacement candidate', body: 'allowreplacement', url: `/msp/projects/${orphanProjectId}`,
          source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'project:read',
          search_vector: db.raw("to_tsvector('english', 'allowreplacement')"),
        });
        expect(canCompileSearchVisibility('project')).toBe(false);

        const result = await runAppSearch(db, ctx.tenantId, ctx.user, {
          query: 'allowreplacement', types: ['project'] as any, limit: 5,
        });
        expect(result.results.map(({ id }) => id)).toEqual([orphanProjectId]);
        expect(result.groups.project).toBe(1);
        expect(result.totalCount).toBe(1);
      });
    } finally {
      restoreVerifier();
    }
  }, 60_000);

  it('compiles document visibility with all-association and source-existence semantics', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const portalUserId = await createUser(db, ctx.tenantId, { user_type: 'client', contact_id: fixture.contactId });
      const roleId = randomUUID();
      const permissionId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: roleId, role_name: `Document parity reader ${roleId}`, msp: false, client: true });
      await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: permissionId, resource: 'document', action: 'read', msp: false, client: true });
      await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: roleId, permission_id: permissionId });
      await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: portalUserId, role_id: roleId });

      const portalUser = { ...ctx.user, user_id: portalUserId, user_type: 'client', contact_id: fixture.contactId, clientId: fixture.clientId, roles: [] } as any;
      const documentType = await tenantDb(db, ctx.tenantId).table('document_types').first('type_id');
      const documentId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('documents').insert({
        tenant: ctx.tenantId, document_id: documentId, document_name: 'Needle first association document',
        type_id: documentType.type_id, user_id: ctx.user.user_id, created_by: ctx.user.user_id,
      });
      await tenantDb(db, ctx.tenantId).table('document_associations').insert([
        { tenant: ctx.tenantId, document_id: documentId, entity_type: 'client', entity_id: deniedClient },
        { tenant: ctx.tenantId, document_id: documentId, entity_type: 'client', entity_id: fixture.clientId },
      ]);
      await db('app_search_index').insert({
        tenant: ctx.tenantId, object_type: 'document', object_id: documentId,
        title: 'Needle first association document', body: 'needle association', url: `/msp/documents/${documentId}`,
        source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'document:read',
        search_vector: db.raw("to_tsvector('english', 'needle association')"),
      });

      const acl = await resolveSearchAclPrincipal(db, portalUser, { mode: 'scoped', clientIds: [fixture.clientId] });
      expect(canCompileSearchVisibility('document')).toBe(true);
      await expect(verifyResultVisibility(db, acl, [{ type: 'document', id: documentId }])).resolves.toEqual([]);
      const result = await runAppSearch(db, ctx.tenantId, portalUser, { query: 'needle association', types: ['document'] as any, limit: 5 });
      expect(result.results).toEqual([]);
      expect(result.groups.document).toBe(0);
      expect(result.totalCount).toBe(0);

      const allowedId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('documents').insert({
        tenant: ctx.tenantId, document_id: allowedId, document_name: 'Needle allowed association document',
        type_id: documentType.type_id, user_id: ctx.user.user_id, created_by: ctx.user.user_id,
      });
      await tenantDb(db, ctx.tenantId).table('document_associations').insert({
        tenant: ctx.tenantId, document_id: allowedId, entity_type: 'client', entity_id: fixture.clientId,
      });
      await db('app_search_index').insert({
        tenant: ctx.tenantId, object_type: 'document', object_id: allowedId,
        title: 'Needle allowed association document', body: 'needle association', url: `/msp/documents/${allowedId}`,
        source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'document:read',
        search_vector: db.raw("to_tsvector('english', 'needle association')"),
      });
      const allowedResult = await runAppSearch(db, ctx.tenantId, portalUser, { query: 'needle association', types: ['document'] as any, limit: 5 });
      expect(allowedResult.results.map(({ id }) => id)).toEqual([allowedId]);
      expect(allowedResult.groups.document).toBe(1);
      expect(allowedResult.totalCount).toBe(1);

      // The replacement verifier has no compiler. Its replacement policy must
      // be authoritative even for a stale index row; the built-in SQL predicate
      // must not survive independently of the active registration.
      const orphanId = randomUUID();
      await db('app_search_index').insert({
        tenant: ctx.tenantId, object_type: 'document', object_id: orphanId,
        title: 'Needle replacement document', body: 'needle replacement', url: `/msp/documents/${orphanId}`,
        source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'document:read',
        search_vector: db.raw("to_tsvector('english', 'needle replacement')"),
      });
      const restoreVerifier = registerSearchVisibilityVerifier('document', async () => true);
      try {
        expect(canCompileSearchVisibility('document')).toBe(false);
        const replacementResult = await runAppSearch(db, ctx.tenantId, portalUser, { query: 'needle replacement', types: ['document'] as any, limit: 5 });
        expect(replacementResult.results.map(({ id }) => id)).toEqual([orphanId]);
        expect(replacementResult.totalCount).toBe(1);
      } finally {
        restoreVerifier();
      }
    });
  }, 60_000);

  it('matches PostgreSQL source verifiers for every remaining compiled visibility predicate', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const workflowRoleId = randomUUID();
      const workflowPermissionId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('roles').insert({ tenant: ctx.tenantId, role_id: workflowRoleId, role_name: `Workflow search reader ${workflowRoleId}`, msp: true, client: false });
      await tenantDb(db, ctx.tenantId).table('permissions').insert({ tenant: ctx.tenantId, permission_id: workflowPermissionId, resource: 'workflow_task', action: 'read', msp: true, client: false });
      await tenantDb(db, ctx.tenantId).table('role_permissions').insert({ tenant: ctx.tenantId, role_id: workflowRoleId, permission_id: workflowPermissionId });
      await tenantDb(db, ctx.tenantId).table('user_roles').insert({ tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: workflowRoleId });

      const projectStatus = await tenantDb(db, ctx.tenantId).table('statuses').where({ status_type: 'project' }).first('status_id');
      const projectId = randomUUID();
      const phaseId = randomUUID();
      const taskId = randomUUID();
      const taskCommentId = randomUUID();
      const taskThreadId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('projects').insert({
        tenant: ctx.tenantId, project_id: projectId, client_id: fixture.clientId,
        project_name: 'Needle parity project', project_number: `PARITY-${projectId.slice(0, 8)}`,
        status: projectStatus.status_id, wbs_code: `PARITY-${projectId}`, is_inactive: false,
      });
      await tenantDb(db, ctx.tenantId).table('project_phases').insert({
        tenant: ctx.tenantId, phase_id: phaseId, project_id: projectId, phase_name: 'Needle parity phase',
        order_number: 1, status: 'active', wbs_code: 'PARITY.1',
      });
      await tenantDb(db, ctx.tenantId).table('project_tasks').insert({
        tenant: ctx.tenantId, task_id: taskId, phase_id: phaseId, task_name: 'Needle parity task', wbs_code: 'PARITY.1.1',
      });
      await tenantDb(db, ctx.tenantId).table('comment_threads').insert({
        tenant: ctx.tenantId, thread_id: taskThreadId, project_task_id: taskId, root_comment_id: taskCommentId, is_internal: false,
      });
      await tenantDb(db, ctx.tenantId).table('project_task_comments').insert({
        tenant: ctx.tenantId, task_comment_id: taskCommentId, task_id: taskId, thread_id: taskThreadId,
        user_id: ctx.user.user_id, note: '[]', author_type: 'internal',
      });

      const systemTaskType = await db('system_workflow_task_definitions').first('task_type');
      expect(systemTaskType?.task_type).toBeTruthy();
      const workflowRows = [
        { id: randomUUID(), assigned_users: JSON.stringify([ctx.user.user_id]) },
        { id: randomUUID(), assigned_users: JSON.stringify([randomUUID()]) },
        { id: randomUUID(), assigned_users: JSON.stringify([]) },
        { id: randomUUID(), assigned_users: JSON.stringify([42]) },
      ];
      for (const workflow of workflowRows) {
        await tenantDb(db, ctx.tenantId).table('workflow_tasks').insert({
          tenant: ctx.tenantId, task_id: workflow.id, execution_id: randomUUID(),
          task_definition_type: 'system', system_task_definition_task_type: systemTaskType.task_type,
          tenant_task_definition_id: null, title: 'Needle parity workflow task', status: 'pending', priority: 'medium',
          assigned_users: workflow.assigned_users,
        });
      }

      const ticketStatus = await tenantDb(db, ctx.tenantId).table('statuses').where({ status_id: fixture.openStatusId }).first('name');
      const cases: Array<{ type: string; id: string; permission: string }> = [
        { type: 'project', id: projectId, permission: 'project:read' },
        { type: 'project_phase', id: phaseId, permission: 'project:read' },
        { type: 'project_task', id: taskId, permission: 'project:read' },
        { type: 'project_task_comment', id: taskCommentId, permission: 'project:read' },
        ...workflowRows.map(({ id }) => ({ type: 'workflow_task', id, permission: 'workflow_task:read' })),
        { type: 'status', id: ticketStatus.name, permission: 'ticket:read' },
        { type: 'status', id: `Missing parity status ${randomUUID()}`, permission: 'ticket:read' },
      ];
      await db('app_search_index').insert(cases.map(({ type, id, permission }) => ({
        tenant: ctx.tenantId, object_type: type, object_id: id, title: `Needle parity ${type}`,
        body: 'needle parity', url: `/search/${type}/${id}`, source_updated_at: FIXED_RANKING,
        metadata: JSON.stringify({}), required_permission: permission,
        search_vector: db.raw("to_tsvector('english', 'needle parity')"),
      })));

      const acl = await resolveSearchAclPrincipal(db, ctx.user);
      const grouped = new Map<string, Array<{ type: any; id: string }>>();
      for (const candidate of cases) {
        const rows = grouped.get(candidate.type) ?? [];
        rows.push({ type: candidate.type, id: candidate.id });
        grouped.set(candidate.type, rows);
      }
      for (const [type, candidates] of grouped) {
        expect(canCompileSearchVisibility(type as any), type).toBe(true);
        const expected = await verifyResultVisibility(db, acl, candidates);
        const result = await runAppSearch(db, ctx.tenantId, ctx.user, { query: 'needle parity', types: [type] as any, limit: 100 });
        expect(result.results.map(({ id }) => id).sort(), type).toEqual(expected.map(({ id }) => id).sort());
        expect(result.groups[type as keyof typeof result.groups]).toBe(expected.length);
        expect(result.totalCount).toBe(expected.length);
      }
    });
  }, 60_000);

  it('measures SQL-filtered document visibility at 150, 500 and 1500 candidates', async () => {
    await runWithTenant(ctx.tenantId, async () => {
      const sizes = [150, 500, 1500] as const;
      const documentTypeId = randomUUID();
      const documentPermissionId = randomUUID();
      const documentRoleId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('document_types').insert({
        tenant: ctx.tenantId, type_id: documentTypeId, type_name: `Search fallback benchmark ${documentTypeId}`,
      });
      await tenantDb(db, ctx.tenantId).table('roles').insert({
        tenant: ctx.tenantId, role_id: documentRoleId, role_name: `Document search reader ${documentRoleId}`, msp: true, client: false,
      });
      await tenantDb(db, ctx.tenantId).table('permissions').insert({
        tenant: ctx.tenantId, permission_id: documentPermissionId, resource: 'document', action: 'read', msp: true, client: false,
      });
      await tenantDb(db, ctx.tenantId).table('role_permissions').insert({
        tenant: ctx.tenantId, role_id: documentRoleId, permission_id: documentPermissionId,
      });
      await tenantDb(db, ctx.tenantId).table('user_roles').insert({
        tenant: ctx.tenantId, user_id: ctx.user.user_id, role_id: documentRoleId,
      });

      const portalUserId = await createUser(db, ctx.tenantId, { user_type: 'client', contact_id: fixture.contactId });
      const portalRoleId = randomUUID();
      const portalPermissionId = randomUUID();
      await tenantDb(db, ctx.tenantId).table('roles').insert({
        tenant: ctx.tenantId, role_id: portalRoleId, role_name: `Portal document reader ${portalRoleId}`, msp: false, client: true,
      });
      await tenantDb(db, ctx.tenantId).table('permissions').insert({
        tenant: ctx.tenantId, permission_id: portalPermissionId, resource: 'document', action: 'read', msp: false, client: true,
      });
      await tenantDb(db, ctx.tenantId).table('role_permissions').insert({
        tenant: ctx.tenantId, role_id: portalRoleId, permission_id: portalPermissionId,
      });
      await tenantDb(db, ctx.tenantId).table('user_roles').insert({
        tenant: ctx.tenantId, user_id: portalUserId, role_id: portalRoleId,
      });
      const portalUser = { ...ctx.user, user_id: portalUserId, user_type: 'client', contact_id: fixture.contactId, clientId: fixture.clientId, roles: [] } as any;

      const documentIds: string[] = Array.from({ length: 1500 }, () => randomUUID());
      const documents = documentIds.flatMap((documentId, offset) => {
        // Keep every tenth index candidate stale so source-record verification
        // must reject it and the reported totals prove more than query routing.
        if ((offset + 1) % 10 === 0) return [];
        return [{
          tenant: ctx.tenantId, document_id: documentId, document_name: `Search fallback document ${offset + 1}`,
          type_id: documentTypeId, user_id: ctx.user.user_id, created_by: ctx.user.user_id,
          entered_at: FIXED_RANKING, updated_at: FIXED_RANKING, content: 'benchmark fixture',
        }];
      });
      await db.batchInsert('documents', documents, 500);
      const associations = documents.flatMap(({ document_id }, offset) => {
        if (offset % 5 === 0) return [{ tenant: ctx.tenantId, association_id: randomUUID(), document_id, entity_id: deniedClient, entity_type: 'client' }];
        if (offset % 7 === 0) return [
          { tenant: ctx.tenantId, association_id: randomUUID(), document_id, entity_id: fixture.clientId, entity_type: 'client' },
          { tenant: ctx.tenantId, association_id: randomUUID(), document_id, entity_id: deniedClient, entity_type: 'client' },
        ];
        return [{ tenant: ctx.tenantId, association_id: randomUUID(), document_id, entity_id: fixture.clientId, entity_type: 'client' }];
      });
      await db.batchInsert('document_associations', associations, 500);
      const indexRows = documentIds.map((documentId, offset) => {
        const sequence = offset + 1;
        const body = [
          'fallback',
          'large',
          sequence <= 500 ? 'medium' : '',
          sequence <= 150 ? 'small' : '',
        ].filter(Boolean).join(' ');
        return {
          tenant: ctx.tenantId, object_type: 'document', object_id: documentId,
          title: `Search fallback document ${sequence}`, body, url: `/msp/documents/${documentId}`,
          source_updated_at: FIXED_RANKING, metadata: JSON.stringify({}), required_permission: 'document:read',
          search_vector: db.raw("to_tsvector('english', ?)", [body]),
        };
      });
      await db.batchInsert('app_search_index', indexRows, 500);

      expect(canCompileSearchVisibility('document')).toBe(true);
      const scenarios: Array<{ size: typeof sizes[number]; query: string }> = [
        { size: 150, query: 'small' },
        { size: 500, query: 'medium' },
        { size: 1500, query: 'large' },
      ];
      const measurements: Array<Record<string, unknown>> = [];
      for (const scenario of scenarios) {
        const contexts = [
          { name: 'unrestricted-internal', user: ctx.user, expected: documentIds.slice(0, scenario.size).filter((_, index) => (index + 1) % 10 !== 0) },
          { name: 'client-portal-scoped', user: portalUser, expected: documentIds.slice(0, scenario.size).filter((id, index) => {
            if ((index + 1) % 10 === 0) return false;
            const linked = associations.filter((association) => association.document_id === id);
            return linked.every(({ entity_id }) => entity_id === fixture.clientId);
          }) },
        ];
        for (const context of contexts) {
          for (const variant of ['typeahead', 'full'] as const) {
            const expectedDocumentIds = context.expected;
            const expectedTotal = expectedDocumentIds.length;
            const request = () => variant === 'typeahead'
              ? runAuthorizedSearchCandidates({
                knex: db, tenant: ctx.tenantId, user: context.user, query: scenario.query,
                requestedTypes: ['document'] as any, pageSize: 5, includeSnippets: false,
                searchIndex: SEARCH_INDEX,
              })
              : runAppSearch(db, ctx.tenantId, context.user, {
                query: scenario.query, types: ['document'] as any, limit: 100,
              }, SEARCH_INDEX);
            const validate = async (result: Awaited<ReturnType<typeof runAppSearch>> | Awaited<ReturnType<typeof runAuthorizedSearchCandidates>>) => {
              const groups = result.groups;
              const hits = ('results' in result ? result.results : result.visibleHits).slice(0, variant === 'typeahead' ? 5 : 100);
              expect(groups.document, `${context.name}/${variant}/${scenario.size} group`).toBe(expectedTotal);
              if ('totalCount' in result) expect(result.totalCount).toBe(expectedTotal);
              expect(hits).toHaveLength(Math.min(variant === 'typeahead' ? 5 : 100, expectedTotal));
              expect(new Set(hits.map(({ id }) => id)).size).toBe(hits.length);
              expect(hits.every(({ type, id }) => type === 'document' && expectedDocumentIds.includes(id))).toBe(true);
            };
            await validate(await request());

            const latencies: number[] = [];
            const statementCounts: number[] = [];
            const documentSourceStatements: number[] = [];
            const associationSourceStatements: number[] = [];
            for (let sample = 0; sample < SAMPLES; sample += 1) {
              let statements = 0;
              let documentReads = 0;
              let associationReads = 0;
              const onQuery = (query: { sql: string }) => {
                statements += 1;
                if (/^\s*select\b[\s\S]*\bfrom\s+["']?documents\b/i.test(query.sql)) documentReads += 1;
                if (/^\s*select\b[\s\S]*\bfrom\s+["']?document_associations\b/i.test(query.sql)) associationReads += 1;
              };
              db.on('query', onQuery);
              try {
                const started = performance.now();
                const result = await request();
                latencies.push(performance.now() - started);
                await validate(result);
              } finally {
                db.removeListener('query', onQuery);
              }
              statementCounts.push(statements);
              documentSourceStatements.push(documentReads);
              associationSourceStatements.push(associationReads);
              expect(documentReads, `${context.name}/${variant}/${scenario.size} document verification SELECTs`).toBe(0);
              expect(associationReads, `${context.name}/${variant}/${scenario.size} association verification SELECTs`).toBe(0);
            }
            expect(new Set(statementCounts).size, `${context.name}/${variant}/${scenario.size} deterministic SQL count`).toBe(1);

            if (variant === 'full') {
              const seen = new Set<string>();
              let cursor: string | undefined;
              let pages = 0;
              do {
                const page = await runAppSearch(db, ctx.tenantId, context.user, {
                  query: scenario.query, types: ['document'] as any, limit: 100, cursor,
                }, SEARCH_INDEX);
                expect(page.totalCount).toBe(expectedTotal);
                for (const hit of page.results) {
                  expect(seen.has(hit.id)).toBe(false);
                  seen.add(hit.id);
                }
                cursor = page.nextCursor;
                pages += 1;
                expect(pages).toBeLessThanOrEqual(Math.ceil(expectedTotal / 100) + 1);
              } while (cursor);
              expect(seen).toEqual(new Set(expectedDocumentIds));
            }

            const sortedLatencies = [...latencies].sort((a, b) => a - b);
            measurements.push({
              scenario: `${scenario.size}-${context.name}-${variant}`,
              authorization_context: context.name === 'client-portal-scoped'
                ? `Client portal scoped to ${fixture.clientId}; denied and multiply-associated documents are excluded.`
                : 'Internal user with unrestricted client access.',
              entry_point: variant === 'typeahead' ? 'runAuthorizedSearchCandidates, page size 5, no snippets' : 'runAppSearch first page, page size 100',
              matching_document_candidates: scenario.size,
              authorized_total: expectedTotal,
              stale_source_candidates: Math.floor(scenario.size / 10),
              denied_association_candidates: scenario.size - Math.floor(scenario.size / 10) - expectedTotal,
              multiply_associated_candidates: Math.ceil((scenario.size - Math.floor(scenario.size / 10)) / 7),
              complete_pagination_validated: variant === 'full',
              raw_latency_samples_ms: latencies.map((value) => Number(value.toFixed(2))),
              p95_ms: Number(sortedLatencies[Math.ceil(SAMPLES * 0.95) - 1].toFixed(2)),
              raw_statement_count_samples: statementCounts,
              median_statements: [...statementCounts].sort((a, b) => a - b)[Math.floor(SAMPLES / 2)],
              raw_document_verification_select_samples: documentSourceStatements,
              raw_association_verification_select_samples: associationSourceStatements,
              warmup_requests: WARMUPS,
              measured_requests: SAMPLES,
              concurrency: 1,
              page_size: variant === 'typeahead' ? 5 : 100,
            });
            console.log(JSON.stringify({ document_visibility_sample: measurements[measurements.length - 1] }));
          }
        }
      }

      for (const context of ['unrestricted-internal', 'client-portal-scoped']) {
        for (const variant of ['typeahead', 'full']) {
          const counts = measurements
            .filter((measurement) => measurement.scenario.toString().includes(`${context}-${variant}`))
            .map((measurement) => measurement.median_statements);
          expect(new Set(counts).size, `${context}/${variant} statement growth over 150/500/1500 candidates`).toBe(1);
        }
      }

      await tenantDb(db, ctx.tenantId).table('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
      console.log(JSON.stringify({
        revision: process.env.SEARCH_BENCH_REVISION ?? 'unrecorded',
        postgresVersion: (await db.raw('SHOW server_version')).rows[0].server_version,
        fixture: {
          matching_document_candidates: 1500, source_documents: documents.length,
          stale_index_candidates: 150, document_client_associations: associations.length,
          fixture_composition: 'Readable client-associated rows, denied client-associated rows, multiply associated rows with one allowed and one denied client, and stale index-only rows.',
          sources: ['public.documents', 'public.document_associations', 'public.document_types', 'public.app_search_index'],
        },
        procedure: {
          warmups: WARMUPS, samples: SAMPLES, concurrency: 1, page_size: 100,
          timing_boundary: 'performance.now around the request path, including principal and policy resolution, SQL visibility, counts and first page; fixture setup and warmup excluded. Full-search cursor walk validated outside the timed request samples.',
          statement_method: 'Knex query events on the transaction connection during each timed request; standalone document and association verification SELECTs counted separately from correlated EXISTS predicates.',
          percentile: 'Nearest-rank p95; with five samples the p95 is the maximum.',
          visibility_confirmation: 'canCompileSearchVisibility(document) is true; the active verifier compiler admits source existence and all-association client scope in page/count SQL. Timed requests issue no separate document or association verification SELECTs.',
        },
        measurements,
      }));
    });
  }, 900_000);
});
