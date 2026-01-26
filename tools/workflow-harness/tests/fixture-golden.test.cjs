const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

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

test('T020: ticket-created-hello fixture loads and executes via harness', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness/ticket-created-hello');
  const bundlePath = path.join(fixtureDir, 'bundle.json');
  const testPath = path.join(fixtureDir, 'test.cjs');

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
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.ticket-created-hello', workflowId: 'wf-020' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-020', status: 'SUCCEEDED' }),
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

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/workflow/events');
  assert.equal(requests[0].opts.method, 'POST');
  assert.equal(requests[0].opts.json.eventName, 'TICKET_CREATED');
  assert.equal(requests[0].opts.json.payloadSchemaRef, 'payload.TicketCreated.v1');
});

test('T100: ticket-created-triage-comment fixture loads and executes via harness', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness/ticket-created-triage-comment');
  const bundlePath = path.join(fixtureDir, 'bundle.json');
  const testPath = path.join(fixtureDir, 'test.cjs');

  const savedApiKey = process.env.WORKFLOW_HARNESS_API_KEY;
  process.env.WORKFLOW_HARNESS_API_KEY = 'api-key';

  const requests = [];
  const harness = loadHarnessWithStubs({
    http: {
      createHttpClient: () => ({
        request: async (p, opts) => {
          requests.push({ path: p, opts });
          if (p === '/api/v1/tickets' && opts?.method === 'POST') {
            return { json: { data: { ticket_id: 'ticket-100' } } };
          }
          return { json: { data: {} } };
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text) => {
          const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.includes('from clients')) return [{ client_id: 'client-100' }];
          if (sql.includes('from boards')) return [{ board_id: 'board-100' }];
          if (sql.includes('from statuses')) return [{ status_id: 'status-100' }];
          if (sql.includes('from priorities')) return [{ priority_id: 'priority-100' }];
          if (sql.includes('from comments')) {
            return [
              {
                comment_id: 'comment-100',
                note: '[fixture ticket-created-triage-comment] ticketId=ticket-100',
                is_internal: true,
                metadata: null
              }
            ];
          }
          return [];
        },
        close: async () => {}
      })
    },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.ticket-created-triage-comment', workflowId: 'wf-100' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-100', status: 'SUCCEEDED' }),
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
    if (savedApiKey === undefined) delete process.env.WORKFLOW_HARNESS_API_KEY;
    else process.env.WORKFLOW_HARNESS_API_KEY = savedApiKey;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/api/v1/tickets');
  assert.equal(requests[0].opts.method, 'POST');
  assert.equal(requests[0].opts.headers['x-api-key'], 'api-key');
  assert.equal(requests[1].path, '/api/v1/tickets/ticket-100');
  assert.equal(requests[1].opts.method, 'DELETE');
  assert.equal(requests[1].opts.headers['x-api-key'], 'api-key');
});
