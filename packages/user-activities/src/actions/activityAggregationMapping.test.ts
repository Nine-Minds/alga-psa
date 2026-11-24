/**
 * Row-to-Activity mapping contract for the project and ticket activity sources.
 *
 * These two feed the "My Work" dashboard, and both wrap their whole body in a
 * try/catch that returns an empty array. That makes a mapping error invisible:
 * the section renders empty rather than failing, so anything mis-shaped here is
 * silent by construction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPriority, ActivityType } from '@alga-psa/types';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
/** Rows the next awaited query resolves to. */
const rowsRef = vi.hoisted(() => ({ value: [] as any[] }));
const tagRowsRef = vi.hoisted(() => ({ value: [] as any[] }));
const projectActivityReadMock = vi.hoisted(() => vi.fn());
const authorizationMode = vi.hoisted(() => ({ value: 'allowed' }));

/** Chainable, awaitable query stub resolving to the registered rows. */
function queryStub(resultRows = rowsRef): any {
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: any) => unknown) => resolve(resultRows.value);
        }
        if (prop === 'first') return async () => resultRows.value[0];
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({
    table: (table: string) => queryStub(table === 'tag_mappings' ? tagRowsRef : rowsRef),
    tenantJoin: (query: any) => query,
    unscoped: () => queryStub(),
  }),
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/projects/activityRead', () => ({
  loadAuthorizedProjectTaskActivities: projectActivityReadMock,
}));

vi.mock('@alga-psa/core', () => ({ isFeatureFlagEnabled: vi.fn(async () => false) }));

vi.mock('@alga-psa/scheduling/actions/scheduleActivityCore', () => ({
  getScheduleActivityEntriesForUser: vi.fn(async () => []),
}));

vi.mock('@alga-psa/user-activities/server/workflow-tasks', () => ({
  fetchWorkflowTaskActivities: vi.fn(async () => []),
}));

import { fetchProjectActivities, fetchTicketActivities, fetchUserActivitiesForApi } from './activityAggregationActions';

/** Distinct user per call so the module's in-memory cache cannot bleed across tests. */
let userSeq = 0;
const nextUser = () => `user-${++userSeq}`;

function setRows(rows: any[]) {
  rowsRef.value = rows;
}

function projectTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'task-1',
    task_name: 'Rack the switch',
    description: 'In the comms room',
    status_name: 'In Progress',
    status_color: '#00ff00',
    is_closed: false,
    project_is_closed: false,
    priority_name: 'High',
    priority_color: '#ff0000',
    due_date: '2026-09-01T00:00:00.000Z',
    assigned_to: 'user-1',
    project_id: 'project-1',
    phase_id: 'phase-1',
    project_name: 'Office move',
    phase_name: 'Cutover',
    project_status_mapping_id: 'psm-1',
    estimated_hours: 4,
    actual_hours: 2,
    wbs_code: '1.2',
    tenant: 'tenant-1',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    title: 'Printer offline',
    description: 'Third floor',
    status_name: 'Open',
    priority_name: 'High',
    priority_color: '#ff0000',
    due_date: '2026-09-01T00:00:00.000Z',
    assigned_to: 'user-1',
    ticket_number: 'T-100',
    board_id: 'board-1',
    status_id: 'status-1',
    client_id: 'client-1',
    client_name: 'Acme Corp',
    contact_name_id: 'contact-1',
    contact_name: 'Alice Adams',
    estimated_hours: 2,
    is_closed: false,
    tenant: 'tenant-1',
    entered_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

/** A knex-ish handle: callable, with the raw/fn helpers the queries reach for. */
function knexStub(): any {
  const handle: any = () => queryStub();
  handle.raw = (sql: unknown) => sql;
  handle.fn = { now: () => new Date().toISOString() };
  handle.select = () => queryStub();
  handle.table = () => queryStub();
  return handle;
}

beforeEach(() => {
  vi.clearAllMocks();
  rowsRef.value = [];
  tagRowsRef.value = [];
  authorizationMode.value = 'allowed';
  createTenantKnexMock.mockResolvedValue({ knex: knexStub(), tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(knexStub()));
  projectActivityReadMock.mockImplementation(async (_trx: unknown, _tenant: string, _reader: unknown, identities: any[]) =>
    identities.map(({ taskId }) => {
      const row = rowsRef.value.find((candidate) => candidate.task_id === taskId);
      return { task: row, projectName: row?.project_name, projectIsClosed: row?.project_is_closed, phaseName: row?.phase_name,
        statusName: authorizationMode.value === 'redacted' ? null : row?.status_name, isClosed: row?.is_closed, priorityName: row?.priority_name, priorityColor: row?.priority_color,
        ...(authorizationMode.value === 'redacted' ? { task: { ...row, task_name: 'Project task', description: null, wbs_code: null, project_status_mapping_id: null }, phaseName: 'Project phase' } : {}) };
    }).filter((entry) => entry.task));
});

describe('fetchProjectActivities mapping', () => {
  it('maps a task row onto the activity shape the dashboard renders', async () => {
    setRows([projectTaskRow()]);

    const [activity] = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activity).toMatchObject({
      id: 'task-1',
      title: 'Rack the switch',
      type: ActivityType.PROJECT_TASK,
      status: 'In Progress',
      priority: ActivityPriority.HIGH,
      priorityName: 'High',
      projectId: 'project-1',
      phaseId: 'phase-1',
      projectName: 'Office move',
      phaseName: 'Cutover',
      assignedTo: ['user-1'],
      isClosed: false,
    });
  });

  it('falls back to a default status when the task has none', async () => {
    setRows([projectTaskRow({ status_name: null })]);

    const [activity] = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activity.status).toBe('To Do');
  });

  it('treats a task in a closed project as closed', async () => {
    // A closed project retires its tasks; leaving them open would keep finished
    // work on everyone's dashboard.
    setRows([projectTaskRow({ is_closed: false, project_is_closed: true })]);

    const [activity] = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activity.isClosed).toBe(true);
  });

  it('normalises the tenant priority name onto a coarse tier', async () => {
    for (const [name, tier] of [
      ['High', ActivityPriority.HIGH],
      ['Low', ActivityPriority.LOW],
      ['Something bespoke', ActivityPriority.MEDIUM],
    ] as const) {
      setRows([projectTaskRow({ priority_name: name })]);
      const [activity] = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);
      expect(activity.priority, `priority_name: ${name}`).toBe(tier);
    }
  });

  it('filters on the normalised tier, not the tenant priority name', async () => {
    setRows([projectTaskRow({ priority_name: 'High' }), projectTaskRow({ task_id: 't2', priority_name: 'Low' })]);

    const activities = await fetchProjectActivities(nextUser(), 'tenant-1', { priority: [ActivityPriority.HIGH] }, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe('task-1');
  });

  it('leaves the due date unset when the task has none', async () => {
    setRows([projectTaskRow({ due_date: null })]);

    const [activity] = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activity.dueDate).toBeUndefined();
  });

  it('drops only the unusable date, keeping the rest of the task', async () => {
    // The ticket source already guards this. Here an unparseable date reaches
    // `new Date(...).toISOString()`, which throws inside the map — and the
    // surrounding catch returns [], so ONE bad row blanks the entire project
    // section of the dashboard rather than losing a single field.
    setRows([projectTaskRow({ due_date: 'not-a-date' })]);

    const activities = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe('task-1');
    expect(activities[0].dueDate).toBeUndefined();
  });

  it('keeps good rows when a sibling row carries an unusable date', async () => {
    setRows([
      projectTaskRow({ task_id: 'good-1' }),
      projectTaskRow({ task_id: 'bad-1', due_date: 'not-a-date' }),
      projectTaskRow({ task_id: 'good-2' }),
    ]);

    const activities = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activities.map(a => a.id)).toEqual(expect.arrayContaining(['good-1', 'good-2']));
  });

  it('survives an unusable created or updated timestamp', async () => {
    setRows([projectTaskRow({ created_at: 'nonsense', updated_at: 'nonsense' })]);

    const activities = await fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any);

    expect(activities).toHaveLength(1);
    expect(() => new Date(activities[0].createdAt).toISOString()).not.toThrow();
  });

  it('returns an empty list when the user has no tasks', async () => {
    setRows([]);
    await expect(fetchProjectActivities(nextUser(), 'tenant-1', {}, { user_id: 'reader-1', user_type: 'internal' } as any)).resolves.toEqual([]);
  });

  it('rechecks warmed activity results across allowed, redacted, denied, and restored reads', async () => {
    const reader = { user_id: 'reader-1', user_type: 'internal' } as any;
    setRows([projectTaskRow()]);
    const fetch = () => fetchUserActivitiesForApi(reader, 'tenant-1', { types: [ActivityType.PROJECT_TASK] }, 1, 1);

    authorizationMode.value = 'allowed';
    const allowed = await fetch();
    expect(allowed).toMatchObject({ totalCount: 1, pageCount: 1, activities: [{ title: 'Rack the switch', phaseName: 'Cutover', wbsCode: '1.2', statusMappingId: 'psm-1' }] });

    authorizationMode.value = 'redacted';
    const redacted = await fetch();
    expect(redacted).toMatchObject({ totalCount: 1, pageCount: 1, activities: [{ title: 'Project task', phaseName: 'Project phase', wbsCode: null, statusMappingId: null }] });

    authorizationMode.value = 'denied';
    projectActivityReadMock.mockImplementationOnce(async () => []);
    const denied = await fetch();
    expect(denied).toMatchObject({ totalCount: 0, pageCount: 0, activities: [] });

    authorizationMode.value = 'allowed';
    const restored = await fetch();
    expect(restored.activities[0]).toMatchObject({ title: 'Rack the switch', phaseName: 'Cutover', wbsCode: '1.2', statusMappingId: 'psm-1' });
    expect(projectActivityReadMock.mock.calls.at(-1)?.[2]).toBe(reader);
  });

  it('paginates only the authorized task set', async () => {
    setRows([projectTaskRow(), projectTaskRow({ task_id: 'task-2' })]);
    const reader = { user_id: 'reader-1', user_type: 'internal' } as any;

    const first = await fetchUserActivitiesForApi(reader, 'tenant-1', { types: [ActivityType.PROJECT_TASK] }, 1, 1);
    const second = await fetchUserActivitiesForApi(reader, 'tenant-1', { types: [ActivityType.PROJECT_TASK] }, 2, 1);

    expect(first).toMatchObject({ totalCount: 2, pageCount: 2, activities: [{ id: 'task-1' }] });
    expect(second).toMatchObject({ totalCount: 2, pageCount: 2, activities: [{ id: 'task-2' }] });
  });

  it('applies phase, status, and tag filters after project authorization', async () => {
    setRows([
      projectTaskRow({ task_id: 'task-1', phase_id: 'phase-1', status_name: 'In Progress' }),
      projectTaskRow({ task_id: 'task-2', phase_id: 'phase-2', status_name: 'Done' }),
    ]);
    tagRowsRef.value = [{ tagged_id: 'task-2', tag_id: 'tag-1' }];
    const reader = { user_id: 'reader-1', user_type: 'internal' } as any;

    const phase = await fetchProjectActivities('owner-1', 'tenant-1', { phaseId: 'phase-2' }, reader);
    const status = await fetchProjectActivities('owner-1', 'tenant-1', { status: ['In Progress'] }, reader);
    const tagged = await fetchProjectActivities('owner-1', 'tenant-1', { projectTaskTagIds: ['tag-1'] }, reader);

    expect(phase.map(({ id }) => id)).toEqual(['task-2']);
    expect(status.map(({ id }) => id)).toEqual(['task-1']);
    expect(tagged.map(({ id }) => id)).toEqual(['task-2']);
  });

  it('composes phase, tag, and priority filters in direct and paginated aggregation', async () => {
    setRows([
      projectTaskRow({ task_id: 'task-1', phase_id: 'phase-1', priority_name: 'High' }),
      projectTaskRow({ task_id: 'task-2', phase_id: 'phase-2', priority_name: 'High' }),
    ]);
    tagRowsRef.value = [{ tagged_id: 'task-2', tag_id: 'tag-1' }];
    const filters = {
      phaseId: 'phase-2',
      projectTaskTagIds: ['tag-1'],
      priority: [ActivityPriority.HIGH],
    };
    const reader = { user_id: 'reader-1', user_type: 'internal' } as any;

    const direct = await fetchProjectActivities('owner-1', 'tenant-1', filters, reader);
    const paged = await fetchUserActivitiesForApi(reader, 'tenant-1', { ...filters, types: [ActivityType.PROJECT_TASK] }, 1, 10);

    expect(direct.map(({ id }) => id)).toEqual(['task-2']);
    expect(paged).toMatchObject({ totalCount: 1, pageCount: 1, activities: [{ id: 'task-2' }] });
  });
});

describe('fetchTicketActivities mapping', () => {
  it('maps a ticket row onto the activity shape the dashboard renders', async () => {
    setRows([ticketRow()]);

    const [activity] = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(activity).toMatchObject({
      id: 'ticket-1',
      title: 'Printer offline',
      type: ActivityType.TICKET,
      status: 'Open',
      priority: ActivityPriority.HIGH,
      ticketNumber: 'T-100',
      clientName: 'Acme Corp',
      contactName: 'Alice Adams',
      assignedTo: ['user-1'],
      isClosed: false,
    });
  });

  it('reads the creation time from entered_at, not a created_at column', async () => {
    // Tickets have no created_at; reading the wrong field silently fell back to
    // "now" and broke created-date sorting.
    setRows([ticketRow({ entered_at: '2026-08-01T00:00:00.000Z' })]);

    const [activity] = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(activity.createdAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('degrades an unusable due date to unset rather than failing the row', async () => {
    setRows([ticketRow({ due_date: 'not-a-date' })]);

    const activities = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(activities).toHaveLength(1);
    expect(activities[0].dueDate).toBeUndefined();
  });

  it('falls back to now when entered_at is unusable', async () => {
    setRows([ticketRow({ entered_at: 'not-a-date' })]);

    const [activity] = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(() => new Date(activity.createdAt).toISOString()).not.toThrow();
  });

  it('falls back to a placeholder status when the ticket has none', async () => {
    setRows([ticketRow({ status_name: null })]);

    const [activity] = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(activity.status).toBe('Unknown');
  });

  it('filters on the normalised tier, not the tenant priority name', async () => {
    setRows([ticketRow({ priority_name: 'High' }), ticketRow({ ticket_id: 'tk2', priority_name: 'Low' })]);

    const activities = await fetchTicketActivities(nextUser(), 'tenant-1', { priority: [ActivityPriority.LOW] });

    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe('tk2');
  });

  it('reports an unassigned ticket with an empty assignee list', async () => {
    setRows([ticketRow({ assigned_to: null })]);

    const [activity] = await fetchTicketActivities(nextUser(), 'tenant-1', {});

    expect(activity.assignedTo).toEqual([]);
  });
});
