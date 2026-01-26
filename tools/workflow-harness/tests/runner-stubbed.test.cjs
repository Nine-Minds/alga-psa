const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function writeFixture({ name, bundle, testSource }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `workflow-harness-${name}-`));
  fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'test.cjs'), testSource, 'utf8');
  return {
    dir,
    bundlePath: path.join(dir, 'bundle.json'),
    testPath: path.join(dir, 'test.cjs')
  };
}

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

test('T004: imports bundle with --force and reports workflow id/key used', async () => {
  const importCalls = [];
  const { dir, bundlePath, testPath } = writeFixture({
    name: 't004',
    bundle: {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [{ key: 'fixture.t004', metadata: {}, dependencies: { actions: [], nodeTypes: [], schemaRefs: [] }, draft: { draftVersion: 1, definition: {} }, publishedVersions: [] }]
    },
    testSource: `
      module.exports = async (ctx) => {
        ctx.expect.equal(ctx.workflow.key, 'fixture.t004', 'workflow key');
        ctx.expect.equal(ctx.workflow.id, 'wf-123', 'workflow id');
      };
    `
  });

  const harness = loadHarnessWithStubs({
    http: { createHttpClient: () => ({ request: async () => ({ json: {} }) }) },
    db: { createDbClient: async () => ({ query: async () => [], close: async () => {} }) },
    workflow: {
      importWorkflowBundleV1: async ({ force }) => {
        importCalls.push({ force });
        return { createdWorkflows: [{ key: 'fixture.t004', workflowId: 'wf-123' }] };
      },
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => {
        throw new Error('waitForRun should not be called for this test');
      },
      getRunSteps: async () => [],
      getRunLogs: async () => [],
      summarizeSteps: () => ({ counts: {}, failed: [] })
    }
  });

  try {
    const { runFixture } = harness.mod;
    const res = await runFixture({
      testDir: dir,
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
    assert.equal(res.state.workflowId, 'wf-123');
    assert.equal(res.state.workflowKey, 'fixture.t004');
    assert.deepEqual(importCalls, [{ force: true }]);
  } finally {
    harness.restore();
  }
});

test('T005: surfaces thrown error as FAIL and writes stack trace artifacts', async () => {
  const { dir, bundlePath, testPath } = writeFixture({
    name: 't005',
    bundle: {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [{ key: 'fixture.t005', metadata: {}, dependencies: { actions: [], nodeTypes: [], schemaRefs: [] }, draft: { draftVersion: 1, definition: {} }, publishedVersions: [] }]
    },
    testSource: `
      module.exports = async () => {
        throw new Error('boom');
      };
    `
});

test('T006: waitForRun timeout produces helpful diagnostic in artifacts', async () => {
  const { dir, bundlePath, testPath } = writeFixture({
    name: 't006',
    bundle: {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [{ key: 'fixture.t006', metadata: {}, dependencies: { actions: [], nodeTypes: [], schemaRefs: [] }, draft: { draftVersion: 1, definition: {} }, publishedVersions: [] }]
    },
    testSource: `
      module.exports = async (ctx) => {
        await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt, timeoutMs: 5 });
      };
    `
  });

  const timeoutError = new Error('Timed out waiting for workflow run');
  timeoutError.details = { lastSeen: null, recentRuns: [] };

  const harness = loadHarnessWithStubs({
    http: { createHttpClient: () => ({ request: async () => ({ json: {} }) }) },
    db: { createDbClient: async () => ({ query: async () => [], close: async () => {} }) },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.t006', workflowId: 'wf-006' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => {
        throw timeoutError;
      },
      getRunSteps: async () => [],
      getRunLogs: async () => [],
      summarizeSteps: () => ({ counts: {}, failed: [] })
    }
  });

  try {
    const { runFixture } = harness.mod;
    await assert.rejects(
      () =>
        runFixture({
          testDir: dir,
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
        }),
      (err) => {
        assert.ok(err.artifactsDir, 'expected err.artifactsDir to be set');
        const ctxPath = path.join(err.artifactsDir, 'failure.context.json');
        const parsed = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
        assert.equal(parsed.error.message, 'Timed out waiting for workflow run');
        assert.deepEqual(parsed.error.details, { lastSeen: null, recentRuns: [] });
        return true;
      }
    );
  } finally {
    harness.restore();
  }
});

test('T007: captures run and step status summary on success', async () => {
  const { dir, bundlePath, testPath } = writeFixture({
    name: 't007',
    bundle: {
      format: 'alga-psa.workflow-bundle',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      workflows: [{ key: 'fixture.t007', metadata: {}, dependencies: { actions: [], nodeTypes: [], schemaRefs: [] }, draft: { draftVersion: 1, definition: {} }, publishedVersions: [] }]
    },
    testSource: `
      module.exports = async (ctx) => {
        const run = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt, timeoutMs: 5 });
        ctx.expect.equal(run.status, 'SUCCEEDED', 'run status');
      };
    `
  });

  const steps = [
    { step_id: 's1', run_id: 'run-007', step_path: '/0', definition_step_id: 'a', status: 'SUCCEEDED', attempt: 1 }
  ];

  const harness = loadHarnessWithStubs({
    http: { createHttpClient: () => ({ request: async () => ({ json: {} }) }) },
    db: { createDbClient: async () => ({ query: async () => [], close: async () => {} }) },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.t007', workflowId: 'wf-007' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-007', status: 'SUCCEEDED' }),
      getRunSteps: async () => steps,
      getRunLogs: async () => [],
      summarizeSteps: (s) => ({ counts: { SUCCEEDED: s.length }, failed: [] })
    }
  });

  try {
    const { runFixture } = harness.mod;
    const res = await runFixture({
      testDir: dir,
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
    assert.deepEqual(res.state.run, { run_id: 'run-007', status: 'SUCCEEDED' });
    assert.deepEqual(res.state.steps, steps);
  } finally {
    harness.restore();
  }
});

  const harness = loadHarnessWithStubs({
    http: { createHttpClient: () => ({ request: async () => ({ json: {} }) }) },
    db: { createDbClient: async () => ({ query: async () => [], close: async () => {} }) },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.t005', workflowId: 'wf-005' }] }),
      exportWorkflowBundleV1: async () => ({ exported: true })
    },
    runs: {
      waitForRun: async () => {
        throw new Error('waitForRun should not be called for this test');
      },
      getRunSteps: async () => [],
      getRunLogs: async () => [],
      summarizeSteps: () => ({ counts: {}, failed: [] })
    }
  });

  try {
    const { runFixture } = harness.mod;
    await assert.rejects(
      () =>
        runFixture({
          testDir: dir,
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
        }),
      (err) => {
        assert.match(String(err.message), /boom/);
        assert.ok(err.artifactsDir, 'expected err.artifactsDir to be set');
        const ctxPath = path.join(err.artifactsDir, 'failure.context.json');
        const errPath = path.join(err.artifactsDir, 'failure.error.txt');
        assert.ok(fs.existsSync(ctxPath), 'expected failure.context.json');
        assert.ok(fs.existsSync(errPath), 'expected failure.error.txt');
        assert.match(fs.readFileSync(errPath, 'utf8'), /boom/);
        return true;
      }
    );
  } finally {
    harness.restore();
  }
});
