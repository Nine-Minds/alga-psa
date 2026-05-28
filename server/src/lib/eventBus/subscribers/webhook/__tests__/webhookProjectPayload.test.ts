import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tagMappingState = vi.hoisted(() => ({
  getByEntityMock: vi.fn(),
}));

vi.mock('@alga-psa/tags/models/tagMapping', () => ({
  default: {
    getByEntity: (...args: unknown[]) => tagMappingState.getByEntityMock(...args),
  },
}));

import {
  buildProjectTaskWebhookPayload,
  buildProjectWebhookPayload,
  clearProjectWebhookPayloadCache,
  fetchProjectPhasesForWebhook,
  fetchProjectTaskCountsForWebhook,
  type ProjectWebhookSourceEvent,
} from '../webhookProjectPayload';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';

function makeProjectRow(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT_ID,
    project_name: 'Migration project',
    wbs_code: 'PRJ-1',
    description: 'Move systems',
    status_id: 'status-open',
    status_name: 'Open',
    is_closed: false,
    client_id: 'client-1',
    client_name: 'Acme',
    contact_name_id: 'contact-1',
    contact_name: 'Jane Doe',
    contact_email: 'jane@acme.com',
    assigned_to: 'user-1',
    assigned_to_name: 'Alice Agent',
    start_date: new Date('2026-05-01T00:00:00.000Z'),
    end_date: null,
    budgeted_hours: '40',
    ...overrides,
  };
}

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT_ID,
    project_name: 'Migration project',
    client_id: 'client-1',
    client_name: 'Acme',
    task_id: TASK_ID,
    phase_id: 'phase-1',
    phase_name: 'Planning',
    task_name: 'Draft plan',
    description: 'Draft the migration plan',
    status_id: 'task-status-open',
    status_name: 'Open',
    is_closed: false,
    assigned_to: 'user-1',
    assigned_to_name: 'Alice Agent',
    estimated_hours: '8',
    actual_hours: '2',
    due_date: new Date('2026-05-20T00:00:00.000Z'),
    priority_id: 'priority-1',
    priority_name: 'High',
    wbs_code: '1.1',
    ...overrides,
  };
}

function createQueryResult(result: unknown) {
  const chainable: any = {
    leftJoin: () => chainable,
    join: () => chainable,
    select: () => chainable,
    where: () => chainable,
    orderByRaw: () => chainable,
    first: async () => (Array.isArray(result) ? result[0] : result),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(Array.isArray(result) ? result : []).then(resolve, reject),
  };
  return chainable;
}

function createFakeKnex(options: {
  projectRows?: Record<string, unknown>;
  taskRows?: Record<string, unknown> | unknown[];
  statusRows?: Record<string, unknown>;
  phaseRows?: unknown[];
  taskCountRows?: unknown[];
} = {}) {
  const calls = {
    projects: 0,
    tasks: 0,
    statuses: 0,
    phases: 0,
    taskCounts: 0,
  };

  const knex: any = (table: unknown) => {
    if (table === 'projects as p') {
      calls.projects += 1;
      return createQueryResult(options.projectRows ?? makeProjectRow());
    }
    if (table === 'project_tasks as pt') {
      calls.tasks += 1;
      return createQueryResult(options.taskRows ?? makeTaskRow());
    }
    if (table === 'project_status_mappings as psm' || table === 'statuses') {
      calls.statuses += 1;
      return createQueryResult(options.statusRows ?? { status_name: 'Previous', name: 'Previous' });
    }
    if (table === 'project_phases as pp') {
      calls.phases += 1;
      return createQueryResult(options.phaseRows ?? []);
    }
    throw new Error(`Unexpected table ${String(table)}`);
  };
  knex.raw = (sql: string) => sql;

  return { knex, calls };
}

const PROJECT_EVENT: ProjectWebhookSourceEvent = {
  eventType: 'PROJECT_CREATED',
  timestamp: '2026-05-15T12:00:00.000Z',
  payload: {
    tenantId: TENANT,
    projectId: PROJECT_ID,
  },
};

const TASK_EVENT: ProjectWebhookSourceEvent = {
  eventType: 'PROJECT_TASK_CREATED',
  timestamp: '2026-05-15T12:00:00.000Z',
  payload: {
    tenantId: TENANT,
    projectId: PROJECT_ID,
    taskId: TASK_ID,
  },
};

describe('webhookProjectPayload', () => {
  beforeEach(() => {
    clearProjectWebhookPayloadCache();
    tagMappingState.getByEntityMock.mockReset();
    process.env.NEXTAUTH_URL = 'https://psa.example.test/';
  });

  afterEach(() => {
    clearProjectWebhookPayloadCache();
    delete process.env.NEXTAUTH_URL;
  });

  it('builds project scalar payloads with project URLs and no project-level tags', async () => {
    const { knex } = createFakeKnex();

    const payload = await buildProjectWebhookPayload(PROJECT_EVENT, knex);

    expect(payload).toMatchObject({
      project_id: PROJECT_ID,
      project_name: 'Migration project',
      client_id: 'client-1',
      client_name: 'Acme',
      assigned_to_name: 'Alice Agent',
      budgeted_hours: 40,
      url: `https://psa.example.test/msp/projects/${PROJECT_ID}`,
    });
    expect('tags' in payload).toBe(false);
  });

  it('adds previous status metadata for status changes and changes for updates', async () => {
    const { knex } = createFakeKnex({ statusRows: { status_name: 'In Progress' } });

    // PROJECT_STATUS_CHANGED carries `previousStatus` as a project status_id
    // (the `projects.status` column); the name is resolved from that id.
    const statusPayload = await buildProjectWebhookPayload(
      {
        ...PROJECT_EVENT,
        eventType: 'PROJECT_STATUS_CHANGED',
        payload: {
          ...PROJECT_EVENT.payload,
          previousStatus: 'status-progress',
        },
      },
      knex,
    );

    expect(statusPayload.previous_status_id).toBe('status-progress');
    expect(statusPayload.previous_status_name).toBe('In Progress');

    const updatePayload = await buildProjectWebhookPayload(
      {
        ...PROJECT_EVENT,
        eventType: 'PROJECT_UPDATED',
        payload: {
          ...PROJECT_EVENT.payload,
          changes: {
            project_name: {
              previous: 'Old',
              new: 'New',
            },
          },
        },
      },
      knex,
    );

    expect(updatePayload.changes).toEqual({
      project_name: {
        previous: 'Old',
        new: 'New',
      },
    });
  });

  it('caches project payloads within TTL and evicts least recently used entries past 256', async () => {
    const { knex, calls } = createFakeKnex();

    await buildProjectWebhookPayload(PROJECT_EVENT, knex);
    await buildProjectWebhookPayload(PROJECT_EVENT, knex);
    expect(calls.projects).toBe(1);

    for (let index = 0; index < 256; index += 1) {
      await buildProjectWebhookPayload(
        {
          ...PROJECT_EVENT,
          payload: {
            ...PROJECT_EVENT.payload,
            projectId: `project-${index + 2}`,
          },
        },
        knex,
      );
    }

    await buildProjectWebhookPayload(PROJECT_EVENT, knex);
    expect(calls.projects).toBe(258);
  });

  it('builds task payloads with project context, task URL, and project_task tags', async () => {
    tagMappingState.getByEntityMock.mockResolvedValue([
      { tag_text: 'urgent' },
      { tag_text: 'vip' },
      { tag_text: '' },
    ]);
    const { knex } = createFakeKnex();

    const payload = await buildProjectTaskWebhookPayload(TASK_EVENT, knex);

    expect(payload).toMatchObject({
      project_id: PROJECT_ID,
      project_name: 'Migration project',
      task_id: TASK_ID,
      phase_id: 'phase-1',
      task_name: 'Draft plan',
      estimated_hours: 8,
      actual_hours: 2,
      priority_name: 'High',
      tags: ['urgent', 'vip'],
      url: `https://psa.example.test/msp/projects/${PROJECT_ID}?taskId=${TASK_ID}`,
    });
    expect(tagMappingState.getByEntityMock).toHaveBeenCalledWith(
      knex,
      TENANT,
      TASK_ID,
      'project_task',
    );
  });

  it('fetches phases and task counts for opt-in project payload sections', async () => {
    const { knex } = createFakeKnex({
      phaseRows: [
        {
          phase_id: 'phase-1',
          phase_name: 'Planning',
          description: null,
          start_date: new Date('2026-05-01T00:00:00.000Z'),
          end_date: null,
          status_id: 'status-open',
          status_name: 'Open',
          order_key: 'a0',
          order_number: 1,
          wbs_code: '1',
        },
      ],
      taskRows: [
        { status_name: 'Open', is_closed: false, due_date: new Date('2020-01-01T00:00:00.000Z') },
        { status_name: 'Done', is_closed: true, due_date: null },
      ],
    });

    const phases = await fetchProjectPhasesForWebhook(knex, TENANT, PROJECT_ID);
    const counts = await fetchProjectTaskCountsForWebhook(knex, TENANT, PROJECT_ID);

    expect(phases).toEqual([
      {
        phase_id: 'phase-1',
        phase_name: 'Planning',
        description: null,
        start_date: '2026-05-01T00:00:00.000Z',
        end_date: null,
        status_id: 'status-open',
        status_name: 'Open',
        order_key: 'a0',
        order_number: 1,
        wbs_code: '1',
      },
    ]);
    expect(counts).toEqual({
      total: 2,
      completed: 1,
      overdue: 1,
      by_status: {
        Open: 1,
        Done: 1,
      },
    });
  });

  it('uses the resolved status name for task status changes without a previous id', async () => {
    tagMappingState.getByEntityMock.mockResolvedValue([]);
    const { knex } = createFakeKnex();

    // PROJECT_TASK_STATUS_CHANGED carries `previousStatus` as an already
    // resolved status name; no previous mapping id is in the event.
    const payload = await buildProjectTaskWebhookPayload(
      {
        ...TASK_EVENT,
        eventType: 'PROJECT_TASK_STATUS_CHANGED',
        payload: {
          ...TASK_EVENT.payload,
          previousStatus: 'In Progress',
        },
      },
      knex,
    );

    expect(payload.previous_status_name).toBe('In Progress');
    expect(payload.previous_status_id).toBeNull();
  });

  it('reconciles task tags with changes.tags.new on PROJECT_TASK_UPDATED', async () => {
    // Cached/DB snapshot is stale relative to the tag mutation that fired the
    // event; the delivered payload must not contradict its own changes.tags.
    tagMappingState.getByEntityMock.mockResolvedValue([{ tag_text: 'old' }]);
    const { knex } = createFakeKnex();

    const payload = await buildProjectTaskWebhookPayload(
      {
        ...TASK_EVENT,
        eventType: 'PROJECT_TASK_UPDATED',
        payload: {
          ...TASK_EVENT.payload,
          changes: {
            tags: {
              previous: ['old'],
              new: ['old', 'new'],
            },
          },
        },
      },
      knex,
    );

    expect(payload.tags).toEqual(['old', 'new']);
    expect(payload.changes?.tags).toEqual({
      previous: ['old'],
      new: ['old', 'new'],
    });
  });
});
