import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  hasPermissionMock,
  schemaRegistryHasMock,
  schemaRegistryRegisterMock,
  schemaRegistryGetMock,
  workflowGetByIdMock,
  workflowListVersionsMock,
  createExternalWorkflowScheduleStateMock,
  resolveWorkflowBusinessDaySettingsMock
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(async () => true),
  schemaRegistryHasMock: vi.fn(),
  schemaRegistryRegisterMock: vi.fn(),
  schemaRegistryGetMock: vi.fn(),
  workflowGetByIdMock: vi.fn(),
  workflowListVersionsMock: vi.fn(),
  createExternalWorkflowScheduleStateMock: vi.fn(),
  resolveWorkflowBusinessDaySettingsMock: vi.fn()
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (input: unknown) => action(
    { user_id: 'user-1', tenant: 'tenant-1', roles: [] },
    { tenant: 'tenant-1' },
    input
  ),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args)
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  getSchemaRegistry: () => ({
    has: (...args: unknown[]) => schemaRegistryHasMock(...args),
    register: (...args: unknown[]) => schemaRegistryRegisterMock(...args),
    get: (...args: unknown[]) => schemaRegistryGetMock(...args)
  }),
  emailWorkflowPayloadSchema: {},
  emptyWorkflowPayloadSchema: {},
  EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF: 'payload.Empty.v1',
  workflowClockTriggerPayloadSchema: {},
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF: 'payload.WorkflowClock.v1',
  workflowEventPayloadSchemas: {}
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowDefinitionModelV2: {
    getById: (...args: unknown[]) => workflowGetByIdMock(...args)
  },
  WorkflowDefinitionVersionModelV2: {
    listByWorkflow: (...args: unknown[]) => workflowListVersionsMock(...args)
  },
  WorkflowScheduleStateModel: {
    getById: vi.fn()
  }
}));

vi.mock('../../../../packages/workflows/src/lib/workflowScheduleLifecycle', () => ({
  createExternalWorkflowScheduleState: (...args: unknown[]) => createExternalWorkflowScheduleStateMock(...args),
  deleteWorkflowScheduleStateById: vi.fn(),
  setExternalWorkflowScheduleEnabled: vi.fn(),
  updateExternalWorkflowScheduleState: vi.fn()
}));

vi.mock('../../../../packages/workflows/src/lib/workflowBusinessDayScheduling', () => ({
  normalizeWorkflowDayTypeFilter: (value: unknown) => (
    value === 'business' || value === 'non_business' ? value : 'any'
  ),
  resolveWorkflowBusinessDaySettings: (...args: unknown[]) => resolveWorkflowBusinessDaySettingsMock(...args),
  computeNextEligibleRecurringFireAt: vi.fn(() => null)
}));

import {
  createWorkflowScheduleAction,
  listWorkflowSchedulesAction
} from '@alga-psa/workflows/actions/workflow-schedule-v2-actions';

const buildScheduleListQuery = (rows: Array<Record<string, unknown>>) => {
  let orderByCalls = 0;
  return {
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn(function orderBy() {
      orderByCalls += 1;
      if (orderByCalls >= 2) {
        return Promise.resolve(rows);
      }
      return this;
    })
  };
};

describe('workflow schedule actions', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    hasPermissionMock.mockReset();
    schemaRegistryHasMock.mockReset();
    schemaRegistryRegisterMock.mockReset();
    schemaRegistryGetMock.mockReset();
    workflowGetByIdMock.mockReset();
    workflowListVersionsMock.mockReset();
    createExternalWorkflowScheduleStateMock.mockReset();
    resolveWorkflowBusinessDaySettingsMock.mockReset();

    hasPermissionMock.mockResolvedValue(true);
    schemaRegistryHasMock.mockReturnValue(true);
    schemaRegistryGetMock.mockReturnValue({
      safeParse: () => ({ success: true })
    });
    workflowGetByIdMock.mockResolvedValue({
      workflow_id: 'workflow-1',
      payload_schema_mode: 'pinned',
      payload_schema_ref: 'payload.Custom.v1',
      name: 'Workflow'
    });
    workflowListVersionsMock.mockResolvedValue([
      {
        workflow_id: 'workflow-1',
        version: 3,
        definition_json: {
          id: 'workflow-1',
          version: 3,
          payloadSchemaRef: 'payload.Custom.v1',
          steps: []
        }
      }
    ]);
    createExternalWorkflowScheduleStateMock.mockResolvedValue({
      id: 'schedule-1',
      workflow_id: 'workflow-1',
      workflow_version: 3,
      name: 'Quarterly kickoff',
      trigger_type: 'schedule'
    });
    resolveWorkflowBusinessDaySettingsMock.mockResolvedValue({ ok: true, value: null });
  });

  it('T042: creates schedules through the EE workflow action surface using the latest published workflow version', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });

    const result = await createWorkflowScheduleAction({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Quarterly kickoff',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: true,
      schedule: expect.objectContaining({
        id: 'schedule-1',
        workflow_version: 3
      })
    });
    expect(createExternalWorkflowScheduleStateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        record: expect.objectContaining({
          workflowId: '11111111-1111-4111-8111-111111111111',
          name: 'Quarterly kickoff',
          desired: expect.objectContaining({
            workflowVersion: 3,
            triggerType: 'schedule'
          })
        })
      })
    );
  });

  it('lists schedule rows through the EE workflow action surface', async () => {
    const rows = [
      {
        id: 'schedule-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Workflow',
        name: 'Quarterly kickoff'
      }
    ];
    const listQuery = buildScheduleListQuery(rows);
    const knexMock: any = vi.fn((table: string) => {
      if (table === 'tenant_workflow_schedule as tws') {
        return listQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-1' });

    const result = await listWorkflowSchedulesAction({});

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'schedule-1',
          workflow_id: 'workflow-1',
          workflow_name: 'Workflow',
          name: 'Quarterly kickoff',
          effective_business_hours_schedule_id: null,
          business_hours_schedule_source: null,
          next_eligible_fire_at: null
        })
      ]
    });
    expect(listQuery.where).toHaveBeenCalledWith('tws.tenant_id', 'tenant-1');
  });

  it('T002: rejects one-time schedules that set non-any day filters', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });

    const result = await createWorkflowScheduleAction({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Invalid one-time filter',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      dayTypeFilter: 'business',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'DAY_FILTER_NOT_ALLOWED_FOR_ONE_TIME',
      message: 'One-time schedules only support "Any day".'
    });
    expect(createExternalWorkflowScheduleStateMock).not.toHaveBeenCalled();
  });

  it('T003: rejects filtered recurring schedules when no effective business-hours schedule can be resolved', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });
    resolveWorkflowBusinessDaySettingsMock.mockResolvedValueOnce({
      ok: false,
      issue: {
        code: 'BUSINESS_HOURS_SCHEDULE_REQUIRED',
        message: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
      }
    });

    const result = await createWorkflowScheduleAction({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Missing calendar',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'BUSINESS_HOURS_SCHEDULE_REQUIRED',
      message: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
    });
    expect(createExternalWorkflowScheduleStateMock).not.toHaveBeenCalled();
  });

  it('T004: rejects recurring schedules when override schedule is outside the tenant scope', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });
    resolveWorkflowBusinessDaySettingsMock.mockResolvedValueOnce({
      ok: false,
      issue: {
        code: 'BUSINESS_HOURS_OVERRIDE_NOT_FOUND',
        message: 'Selected business-hours schedule is invalid for this tenant.'
      }
    });

    const result = await createWorkflowScheduleAction({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Foreign override',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'non_business',
      businessHoursScheduleId: '22222222-2222-4222-8222-222222222222',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'BUSINESS_HOURS_OVERRIDE_NOT_FOUND',
      message: 'Selected business-hours schedule is invalid for this tenant.'
    });
    expect(createExternalWorkflowScheduleStateMock).not.toHaveBeenCalled();
  });
});
