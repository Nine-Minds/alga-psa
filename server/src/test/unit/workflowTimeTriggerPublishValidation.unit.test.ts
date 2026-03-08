import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2
} from '@shared/workflow/runtime';
import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

type WorkflowRecord = Record<string, any>;
type VersionRecord = Record<string, any>;

let workflowRecord: WorkflowRecord | null = null;
const versionRecords = new Map<number, VersionRecord>();

const knexMock: any = vi.fn((table: string) => {
  if (table === 'workflow_definition_versions') {
    return {
      where: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        max_version: versionRecords.size > 0 ? Math.max(...versionRecords.keys()) : null
      })
    };
  }
  throw new Error(`Unexpected table access: ${table}`);
});

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

vi.mock('@shared/workflow/persistence/workflowDefinitionModelV2', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: WorkflowRecord) => {
      workflowRecord = { ...data };
      return workflowRecord;
    }),
    getById: vi.fn(async () => workflowRecord),
    update: vi.fn(async (_knex: unknown, _workflowId: string, data: WorkflowRecord) => {
      workflowRecord = { ...(workflowRecord ?? {}), ...data };
      return workflowRecord;
    }),
    list: vi.fn(async () => (workflowRecord ? [workflowRecord] : []))
  }
}));

vi.mock('@shared/workflow/persistence/workflowDefinitionVersionModelV2', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: VersionRecord) => {
      const record = { ...data };
      versionRecords.set(Number(record.version), record);
      return record;
    }),
    getByWorkflowAndVersion: vi.fn(async (_knex: unknown, _workflowId: string, version: number) => versionRecords.get(Number(version)) ?? null),
    listByWorkflow: vi.fn(async () => Array.from(versionRecords.values()).sort((a, b) => Number(b.version) - Number(a.version)))
  }
}));

vi.mock('../../../../packages/workflows/src/models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => null)
  }
}));

import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction
} from '../../../../packages/workflows/src/actions/workflow-runtime-v2-actions';

const buildDraftDefinition = (trigger: Record<string, unknown>, payloadSchemaRef = TEST_SCHEMA_REF) => ({
  id: 'draft-workflow',
  ...buildWorkflowDefinition({
    steps: [stateSetStep('state-1', 'READY')],
    payloadSchemaRef,
    trigger: trigger as any
  })
});

describe('Workflow time trigger publish validation unit tests', () => {
  beforeEach(() => {
    workflowRecord = null;
    versionRecords.clear();
    knexMock.mockClear();
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    initializeWorkflowRuntimeV2();
    ensureWorkflowRuntimeV2TestRegistrations();
  });

  it('T006: publish rejects time-triggered workflows when enterprise scheduling support is unavailable', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      })
    });

    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_ENTERPRISE_ONLY')).toBe(true);
  });

  it('T007: time-trigger publish resolves the fixed synthetic payload schema ref', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);
    expect(getSchemaRegistry().has(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF)).toBe(true);
    expect(workflowRecord?.payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
    expect(workflowRecord?.pinned_payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
    expect(versionRecords.get(1)?.definition_json.payloadSchemaRef).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
  });

  it('T009: publish rejects inferred payload schema mode for one-time schedule triggers', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'event',
        eventName: 'TEST_EVENT',
        sourcePayloadSchemaRef: TEST_SCHEMA_REF
      }),
      payloadSchemaMode: 'inferred'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'schedule',
          runAt: '2026-03-08T14:00:00.000Z'
        }),
        id: createResult.workflowId
      }
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_REQUIRES_PINNED_SCHEMA')).toBe(true);
  });

  it('T010: publish rejects inferred payload schema mode for recurring schedule triggers', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'event',
        eventName: 'TEST_EVENT',
        sourcePayloadSchemaRef: TEST_SCHEMA_REF
      }),
      payloadSchemaMode: 'inferred'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'recurring',
          cron: '0 9 * * 1-5',
          timezone: 'America/New_York'
        }),
        id: createResult.workflowId
      }
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_REQUIRES_PINNED_SCHEMA')).toBe(true);
  });

  it('T011: one-time schedule publish rejects missing runAt timestamp', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      })
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({ type: 'schedule' }),
        id: createResult.workflowId
      }
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_RUN_AT_REQUIRED')).toBe(true);
  });

  it('T012: one-time schedule publish rejects invalid timestamp values', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      })
    });

    const invalidResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'schedule',
          runAt: 'not-a-date'
        }),
        id: createResult.workflowId
      }
    });

    const pastResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'schedule',
          runAt: new Date(Date.now() - 60_000).toISOString()
        }),
        id: createResult.workflowId
      }
    });

    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_INVALID_RUN_AT')).toBe(true);
    expect(pastResult.ok).toBe(false);
    expect(pastResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_INVALID_RUN_AT' && String(error.message).includes('future'))).toBe(true);
  });

  it('T013: recurring schedule publish rejects cron expressions with six fields or seconds', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      })
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'recurring',
          cron: '0 0 12 * * *',
          timezone: 'America/New_York'
        }),
        id: createResult.workflowId
      }
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_INVALID_CRON')).toBe(true);
  });

  it('T014: recurring schedule publish rejects invalid timezone values', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      })
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1,
      definition: {
        ...buildDraftDefinition({
          type: 'recurring',
          cron: '15 9 * * 1-5',
          timezone: 'Mars/Olympus_Mons'
        }),
        id: createResult.workflowId
      }
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.errors?.some((error: any) => error.code === 'TIME_TRIGGER_INVALID_TIMEZONE')).toBe(true);
  });

  it('T015: recurring schedule publish accepts valid 5-field cron expressions', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      })
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);
    expect(versionRecords.get(1)?.definition_json.payloadSchemaRef).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
  });
});
