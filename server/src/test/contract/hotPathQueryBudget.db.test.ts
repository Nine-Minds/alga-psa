/**
 * Hot-path query-count budget (CM L0g, plan section 5).
 *
 * Runs the canonical 16-step psa scenario (hotPathScenario.ts) three times
 * in-process and compares per-step statement and lock counts against the
 * committed snapshot hotPathQueryBudget.json.
 *
 *   plain run                         verify against the snapshot
 *   HOT_PATH_BUDGET_RECORD=1 run      rewrite the snapshot, only if the three
 *                                     runs agree with each other (never on
 *                                     UNSTABLE)
 *
 * Serial-safe with the repo's singleFork vitest config: the test owns one
 * connection to its own database and the scenario state is module-level but
 * only ever touched from this file's single describe block.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  NEW_TABLE_DENYLIST,
  SCENARIO_EDGE,
  SCENARIO_ID,
  STEP_NAMES,
  describeStatement,
  matchesDenylist,
  runHotPathScenarioOnce,
  type ScenarioResult,
} from './hotPathScenario';

// ---------------------------------------------------------------------------
// Seams. `vi.mock` hoists per file, so the factories live here and reach the
// scenario's shared handle through a lazy import (see hotPathScenario.ts).
// Every database connection the product asks for is the scenario's outer
// transaction; only network/queue/object-store edges are stubbed.
// ---------------------------------------------------------------------------

// server/src/test/setup.ts replaces the @alga-psa/auth barrel with a stub for
// every suite; this one needs the real withAuth / RBAC.
vi.unmock('@alga-psa/auth');

const runtime = async () => (await import('./hotPathScenario')).scenarioRuntime;

vi.mock('@alga-psa/db/tenant', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db/tenant')>('@alga-psa/db/tenant');
  const connection = async () => {
    const rt = await runtime();
    if (!rt.db) throw new Error('hot-path scenario: no active transaction');
    return rt.db;
  };
  return {
    ...actual,
    getConnection: vi.fn(connection),
    createTenantKnex: vi.fn(async (tenantId?: string | null) => {
      const rt = await runtime();
      return { knex: await connection(), tenant: tenantId ?? actual.getTenantContext() ?? rt.tenant };
    }),
    withTransaction: vi.fn(async (target: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) => {
      const knexOrTrx = typeof target === 'string' ? await connection() : target;
      return (actual.withTransaction as any)(knexOrTrx, callback);
    }),
  };
});

vi.mock('@alga-psa/db/admin', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db/admin')>('@alga-psa/db/admin');
  return {
    ...actual,
    getAdminConnection: vi.fn(async () => {
      const rt = await runtime();
      if (!rt.db) throw new Error('hot-path scenario: no active transaction');
      return rt.db;
    }),
  };
});

// The cookie -> session decode. Everything after it in withAuth (durable
// session check, user + roles load) is real.
vi.mock('../../../../packages/auth/src/nextauth/auth', async () => ({
  auth: vi.fn(async () => {
    const rt = await runtime();
    const s = rt.session;
    if (!s) return null;
    return {
      // product_code mirrors the real session callback (default 'psa'); getCurrentUser hands it to write admission.
      user: { id: s.userId, tenant: s.tenant, user_type: s.userType, email: s.email, product_code: 'psa' },
      session_id: s.sessionId,
      expires: new Date(Date.UTC(2100, 0, 1)).toISOString(),
    };
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// pg-boss one-shot scheduling needs a queue; the product code around it is real.
vi.mock('@alga-psa/core', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/core')>('@alga-psa/core');
  return {
    ...actual,
    scheduleJobAt: vi.fn(async () => 'hot-path-scheduled-job'),
    cancelScheduledJob: vi.fn(async () => true),
  };
});

const HOOK_TIMEOUT = 600_000;
const RUNS = 3;
const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hotPathQueryBudget.json');

interface Snapshot {
  schemaVersion: 1;
  scenario: string;
  edge: string;
  steps: Array<{ name: string; statements: number; locks: number }>;
  totals: { statements: number; locks: number };
  denylist: string[];
  notes: string;
}

function readSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
}

/** Returns an UNSTABLE message naming the first unstable step, or null. */
function findInstability(runs: ScenarioResult[]): string | null {
  for (let i = 0; i < runs[0].steps.length; i++) {
    const name = runs[0].steps[i].name;
    const statements = runs.map((r) => r.steps[i]?.statements);
    const locks = runs.map((r) => r.steps[i]?.locks);
    if (new Set(statements).size > 1 || new Set(locks).size > 1) {
      return (
        `UNSTABLE: step ${name} is not deterministic across ${runs.length} in-process runs ` +
        `(statements ${statements.join('/')}, locks ${locks.join('/')}). ` +
        'A budget is meaningless for a non-deterministic step; fix the nondeterminism (no snapshot was written).'
      );
    }
  }
  return null;
}

describe('hot-path query budget', () => {
  let connection: Knex;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    connection = await createTestDbConnection();
    // Production config: server/src/instrumentation.ts always installs the co-managed resolver.
    const { installCoManagedWriteAdmission } = await import('@alga-psa/licensing/co-managed-write-admission');
    installCoManagedWriteAdmission();
    // Chapter 0: control only the rollout input; eligibility remains false.
    // No PostHog request or capability SQL is included in the measured native writes.
    const rollout = process.env.CM_L0C_REVIEW_ROLLOUT;
    if (rollout) {
      const { registerFeatureFlagChecker } = await import('@alga-psa/core');
      const { registerCapabilityEligibility, evaluateCapability } = await import('@alga-psa/core/capability');
      registerFeatureFlagChecker(async (flagKey) => flagKey === 'release-v2-0-feature' && rollout === 'on');
      registerCapabilityEligibility('co-managed', async () => false);
      const decision = await evaluateCapability('co-managed', 'budget-plain-psa');
      expect(decision.admitted).toBe(false);
      expect(decision.reasons.admitted).toBe(rollout === 'on' ? 'not-eligible' : 'flag-off');
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await connection?.destroy();
  });

  it(
    'matches the committed per-step statement and lock budget',
    async () => {
      // Discarded warm-up run: first execution fills process-level caches
      // (module-level memoisation, lazily loaded modules) that later runs hit.
      // Without it run 1 legitimately differs from runs 2..n. It is not
      // measured or compared; the three runs below are the stability evidence.
      await runHotPathScenarioOnce(connection);

      const runs: ScenarioResult[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await runHotPathScenarioOnce(connection));

      const unstable = findInstability(runs);
      if (unstable) throw new Error(unstable);

      const measured = runs[0];
      expect(measured.steps.map((s) => s.name)).toEqual([...STEP_NAMES]);

      // The new-table denylist applies to what the scenario actually touched.
      const touched = new Set(runs.flatMap((r) => r.steps.flatMap((s) => s.tables)));
      const offenders = [...touched].filter((t) => matchesDenylist(t));
      expect(offenders, `denylisted tables touched by the hot path: ${offenders.join(', ')}`).toEqual([]);

      if (process.env.HOT_PATH_BUDGET_RECORD === '1') {
        const snapshot: Snapshot = {
          schemaVersion: 1,
          scenario: SCENARIO_ID,
          edge: SCENARIO_EDGE,
          steps: measured.steps.map(({ name, statements, locks }) => ({ name, statements, locks })),
          totals: measured.totals,
          denylist: NEW_TABLE_DENYLIST.map((r) => r.source),
          notes: 'raising a number requires this file in the PR diff',
        };
        fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
        return;
      }

      const snapshot = readSnapshot();
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.scenario).toBe(SCENARIO_ID);
      expect(snapshot.edge).toBe(SCENARIO_EDGE);
      expect(snapshot.denylist).toEqual(NEW_TABLE_DENYLIST.map((r) => r.source));
      expect(
        snapshot.steps.map((s) => s.name),
        'snapshot step set/order differs from the scenario; re-record with HOT_PATH_BUDGET_RECORD=1',
      ).toEqual(measured.steps.map((s) => s.name));

      const problems: string[] = [];
      for (const [i, step] of measured.steps.entries()) {
        const budget = snapshot.steps[i];
        for (const metric of ['statements', 'locks'] as const) {
          if (step[metric] > budget[metric]) {
            problems.push(
              `BUDGET EXCEEDED: step ${step.name} ${metric} ${step[metric]} > budget ${budget[metric]}. ` +
                'If the increase is intended, re-record with HOT_PATH_BUDGET_RECORD=1 and include ' +
                'server/src/test/contract/hotPathQueryBudget.json in this PR diff.',
            );
          } else if (step[metric] < budget[metric]) {
            problems.push(
              `BUDGET IMPROVED: step ${step.name} ${metric} ${step[metric]} < budget ${budget[metric]}. ` +
                'Re-record with HOT_PATH_BUDGET_RECORD=1 and commit hotPathQueryBudget.json so the budget ratchets down.',
            );
          }
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    },
    HOOK_TIMEOUT,
  );

  it('normalises statements: parameterised text only, verb, first table, lock', () => {
    const s = describeStatement('select  *\n from "tickets" t join users u on u.a = $1 where t.tenant = $2 for update');
    expect(s).toMatchObject({ verb: 'select', table: 'tickets', lock: true });
    expect(s?.sql).toBe('select * from "tickets" t join users u on u.a = ? where t.tenant = ? for update');
    expect(s?.tables).toEqual(['tickets', 'users']);
    expect(describeStatement('insert into public.comments (a) values ($1)')).toMatchObject({ verb: 'insert', table: 'comments', lock: false });
    for (const ignored of ['BEGIN;', 'commit', 'ROLLBACK', 'SAVEPOINT trx2;', 'RELEASE SAVEPOINT trx2;']) {
      expect(describeStatement(ignored)).toBeNull();
    }
  });
});
