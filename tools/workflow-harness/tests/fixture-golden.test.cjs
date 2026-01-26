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

test('T101: ticket-created-auto-assign-by-priority fixture loads and executes via harness', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness/ticket-created-auto-assign-by-priority');
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
            return { json: { data: { ticket_id: 'ticket-101' } } };
          }
          return { json: { data: {} } };
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text) => {
          const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.includes('from clients')) return [{ client_id: 'client-101' }];
          if (sql.includes('from boards')) return [{ board_id: 'board-101' }];
          if (sql.includes('from statuses')) return [{ status_id: 'status-101' }];
          if (sql.includes('from priorities')) return [{ priority_id: 'priority-101' }];
          if (sql.includes('from users')) return [{ user_id: 'user-101' }];
          if (sql.includes('select assigned_to from tickets')) return [{ assigned_to: 'user-101' }];
          if (sql.includes('from comments')) {
            return [
              {
                comment_id: 'comment-101',
                note: '[fixture ticket-created-auto-assign-by-priority] assigned_to=user-101',
                is_internal: true
              }
            ];
          }
          return [];
        },
        close: async () => {}
      })
    },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.ticket-created-auto-assign-by-priority', workflowId: 'wf-101' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-101', status: 'SUCCEEDED' }),
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
  assert.equal(requests[0].opts.json.attributes.fixture_priority, 'high');
  assert.equal(requests[0].opts.json.attributes.fixture_assignee_user_id, 'user-101');
  assert.equal(requests[1].path, '/api/v1/tickets/ticket-101');
  assert.equal(requests[1].opts.method, 'DELETE');
  assert.equal(requests[1].opts.headers['x-api-key'], 'api-key');
});

test('T102: ticket-created-vip-notify fixture loads and executes via harness', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness/ticket-created-vip-notify');
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
            return { json: { data: { ticket_id: 'ticket-102' } } };
          }
          return { json: { data: {} } };
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text) => {
          const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.includes('from clients')) return [{ client_id: 'client-102' }];
          if (sql.includes('from boards')) return [{ board_id: 'board-102' }];
          if (sql.includes('from statuses')) return [{ status_id: 'status-102' }];
          if (sql.includes('from priorities')) return [{ priority_id: 'priority-102' }];
          if (sql.includes('from users')) return [{ user_id: 'user-102' }];
          if (sql.includes('from internal_notifications')) {
            return [
              {
                internal_notification_id: 'notif-102',
                title: '[fixture ticket-created-vip-notify] VIP ticket created',
                message: 'ticketId=ticket-102',
                template_name: 'workflow-custom',
                is_read: false
              }
            ];
          }
          return [];
        },
        close: async () => {}
      })
    },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.ticket-created-vip-notify', workflowId: 'wf-102' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-102', status: 'SUCCEEDED' }),
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
  assert.equal(requests[0].opts.json.attributes.fixture_is_vip, true);
  assert.equal(requests[0].opts.json.attributes.fixture_notify_user_id, 'user-102');
  assert.equal(requests[1].path, '/api/v1/tickets/ticket-102');
  assert.equal(requests[1].opts.method, 'DELETE');
  assert.equal(requests[1].opts.headers['x-api-key'], 'api-key');
});

test('T103: ticket-created-outage-escalate fixture loads and executes via harness', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'ee/test-data/workflow-harness/ticket-created-outage-escalate');
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
            return { json: { data: { ticket_id: 'ticket-103' } } };
          }
          return { json: { data: {} } };
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text) => {
          const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.includes('from clients')) return [{ client_id: 'client-103' }];
          if (sql.includes('from boards')) return [{ board_id: 'board-103' }];
          if (sql.includes('from statuses')) return [{ status_id: 'status-103' }];
          if (sql.includes('from priorities')) return [{ priority_id: 'priority-103' }];
          if (sql.includes('from users')) return [{ user_id: 'user-103' }];
          if (sql.includes('select attributes from tickets')) {
            return [{ attributes: { fixture_escalated: true } }];
          }
          if (sql.includes('from internal_notifications')) {
            return [
              {
                internal_notification_id: 'notif-103',
                title: '[fixture ticket-created-outage-escalate] Outage escalation',
                message: 'ticketId=ticket-103'
              }
            ];
          }
          return [];
        },
        close: async () => {}
      })
    },
    workflow: {
      importWorkflowBundleV1: async () => ({ createdWorkflows: [{ key: 'fixture.ticket-created-outage-escalate', workflowId: 'wf-103' }] }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: 'run-103', status: 'SUCCEEDED' }),
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
  assert.equal(requests[0].opts.json.attributes.fixture_is_outage, true);
  assert.equal(requests[0].opts.json.attributes.fixture_notify_user_id, 'user-103');
  assert.equal(requests[1].path, '/api/v1/tickets/ticket-103');
  assert.equal(requests[1].opts.method, 'DELETE');
  assert.equal(requests[1].opts.headers['x-api-key'], 'api-key');
});
