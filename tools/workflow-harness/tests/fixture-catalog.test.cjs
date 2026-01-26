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

for (const item of readPlanTests()) {
  if (!item.fixture || !item.eventType) continue;

  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness', item.fixture);
  if (!isScaffoldedFixtureDir(fixtureDir)) continue;

  test(`${item.id}: scaffolded fixture ${item.fixture} executes via harness`, async () => {
    const bundlePath = path.join(fixtureDir, 'bundle.json');
    const testPath = path.join(fixtureDir, 'test.cjs');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

    const expectedEventName = item.eventType;
    const expectedSchemaRef = bundle.workflows?.[0]?.metadata?.payloadSchemaRef;
    assert.ok(typeof expectedSchemaRef === 'string' && expectedSchemaRef.length > 0, 'expected payloadSchemaRef');

    const requests = [];
    const harness = loadHarnessWithStubs({
      http: {
        createHttpClient: () => ({
          request: async (p, opts) => {
            requests.push({ path: p, opts });
            return { json: {} };
          }
        })
      },
      db: { createDbClient: async () => ({ query: async () => [], close: async () => {} }) },
      workflow: {
        importWorkflowBundleV1: async () => ({
          createdWorkflows: [{ key: `fixture.${item.fixture}`, workflowId: `wf-${item.id}` }]
        }),
        exportWorkflowBundleV1: async () => ({})
      },
      runs: {
        waitForRun: async () => ({ run_id: `run-${item.id}`, status: 'SUCCEEDED' }),
        getRunSteps: async () => [],
        getRunLogs: async () => [],
        summarizeSteps: () => ({ counts: {}, failed: [] })
      }
    });

    try {
      const { runFixture } = harness.mod;
      await runFixture({
        testDir: fixtureDir,
        bundlePath,
        testPath,
        baseUrl: 'http://localhost:3010',
        tenantId: 'tenant',
        cookie: 'cookie',
        force: true,
        timeoutMs: 1000,
        debug: false,
        artifactsDir: os.tmpdir(),
        pgUrl: 'postgres://unused'
      });
    } finally {
      harness.restore();
    }

    assert.equal(requests.length, 1, 'expected exactly one request');
    assert.equal(requests[0].path, '/api/workflow/events');
    assert.equal(requests[0].opts.method, 'POST');
    assert.equal(requests[0].opts.json.eventName, expectedEventName);
    assert.equal(requests[0].opts.json.payloadSchemaRef, expectedSchemaRef);
    assert.equal(typeof requests[0].opts.json.correlationKey, 'string');
    assert.ok(requests[0].opts.json.correlationKey.length > 0);
    assert.equal(requests[0].opts.json.payload.fixtureName, item.fixture);
  });
}

