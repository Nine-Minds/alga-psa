const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadHarnessWithStubs(stubs) {
  const harnessRoot = path.resolve(__dirname, '..');
  const runPath = path.join(harnessRoot, 'run.cjs');

  const depPaths = {
    db: path.join(harnessRoot, 'lib', 'db.cjs'),
    http: path.join(harnessRoot, 'lib', 'http.cjs'),
    workflow: path.join(harnessRoot, 'lib', 'workflow.cjs'),
    runs: path.join(harnessRoot, 'lib', 'runs.cjs'),
  };

  const saved = {};
  for (const [key, p] of Object.entries(depPaths)) {
    saved[p] = require.cache[p];
    if (stubs[key]) {
      require.cache[p] = { id: p, filename: p, loaded: true, exports: stubs[key] };
    }
  }

  delete require.cache[runPath];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(runPath);

  return {
    mod,
    restore() {
      delete require.cache[runPath];
      for (const p of Object.values(depPaths)) {
        if (saved[p]) require.cache[p] = saved[p];
        else delete require.cache[p];
      }
    }
  };
}

function readPlanTests() {
  const planTestsPath = path.resolve(
    process.cwd(),
    'ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/tests.json'
  );
  return JSON.parse(fs.readFileSync(planTestsPath, 'utf8'));
}

function isScaffoldedFixtureDir(fixtureDir) {
  return fs.existsSync(path.join(fixtureDir, '.scaffolded'));
}

// These are fixture/harness unit tests. The workflow engine and database are
// stubbed at their external boundaries; production workflow execution belongs
// in the real-service integration lane. The catalog was upgraded from event-only
// scaffolds to fixtures that validate persisted notification outcomes.
const patterns = {
  idempotent: ['ticket-created-assign-idempotent', 'ticket-created-notify-idempotent', 'project-created-tasks-idempotent'],
  forEach: ['ticket-created-notify-foreach-concurrency', 'ticket-created-foreach-onitemerror-continue', 'ticket-created-rule-eval-foreach-firstmatch', 'ticket-created-foreach-heavy'],
  multiBranch: ['ticket-created-multi-branch-routing', 'project-status-multi-branch', 'invoice-status-multi-branch'],
  tryCatch: ['project-updated-email-trycatch', 'project-task-status-email-trycatch', 'payment-failed-email-trycatch'],
};
const catalog = readPlanTests().filter((item) => item.fixture && item.eventType
  && isScaffoldedFixtureDir(path.resolve(process.cwd(), 'ee/test-data/workflow-harness', item.fixture)));
assert.ok(catalog.length > 0, 'workflow fixture catalog must not be empty');

async function runCatalogFixture(item, t, fault) {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness', item.fixture);
  const bundlePath = path.join(fixtureDir, 'bundle.json');
  const testPath = path.join(fixtureDir, 'test.cjs');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const schemaRef = bundle.workflows[0].metadata.payloadSchemaRef;
  assert.ok(typeof schemaRef === 'string' && schemaRef.length > 0);
  const pattern = Object.keys(patterns).find((key) => patterns[key].includes(item.fixture)) ?? 'default';
  const child = bundle.workflows.find((workflow) => workflow.key === `subfixture.${item.fixture}`);
  const createdWorkflows = bundle.workflows.map((workflow, index) => ({ key: workflow.key, workflowId: `wf-${item.id}-${index}` }));
  const parentId = createdWorkflows[0].workflowId;
  const childId = child && createdWorkflows.find((workflow) => workflow.key === child.key).workflowId;
  const requests = [];
  let notifications = [];
  let cleanupCount = 0;
  let waitCount = 0;
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-catalog-'));
  t.after(() => fs.rmSync(artifactsDir, { recursive: true, force: true }));
  const harness = loadHarnessWithStubs({
    http: {
      createHttpClient: () => ({
        request: async (requestPath, opts) => {
          requests.push({ path: requestPath, opts });
          if (requestPath === `/api/workflow-definitions/${parentId}/export`) {
            return { json: { workflows: [{ draft: { definition: structuredClone(bundle.workflows[0].draft.definition) } }] } };
          }
          if (requestPath !== '/api/workflow/events') return { json: {} };
          const { payload, correlationKey } = opts.json;
          assert.equal(payload.fixtureNotifyUserId, 'fixture-user');
          assert.equal(payload.fixtureDedupeKey, correlationKey);
          if (fault === 'missing-notification') return { json: {} };
          if (!notifications.some((row) => row.message === correlationKey)) {
            const suffix = pattern === 'tryCatch' ? ' Fallback' : pattern === 'multiBranch' ? ` Branch ${payload.fixtureVariant}` : '';
            notifications.push({ title: `[fixture ${item.fixture}]${suffix}`, message: fault === 'wrong-correlation' ? 'another-run' : correlationKey });
            if (pattern === 'forEach') notifications.push({ title: `[fixture ${item.fixture}] second`, message: correlationKey });
            if (child) notifications.push({ title: `[fixture ${item.fixture} child]`, message: correlationKey });
          }
          return { json: {} };
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text, params) => {
          const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.startsWith('update workflow_definitions set is_paused = $3')) {
            assert.match(sql, /where workflow_id = \$1 and tenant = \$2/);
            assert.deepEqual(params, [parentId, 'fixture-tenant', bundle.workflows[0].metadata.isPaused]);
            return [];
          }
          assert.match(sql, /tenant = \$1/);
          assert.equal(params[0], 'fixture-tenant');
          if (sql.startsWith('update workflow_definitions set is_paused')) {
            assert.equal(params[1], bundle.workflows[0].key);
            return [];
          }
          if (sql.startsWith('delete from internal_notifications')) {
            assert.equal(params[1], 'fixture-user');
            assert.ok(params[2].includes(`[fixture ${item.fixture}`));
            const marker = params[2].slice(1, -1);
            const key = params[3].slice(1, -1);
            notifications = notifications.filter((row) => !(row.title.includes(marker) && row.message.includes(key)));
            cleanupCount++;
            return [];
          }
          if (sql.includes('from users')) return [{ user_id: 'fixture-user' }];
          if (sql.includes('from workflow_definition_versions')) return [{ max_version: 2 }];
          if (sql.includes('from internal_notifications')) {
            assert.equal(params[1], 'fixture-user');
            return notifications;
          }
          throw new Error(`Unexpected fixture query: ${sql}`);
        },
        close: async () => {},
      }),
    },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows }),
      exportWorkflowBundleV1: async () => ({}),
    },
    runs: {
      waitForRun: async () => ({ run_id: `run-${item.id}-${++waitCount}`, status: fault === 'failed-run' ? 'FAILED' : 'SUCCEEDED' }),
      getRunSteps: async () => [],
      getRunLogs: async () => [],
      summarizeSteps: () => ({ counts: {}, failed: [] }),
    },
  });
  let runError;
  try {
    await harness.mod.runFixture({
      testDir: fixtureDir, bundlePath, testPath,
      baseUrl: 'http://localhost:3010', tenantId: 'fixture-tenant', cookie: 'fixture-cookie',
      force: true, timeoutMs: 1000, debug: false, artifactsDir, pgUrl: 'postgres://unused',
    });
  } catch (error) {
    runError = error;
  } finally {
    harness.restore();
  }
  if (runError && !fault) throw runError;
  assert.ok(cleanupCount > 0, 'fixture must run cleanup, including on failure');
  if (runError) throw runError;
  const events = requests.filter((request) => request.path === '/api/workflow/events');
  assert.equal(events.length, ['idempotent', 'multiBranch'].includes(pattern) ? 2 : 1);
  assert.equal(waitCount, events.length, 'every emitted event must reach an observed run outcome');
  for (const { opts } of events) {
    assert.equal(opts.method, 'POST');
    assert.equal(opts.json.eventName, item.eventType);
    assert.equal(opts.json.payloadSchemaRef, schemaRef);
    assert.ok(opts.json.correlationKey.length > 0);
  }
  if (pattern === 'idempotent') assert.equal(events[0].opts.json.correlationKey, events[1].opts.json.correlationKey);
  if (pattern === 'multiBranch') assert.deepEqual(events.map(({ opts }) => opts.json.payload.fixtureVariant), ['A', 'B']);
  if (child) {
    const patch = requests.find((request) => request.path === `/api/workflow-definitions/${parentId}/1`);
    const call = patch.opts.json.definition.steps.find((step) => step.type === 'control.callWorkflow');
    assert.equal(call.workflowId, childId);
    assert.equal(call.workflowVersion, 3);
    assert.ok(requests.some((request) => request.path === `/api/workflow-definitions/${childId}/3/publish`));
    assert.ok(requests.some((request) => request.path === `/api/workflow-definitions/${parentId}/3/publish`));
  }
  assert.deepEqual(notifications, [], 'created notifications must be cleaned up');
}

for (const item of catalog) {
  test(`${item.id}: fixture ${item.fixture} executes and validates outcomes via harness`, (t) => runCatalogFixture(item, t));
}
for (const [fault, message] of [
  ['failed-run', /Expected run SUCCEEDED, got FAILED/],
  ['missing-notification', /Expected an internal notification/],
  ['wrong-correlation', /Expected an internal notification/],
]) {
  test(`catalog fixture rejects ${fault} even when event publication succeeds`, async (t) => {
    await assert.rejects(runCatalogFixture(catalog[0], t, fault), message);
  });
}
