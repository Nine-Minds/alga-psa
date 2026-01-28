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

async function runFixtureWithStubs({ fixtureName, testId, httpResponder, dbQuery }) {
  const fixtureDir = path.resolve(process.cwd(), `ee/test-data/workflow-harness/${fixtureName}`);
  const bundlePath = path.join(fixtureDir, 'bundle.json');
  const testPath = path.join(fixtureDir, 'test.cjs');

  const requests = [];
  const harness = loadHarnessWithStubs({
    http: {
      createHttpClient: () => ({
        request: async (p, opts) => {
          requests.push({ path: p, opts });
          return httpResponder(p, opts);
        }
      })
    },
    db: {
      createDbClient: async () => ({
        query: async (text, params) => dbQuery(String(text), params),
        close: async () => {}
      })
    },
    workflow: {
      importWorkflowBundleV1: async () => ({
        createdWorkflows: [{ key: `fixture.${fixtureName}`, workflowId: `wf-${testId}` }]
      }),
      exportWorkflowBundleV1: async () => ({})
    },
    runs: {
      waitForRun: async () => ({ run_id: `run-${testId}`, status: 'SUCCEEDED' }),
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

  return requests;
}

test('T210: appointment-created-assign-notify fixture loads and executes via harness', async () => {
  const fixtureName = 'appointment-created-assign-notify';

  const savedApiKey = process.env.WORKFLOW_HARNESS_API_KEY;
  process.env.WORKFLOW_HARNESS_API_KEY = 'api-key';

  let appointmentId = null;

  try {
    const requests = await runFixtureWithStubs({
      fixtureName,
      testId: 'T210',
      httpResponder: async (p, opts) => {
        if (p === '/api/v1/tickets' && opts?.method === 'POST') {
          return { json: { data: { ticket_id: 'ticket-210' } } };
        }
        if (p === '/api/workflow/events' && opts?.method === 'POST') {
          appointmentId = opts?.json?.payload?.appointmentId ?? null;
          return { json: {} };
        }
        return { json: { data: {} } };
      },
      dbQuery: async (text, params) => {
        const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.includes('from clients')) return [{ client_id: 'client-210' }];
        if (sql.includes('from boards')) return [{ board_id: 'board-210' }];
        if (sql.includes('from statuses')) return [{ status_id: 'status-210' }];
        if (sql.includes('from priorities')) return [{ priority_id: 'priority-210' }];
        if (sql.includes('join user_roles') && sql.includes('join roles') && sql.includes('lower(r.role_name)') && params?.[1] === 'technician') {
          return [{ user_id: 'tech-210' }];
        }
        if (sql.includes('from schedule_entries')) {
          const marker = '[fixture appointment-created-assign-notify]';
          return [
            {
              entry_id: 'entry-210',
              title: `${marker} appointmentId=${appointmentId ?? 'missing'}`,
              work_item_type: 'ticket',
              work_item_id: 'ticket-210',
              user_id: 'tech-210',
              scheduled_start: new Date().toISOString(),
              scheduled_end: new Date().toISOString()
            }
          ];
        }
        if (sql.includes('from internal_notifications')) {
          const marker = '[fixture appointment-created-assign-notify]';
          return [{ internal_notification_id: 'notif-210', title: `${marker} assigned`, message: `ticketId=ticket-210` }];
        }
        return [];
      }
    });

    assert.equal(requests.length, 4);
    assert.equal(requests[0].path, '/api/v1/tickets');
    assert.equal(requests[0].opts.method, 'POST');
    assert.equal(requests[0].opts.headers['x-api-key'], 'api-key');
    assert.equal(requests[1].path, '/api/workflow/events');
    assert.equal(requests[1].opts.method, 'POST');
    assert.equal(requests[1].opts.json.eventName, 'APPOINTMENT_CREATED');
    assert.equal(requests[2].path, '/api/v1/schedules/entry-210');
    assert.equal(requests[2].opts.method, 'DELETE');
    assert.equal(requests[2].opts.headers['x-api-key'], 'api-key');
    assert.equal(requests[3].path, '/api/v1/tickets/ticket-210');
    assert.equal(requests[3].opts.method, 'DELETE');
    assert.equal(requests[3].opts.headers['x-api-key'], 'api-key');
  } finally {
    if (savedApiKey === undefined) delete process.env.WORKFLOW_HARNESS_API_KEY;
    else process.env.WORKFLOW_HARNESS_API_KEY = savedApiKey;
  }
});

test('T219: schedule-block-created fixture loads and executes via harness', async () => {
  const fixtureName = 'schedule-block-created';

  const savedApiKey = process.env.WORKFLOW_HARNESS_API_KEY;
  process.env.WORKFLOW_HARNESS_API_KEY = 'api-key';

  let scheduleBlockId = null;

  try {
    const requests = await runFixtureWithStubs({
      fixtureName,
      testId: 'T219',
      httpResponder: async (p, opts) => {
        if (p === '/api/v1/projects' && opts?.method === 'POST') {
          return { json: { data: { project_id: 'project-219' } } };
        }
        if (p === '/api/workflow/events' && opts?.method === 'POST') {
          scheduleBlockId = opts?.json?.payload?.scheduleBlockId ?? null;
          return { json: {} };
        }
        return { json: { data: {} } };
      },
      dbQuery: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.includes('from clients')) return [{ client_id: 'client-219' }];
        if (sql.includes('from users')) return [{ user_id: 'user-219' }];
        if (sql.includes('from project_tasks')) {
          const marker = '[fixture schedule-block-created]';
          return [{ task_id: 'task-219', task_name: `${marker} scheduleBlockId=${scheduleBlockId ?? 'missing'}` }];
        }
        if (sql.includes('from internal_notifications')) {
          const marker = '[fixture schedule-block-created]';
          return [{ internal_notification_id: 'notif-219', title: `${marker} created`, message: `scheduleBlockId=${scheduleBlockId}` }];
        }
        return [];
      }
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].path, '/api/v1/projects');
    assert.equal(requests[0].opts.method, 'POST');
    assert.equal(requests[0].opts.headers['x-api-key'], 'api-key');
    assert.equal(requests[1].path, '/api/workflow/events');
    assert.equal(requests[1].opts.method, 'POST');
    assert.equal(requests[1].opts.json.eventName, 'SCHEDULE_BLOCK_CREATED');
    assert.equal(requests[2].path, '/api/v1/projects/project-219');
    assert.equal(requests[2].opts.method, 'DELETE');
    assert.equal(requests[2].opts.headers['x-api-key'], 'api-key');
  } finally {
    if (savedApiKey === undefined) delete process.env.WORKFLOW_HARNESS_API_KEY;
    else process.env.WORKFLOW_HARNESS_API_KEY = savedApiKey;
  }
});

test('T230: invoice-generated-review-task fixture loads and executes via harness', async () => {
  const fixtureName = 'invoice-generated-review-task';

  const savedApiKey = process.env.WORKFLOW_HARNESS_API_KEY;
  process.env.WORKFLOW_HARNESS_API_KEY = 'api-key';

  let invoiceId = null;

  try {
    const requests = await runFixtureWithStubs({
      fixtureName,
      testId: 'T230',
      httpResponder: async (p, opts) => {
        if (p === '/api/v1/projects' && opts?.method === 'POST') {
          return { json: { data: { project_id: 'project-230' } } };
        }
        if (p === '/api/workflow/events' && opts?.method === 'POST') {
          invoiceId = opts?.json?.payload?.invoiceId ?? null;
          return { json: {} };
        }
        return { json: { data: {} } };
      },
      dbQuery: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.includes('from clients')) return [{ client_id: 'client-230' }];
        if (sql.includes('from users')) return [{ user_id: 'user-230' }];
        if (sql.includes('from project_tasks')) {
          const marker = '[fixture invoice-generated-review-task]';
          return [{ task_id: 'task-230', task_name: `${marker} invoiceId=${invoiceId ?? 'missing'}` }];
        }
        if (sql.includes('from internal_notifications')) {
          const marker = '[fixture invoice-generated-review-task]';
          return [{ internal_notification_id: 'notif-230', title: `${marker} generated`, message: `invoiceId=${invoiceId}` }];
        }
        return [];
      }
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].path, '/api/v1/projects');
    assert.equal(requests[0].opts.method, 'POST');
    assert.equal(requests[0].opts.headers['x-api-key'], 'api-key');
    assert.equal(requests[1].path, '/api/workflow/events');
    assert.equal(requests[1].opts.method, 'POST');
    assert.equal(requests[1].opts.json.eventName, 'INVOICE_GENERATED');
    assert.equal(requests[2].path, '/api/v1/projects/project-230');
    assert.equal(requests[2].opts.method, 'DELETE');
    assert.equal(requests[2].opts.headers['x-api-key'], 'api-key');
  } finally {
    if (savedApiKey === undefined) delete process.env.WORKFLOW_HARNESS_API_KEY;
    else process.env.WORKFLOW_HARNESS_API_KEY = savedApiKey;
  }
});

test('T237: payment-recorded-notify fixture loads and executes via harness', async () => {
  const fixtureName = 'payment-recorded-notify';

  let paymentId = null;

  const requests = await runFixtureWithStubs({
    fixtureName,
    testId: 'T237',
    httpResponder: async (p, opts) => {
      if (p === '/api/workflow/events' && opts?.method === 'POST') {
        paymentId = opts?.json?.payload?.paymentId ?? null;
        return { json: {} };
      }
      return { json: { data: {} } };
    },
    dbQuery: async (text) => {
      const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
      if (sql.includes('from users')) return [{ user_id: 'user-237' }];
      if (sql.includes('from internal_notifications')) {
        const marker = '[fixture payment-recorded-notify]';
        return [
          {
            internal_notification_id: 'notif-237',
            title: `${marker} payment recorded`,
            message: `paymentId=${paymentId} amount=42.00`
          }
        ];
      }
      return [];
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/workflow/events');
  assert.equal(requests[0].opts.method, 'POST');
  assert.equal(requests[0].opts.json.eventName, 'PAYMENT_RECORDED');
});

test('T240: contract-created-onboarding-task fixture loads and executes via harness', async () => {
  const fixtureName = 'contract-created-onboarding-task';

  const savedApiKey = process.env.WORKFLOW_HARNESS_API_KEY;
  process.env.WORKFLOW_HARNESS_API_KEY = 'api-key';

  let contractId = null;

  try {
    const requests = await runFixtureWithStubs({
      fixtureName,
      testId: 'T240',
      httpResponder: async (p, opts) => {
        if (p === '/api/v1/projects' && opts?.method === 'POST') {
          return { json: { data: { project_id: 'project-240' } } };
        }
        if (p === '/api/workflow/events' && opts?.method === 'POST') {
          contractId = opts?.json?.payload?.contractId ?? null;
          return { json: {} };
        }
        return { json: { data: {} } };
      },
      dbQuery: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.includes('from clients')) return [{ client_id: 'client-240' }];
        if (sql.includes('from users')) return [{ user_id: 'user-240' }];
        if (sql.includes('from statuses') && sql.includes("item_type = 'project'") && sql.includes('is_default = true')) {
          return [{ status_id: 'status-project-240' }];
        }
        if (sql.includes('from project_tasks')) {
          const marker = '[fixture contract-created-onboarding-task]';
          return [{ task_id: 'task-240', task_name: `${marker} contractId=${contractId ?? 'missing'}` }];
        }
        if (sql.includes('from interactions')) {
          const marker = '[fixture contract-created-onboarding-task]';
          return [{ interaction_id: 'int-240', notes: `${marker} contractId=${contractId}`, visibility: 'internal', title: 'note' }];
        }
        if (sql.includes('from internal_notifications')) {
          const marker = '[fixture contract-created-onboarding-task]';
          return [{ internal_notification_id: 'notif-240', title: `${marker} created`, message: `contractId=${contractId}` }];
        }
        return [];
      }
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].path, '/api/v1/projects');
    assert.equal(requests[0].opts.method, 'POST');
    assert.equal(requests[0].opts.headers['x-api-key'], 'api-key');
    assert.equal(requests[1].path, '/api/workflow/events');
    assert.equal(requests[1].opts.method, 'POST');
    assert.equal(requests[1].opts.json.eventName, 'CONTRACT_CREATED');
    assert.equal(requests[2].path, '/api/v1/projects/project-240');
    assert.equal(requests[2].opts.method, 'DELETE');
    assert.equal(requests[2].opts.headers['x-api-key'], 'api-key');
  } finally {
    if (savedApiKey === undefined) delete process.env.WORKFLOW_HARNESS_API_KEY;
    else process.env.WORKFLOW_HARNESS_API_KEY = savedApiKey;
  }
});
