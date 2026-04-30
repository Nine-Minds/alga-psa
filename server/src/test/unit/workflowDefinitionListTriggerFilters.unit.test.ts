import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockBuilder = ReturnType<typeof createBuilder>;

let builderQueue: MockBuilder[] = [];
let countQueryBuilder: MockBuilder;
let itemsQueryBuilder: MockBuilder;

function createBuilder(params?: {
  firstResult?: Record<string, unknown> | null;
  rowsResult?: Array<Record<string, unknown>>;
  cloneQueue?: MockBuilder[];
}) {
  const cloneQueue = params?.cloneQueue ?? [];
  const builder: any = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.max = vi.fn().mockReturnValue(builder);
  builder.groupBy = vi.fn().mockReturnValue(builder);
  builder.as = vi.fn().mockReturnValue(builder);
  builder.leftJoin = vi.fn().mockReturnValue(builder);
  builder.where = vi.fn().mockReturnValue(builder);
  builder.whereIn = vi.fn().mockReturnValue(builder);
  builder.whereRaw = vi.fn().mockReturnValue(builder);
  builder.andWhereIn = vi.fn().mockReturnValue(builder);
  builder.andWhereRaw = vi.fn().mockReturnValue(builder);
  builder.andWhere = vi.fn().mockReturnValue(builder);
  builder.count = vi.fn().mockReturnValue(builder);
  builder.first = vi.fn().mockResolvedValue(params?.firstResult ?? null);
  builder.orderBy = vi.fn().mockReturnValue(builder);
  builder.orderByRaw = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  builder.offset = vi.fn().mockResolvedValue(params?.rowsResult ?? []);
  builder.clone = vi.fn().mockImplementation(() => {
    const next = cloneQueue.shift();
    if (!next) {
      throw new Error('Missing clone builder');
    }
    return next;
  });
  return builder;
}

const knexMock: any = vi.fn((table: string) => {
  if (table === 'workflow_definition_versions') {
    return createBuilder();
  }
  if (table === 'workflow_definitions as wd') {
    const next = builderQueue.shift();
    if (!next) {
      throw new Error('Missing workflow_definitions builder');
    }
    return next;
  }
  if (table === 'tenant_workflow_schedule') {
    const builder = createBuilder({ rowsResult: [] }) as any;
    builder.then = (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve([]).then(resolve, reject);
    return builder;
  }
  throw new Error(`Unexpected table ${table}`);
});
knexMock.raw = vi.fn((sql: string) => sql);

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn()
}));

vi.mock('@alga-psa/analytics', () => ({
  analytics: {
    capture: vi.fn()
  }
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: 'tenant-1' })),
  auditLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: unknown) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-1' }, input),
  hasPermission: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', user_type: 'internal', roles: [] }),
  preCheckDeletion: vi.fn()
}));

import { listWorkflowDefinitionsPagedAction } from '@alga-psa/workflows/actions/workflow-runtime-v2-actions';

describe('Workflow definition list trigger filters', () => {
  beforeEach(() => {
    const totalBuilder = createBuilder({ firstResult: { count: '1' } });
    const activeBuilder = createBuilder({ firstResult: { count: '0' } });
    const draftBuilder = createBuilder({ firstResult: { count: '1' } });
    const pausedBuilder = createBuilder({ firstResult: { count: '0' } });
    const countBase = createBuilder({ cloneQueue: [totalBuilder, activeBuilder, draftBuilder, pausedBuilder] });
    countQueryBuilder = createBuilder({ firstResult: { count: '1' } });
    itemsQueryBuilder = createBuilder({
      rowsResult: [
        {
          workflow_id: 'wf-1',
          name: 'Workflow 1',
          status: 'draft',
          draft_version: 1,
          published_version: null,
          trigger: null,
          created_at: '2026-03-07T00:00:00.000Z',
          updated_at: '2026-03-07T00:00:00.000Z'
        }
      ]
    });

    builderQueue = [countQueryBuilder, itemsQueryBuilder, countBase];
    knexMock.mockClear();
    knexMock.raw.mockClear();
  });

  it('T016: workflows with one-time schedule triggers are filtered and reported via trigger.type=schedule', async () => {
    const scheduleRow = {
      workflow_id: 'wf-schedule',
      name: 'One-time schedule workflow',
      status: 'published',
      draft_version: 2,
      published_version: '1',
      trigger: { type: 'schedule', runAt: '2026-03-08T14:00:00.000Z' },
      created_at: '2026-03-07T00:00:00.000Z',
      updated_at: '2026-03-07T00:00:00.000Z'
    };
    (itemsQueryBuilder.offset as any).mockResolvedValue([scheduleRow]);

    const result = await listWorkflowDefinitionsPagedAction({
      page: 1,
      pageSize: 20,
      trigger: 'schedule'
    });

    expect(result.items[0]?.trigger?.type).toBe('schedule');
    expect(countQueryBuilder.andWhereRaw).toHaveBeenCalledWith("coalesce(wd.trigger->>'type', '') = ?", ['schedule']);
  });

  it('T017: workflows with recurring schedule triggers are filtered and reported via trigger.type=recurring', async () => {
    const recurringRow = {
      workflow_id: 'wf-recurring',
      name: 'Recurring workflow',
      status: 'published',
      draft_version: 2,
      published_version: '1',
      trigger: { type: 'recurring', cron: '15 9 * * 1-5', timezone: 'America/New_York' },
      created_at: '2026-03-07T00:00:00.000Z',
      updated_at: '2026-03-07T00:00:00.000Z'
    };
    (itemsQueryBuilder.offset as any).mockResolvedValue([recurringRow]);

    const result = await listWorkflowDefinitionsPagedAction({
      page: 1,
      pageSize: 20,
      trigger: 'recurring'
    });

    expect(result.items[0]?.trigger?.type).toBe('recurring');
    expect(countQueryBuilder.andWhereRaw).toHaveBeenCalledWith("coalesce(wd.trigger->>'type', '') = ?", ['recurring']);
  });
});
