/**
 * Opt-in disposable-PostgreSQL project-search benchmark. See
 * docs/evidence/project-search-performance-2026-11-23/README.md for provisioning,
 * baseline worktree commands, fixture assumptions, and result interpretation.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import knexLib, { type Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';

const benchmarkState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: '', user_type: 'internal', roles: [] as unknown[] } as Record<string, unknown>,
  captureSearchQuery: false,
  capturedSearchQueries: [] as Array<{ sql: string; bindings: unknown[] }>,
}));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: benchmarkState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) => benchmarkState.trx.transaction(async (trx: any) => {
    const wrappedTrx = new Proxy(trx, {
      get(target, property) {
        if (property === 'raw') {
          return (sql: string, bindings?: unknown[], ...args: unknown[]) => {
            if (benchmarkState.captureSearchQuery && sql.includes('WITH q AS')) {
              benchmarkState.capturedSearchQueries.push({ sql, bindings: bindings ?? [] });
            }
            return target.raw(sql, bindings, ...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return callback(wrappedTrx);
  })),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn(benchmarkState.user, { tenant: benchmarkState.tenant }, ...args),
  withOptionalAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn(benchmarkState.user, { tenant: benchmarkState.tenant }, ...args),
}));
// This only satisfies the action's coarse RBAC gate. Record decisions below use
// the real createProjectReadAuthorizer, kernel, builtin provider, and bundle DB.
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined) }));

import { searchProjectListIds } from './projectActions';
import { createProjectReadAuthorizer } from '../lib/projectReadAuthorization';
import { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } from '@alga-psa/authorization/bundles/service';
import { tenantDb } from '@alga-psa/db';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../../../inventory/src/test-utils/inventoryTestDatabase';

const PROJECT_COUNT = Number(process.env.PROJECT_SEARCH_BENCHMARK_PROJECTS || 2500);
const INDEX_ENTRIES_PER_PROJECT = 4;
const MEASURED_REPETITIONS = 3;
const WARMUP_REPETITIONS = 1;
const FIXTURE_SOURCE_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');
const SEARCH_TERMS = {
  common: 'commonamber',
  rare: 'rarezircon',
  noMatch: 'nevermatchingtoken',
} as const;

let knex: Knex;
let tenant: string;
let userId: string;
let allowedClientId: string;
let deniedClientId: string;
let statusId: string;
let fixtureProjectIds: string[] = [];
let activeBundle: { bundleId: string; revisionId: string };

function assertIsDisposableBenchmarkDatabase(): void {
  if (process.env.PROJECT_SEARCH_BENCHMARK !== '1') {
    throw new Error('Set PROJECT_SEARCH_BENCHMARK=1 to run this opt-in benchmark.');
  }
  const database = process.env.TEST_DB_NAME ?? '';
  if (!/(project_search|search_bench).*test/i.test(database)) {
    throw new Error(`Refusing non-benchmark database ${database || '(unset)'}; TEST_DB_NAME must identify an isolated project search benchmark database.`);
  }
  if (!Number.isInteger(PROJECT_COUNT) || PROJECT_COUNT < 1000) {
    throw new Error('PROJECT_SEARCH_BENCHMARK_PROJECTS must be an integer of at least 1000.');
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

async function time<T>(operation: () => Promise<T>): Promise<{ result: T; milliseconds: number }> {
  const start = performance.now();
  const result = await operation();
  return { result, milliseconds: performance.now() - start };
}

async function seedSearchCorpus(): Promise<void> {
  const projects: Array<Record<string, unknown>> = [];
  const phases: Array<Record<string, unknown>> = [];
  const tasks: Array<Record<string, unknown>> = [];
  const indexEntries: Array<Record<string, unknown>> = [];
  fixtureProjectIds = [];

  for (let index = 0; index < PROJECT_COUNT; index += 1) {
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const taskId = randomUUID();
    const clientId = index % 2 === 0 ? allowedClientId : deniedClientId;
    const projectNumber = `BENCH-${String(index).padStart(6, '0')}`;
    const common = index % 4 === 0 ? ` ${SEARCH_TERMS.common}` : '';
    const rare = index === 2 ? ` ${SEARCH_TERMS.rare}` : '';
    const projectName = `Search performance fixture ${String(index).padStart(6, '0')}${common}${rare}`;
    fixtureProjectIds.push(projectId);
    projects.push({
      tenant, project_id: projectId, project_name: projectName, client_id: clientId,
      status: statusId, wbs_code: `B${String(index).padStart(6, '0')}`, project_number: projectNumber,
      created_at: FIXTURE_SOURCE_TIMESTAMP, updated_at: FIXTURE_SOURCE_TIMESTAMP,
    });
    phases.push({
      tenant, phase_id: phaseId, project_id: projectId, phase_name: `Planning phase ${index}`,
      status: 'open', order_number: 1, wbs_code: `B${String(index).padStart(6, '0')}.1`,
      created_at: FIXTURE_SOURCE_TIMESTAMP, updated_at: FIXTURE_SOURCE_TIMESTAMP,
    });
    tasks.push({
      tenant, task_id: taskId, phase_id: phaseId, task_name: `Review task ${index}`,
      description: `Routine task description ${index}`, wbs_code: `B${String(index).padStart(6, '0')}.1.1`,
      created_at: FIXTURE_SOURCE_TIMESTAMP, updated_at: FIXTURE_SOURCE_TIMESTAMP,
    });
    const indexRows = [
      { object_type: 'project', object_id: projectId, parent_type: null, parent_id: null, title: projectName, subtitle: null, body: 'Project body content' },
      { object_type: 'project_phase', object_id: phaseId, parent_type: 'project', parent_id: projectId, title: `Planning phase ${index}`, subtitle: projectName, body: 'Phase body content' },
      { object_type: 'project_task', object_id: taskId, parent_type: 'project', parent_id: projectId, title: `Review task ${index}`, subtitle: projectName, body: 'Task body content' },
      { object_type: 'project_task_comment', object_id: randomUUID(), parent_type: 'project_task', parent_id: taskId, title: `Review task ${index}`, subtitle: projectName, body: 'Comment body content' },
    ];
    for (const row of indexRows) {
      const text = [row.title, row.subtitle, row.body].filter(Boolean).join(' ');
      indexEntries.push({
        ...row, tenant, url: `/msp/projects/${projectId}`, metadata: {},
        visible_to_user_ids: [], visible_to_roles: [], is_internal_only: false, is_private: false,
        client_scope_id: clientId, required_permission: 'project:read',
        search_vector: knex.raw("setweight(to_tsvector('english', ?), 'A')", [text]),
        source_updated_at: FIXTURE_SOURCE_TIMESTAMP,
      });
    }
  }

  for (const [table, rows] of [['projects', projects], ['project_phases', phases], ['project_tasks', tasks], ['app_search_index', indexEntries]] as const) {
    for (let offset = 0; offset < rows.length; offset += 500) {
      await benchmarkState.trx(table).insert(rows.slice(offset, offset + 500));
    }
  }
}

async function prepareRealAuthorizationPolicy(): Promise<{ bundleId: string; revisionId: string }> {
  const bundle = await createAuthorizationBundle(benchmarkState.trx, { tenant, name: 'Project Search Benchmark Client Scope' });
  await upsertBundleRule(benchmarkState.trx, {
    tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
    resourceType: 'project', action: 'read', templateKey: 'selected_clients',
    config: {
      selectedClientIds: [allowedClientId],
      redactedFields: ['projects.description', 'project_tasks.description'],
    },
  });
  await publishBundleRevision(benchmarkState.trx, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId });
  await createBundleAssignment(benchmarkState.trx, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: userId });
  return bundle;
}

async function runBenchmark(): Promise<Record<string, unknown>> {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tenantDbClient = tenantDb(benchmarkState.trx, tenant);
  const projectRows = await tenantDbClient.table('projects').where({ tenant }).select('project_id', 'project_name', 'project_number', 'assigned_to', 'client_id');
  const user = benchmarkState.user as unknown as IUserWithRoles;
  const authorizeProjectRead = await createProjectReadAuthorizer(benchmarkState.trx, tenant, user);
  const authorizationSweepMs: number[] = [];
  let decisions: Awaited<ReturnType<typeof authorizeProjectRead>>[] = [];
  for (let repetition = 0; repetition < MEASURED_REPETITIONS; repetition += 1) {
    const authTiming = await time(async () => Promise.all(projectRows.map((project: any) => authorizeProjectRead(project))));
    authorizationSweepMs.push(authTiming.milliseconds);
    decisions = authTiming.result;
  }
  const allowedCount = decisions.filter((decision) => decision.allowed).length;
  const decisionCounts = {
    allowed: allowedCount,
    denied: decisions.length - allowedCount,
    redactedAllowed: decisions.filter((decision) => decision.allowed && decision.redactedFields.length > 0).length,
    redactedDenied: decisions.filter((decision) => !decision.allowed && decision.redactedFields.length > 0).length,
  };

  const queries: Record<string, Record<string, unknown>> = {};

  for (const [kind, term] of Object.entries(SEARCH_TERMS)) {
    const actionMs: number[] = [];
    const resultCounts: number[] = [];
    const databaseMs: number[] = [];
    const databaseStatementMs: Record<string, number[]> = {};
    const plans: unknown[] = [];
    benchmarkState.captureSearchQuery = true;

    for (let repetition = 0; repetition < WARMUP_REPETITIONS + MEASURED_REPETITIONS; repetition += 1) {
      benchmarkState.capturedSearchQueries = [];
      const measured = await time(() => searchProjectListIds(term));
      if (benchmarkState.capturedSearchQueries.length === 0) throw new Error('Could not capture the actual project search SQL at the transaction raw-query boundary.');
      if (repetition >= WARMUP_REPETITIONS) {
        actionMs.push(measured.milliseconds);
        resultCounts.push(measured.result.length);
      }
    }

    const actualQueries = benchmarkState.capturedSearchQueries;
    if (actualQueries.length === 0) throw new Error('Could not capture the actual project search SQL from the transaction raw-query boundary.');
    const statements = actualQueries.map((query, index) => ({
      label: query.sql.includes('has_exclusion') ? 'candidateLookup'
        : query.sql.includes('searchable_with_vector') ? 'projectedMatch'
          : 'baselineSearch',
      index,
      ...query,
    }));
    for (const statement of statements) {
      const explain = await benchmarkState.trx.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, statement.bindings);
      plans.push({ statement: statement.label, queryIndex: statement.index, plan: explain.rows[0]['QUERY PLAN'] });
      databaseStatementMs[`${statement.label}_${statement.index}`] = [];
    }
    for (let repetition = 0; repetition < MEASURED_REPETITIONS; repetition += 1) {
      let combinedDatabaseMs = 0;
      for (const statement of statements) {
        const databaseRun = await time(() => benchmarkState.trx.raw(statement.sql, statement.bindings));
        databaseStatementMs[`${statement.label}_${statement.index}`].push(databaseRun.milliseconds);
        combinedDatabaseMs += databaseRun.milliseconds;
      }
      databaseMs.push(combinedDatabaseMs);
    }
    queries[kind] = {
      actionMs,
      databaseMs,
      databaseStatementMs,
      plans,
      resultCounts,
      actionMedianMs: median(actionMs),
      databaseMedianMs: median(databaseMs),
      returnedProjectCount: resultCounts.at(-1),
    };
  }
  benchmarkState.captureSearchQuery = false;

  const [pg, settings, indexStats, tenantCounts, indexDefinitions] = await Promise.all([
    benchmarkState.trx.raw('SELECT version() AS version'),
    benchmarkState.trx.raw("SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'work_mem', 'effective_cache_size', 'random_page_cost', 'default_text_search_config') ORDER BY name"),
    benchmarkState.trx.raw("SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE relname = 'app_search_index' ORDER BY indexrelname"),
    benchmarkState.trx.raw('SELECT object_type, count(*)::int AS count FROM app_search_index WHERE tenant = ? GROUP BY object_type ORDER BY object_type', [tenant]),
    benchmarkState.trx.raw("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'app_search_index' ORDER BY indexname"),
  ]);
  const result = {
    schemaVersion: 1,
    revision,
    benchmark: { projects: PROJECT_COUNT, indexEntriesPerProject: INDEX_ENTRIES_PER_PROJECT, totalIndexRows: PROJECT_COUNT * INDEX_ENTRIES_PER_PROJECT },
    tenant,
    authorization: {
      evaluation: 'createProjectReadAuthorizer + real kernel + builtin provider + database-backed bundle provider',
      policy: {
        resource: 'project', action: 'read', template: 'selected_clients', allowedClientId, deniedClientId,
        redactedFields: ['projects.description', 'project_tasks.description'],
        bundleId: activeBundle.bundleId, revisionId: activeBundle.revisionId,
      },
      projectDecisionCounts: decisionCounts,
      separateSweepMs: authorizationSweepMs,
      separateSweepMedianMs: median(authorizationSweepMs),
      fullTenantSweepIsDiagnosticOnly: true,
    },
    warmCache: { actionWarmupsPerTerm: WARMUP_REPETITIONS, measuredActionRepetitionsPerTerm: MEASURED_REPETITIONS, databaseCache: 'PostgreSQL shared buffers and host page cache warmed by the warmup action; no restart between repetitions' },
    searches: queries,
    postgres: { version: pg.rows[0].version, settings: settings.rows, indexes: indexDefinitions.rows, indexStats: indexStats.rows },
    indexRowsByType: tenantCounts.rows,
  };

  const output = resolve(process.env.PROJECT_SEARCH_BENCHMARK_OUTPUT || 'docs/evidence/project-search-performance-2026-11-23/benchmark.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

describe('project list search performance benchmark (isolated disposable PostgreSQL)', () => {
  beforeAll(async () => {
    assertIsDisposableBenchmarkDatabase();
    knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 16 } });
    tenant = await createInventoryTestTenant(knex);
    userId = (await knex('users').where({ tenant }).first()).user_id;
    statusId = (await knex('statuses').where({ tenant }).first()).status_id;
    allowedClientId = (await knex('clients').where({ tenant }).first()).client_id;
  });

  afterAll(async () => { await knex?.destroy(); });

  beforeEach(async () => {
    benchmarkState.trx = await knex.transaction();
    benchmarkState.tenant = tenant;
    benchmarkState.user = { user_id: userId, user_type: 'internal', roles: [] };
    benchmarkState.captureSearchQuery = false;
    benchmarkState.capturedSearchQueries = [];
    deniedClientId = randomUUID();
    await benchmarkState.trx('clients').insert({
      tenant, client_id: deniedClientId, client_name: 'Search benchmark denied client',
      billing_cycle: 'monthly', billing_email: `search-benchmark-${deniedClientId}@example.invalid`,
    });
    await seedSearchCorpus();
    activeBundle = await prepareRealAuthorizationPolicy();
  });

  afterEach(async () => {
    if (benchmarkState.trx) await benchmarkState.trx.rollback();
    benchmarkState.trx = null;
  });

  it('records authorization, SQL, and total action timings plus real plans for common, rare, and no-match searches', async () => {
    const result = await runBenchmark();
    expect(result.authorization).toMatchObject({
      projectDecisionCounts: {
        allowed: PROJECT_COUNT / 2,
        denied: PROJECT_COUNT / 2,
        redactedAllowed: PROJECT_COUNT / 2,
        redactedDenied: PROJECT_COUNT / 2,
      },
    });
    expect(result.searches).toHaveProperty('common');
    expect(result.searches).toHaveProperty('rare');
    expect(result.searches).toHaveProperty('noMatch');
  }, 20 * 60 * 1000);
});
