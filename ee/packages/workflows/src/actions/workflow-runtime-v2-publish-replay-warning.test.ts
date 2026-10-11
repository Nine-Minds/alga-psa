import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { hasPermission } from '@alga-psa/auth';

type RuntimeEventRow = {
  event_id: string;
  tenant: string;
  event_name: string;
  correlation_key?: string | null;
  payload?: Record<string, unknown> | null;
  payload_schema_ref?: string | null;
  created_at: string;
};

const fixture = vi.hoisted(() => ({
  tenant: 'tenant-a',
  events: [] as RuntimeEventRow[],
  workflow: null as Record<string, unknown> | null,
  latestError: null as Error | null,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
}));

const knexMock: any = vi.hoisted(() => vi.fn());
knexMock.schema = { hasTable: vi.fn(async () => false) };
knexMock.mockImplementation(() => {
  const q: any = {
    where: () => q,
    max: () => q,
    first: async () => ({ max_version: null })
  };
  return q;
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: fixture.tenant })),
  auditLog: vi.fn().mockResolvedValue(undefined),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any) => q
  })
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: unknown) =>
    fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: fixture.tenant }, input),
  hasPermission: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', user_type: 'internal', roles: [] }),
  preCheckDeletion: vi.fn()
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn()
}));

vi.mock('@alga-psa/analytics', () => ({
  analytics: { capture: vi.fn() }
}));

vi.mock('../models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => ({ payload_schema_ref: 'payload.Event.v1' }))
  }
}));

vi.mock('../lib/workflowScheduleLifecycle', () => ({
  buildDesiredWorkflowSchedule: vi.fn(),
  deleteWorkflowScheduleState: vi.fn(),
  revalidateExternalWorkflowSchedulesForPublishedVersion: vi.fn(),
  syncWorkflowScheduleState: vi.fn()
}));

vi.mock('../lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: vi.fn(),
  recordFailedWorkflowRunLaunch: vi.fn()
}));

vi.mock('../lib/workflowRuntimeV2Temporal', () => ({
  cancelWorkflowRuntimeV2TemporalRun: vi.fn(),
  signalWorkflowRuntimeV2Event: vi.fn(),
  signalWorkflowRuntimeV2HumanTask: vi.fn(),
  signalWorkflowRuntimeV2QuotaResume: vi.fn()
}));

vi.mock('../lib/workflowEventCorrelation', () => ({
  resolveWorkflowEventCorrelation: vi.fn(() => ({ key: 'corr-1', detail: 'ok' }))
}));

vi.mock('../lib/workflowTenantDb', () => ({
  workflowTenantDb: vi.fn((knex: any) => knex),
  workflowTenantTable: vi.fn((knex: any, _tenant: string, table: string) => knex(table))
}));

vi.mock('@alga-psa/workflows/secrets', () => ({
  createTenantSecretProvider: vi.fn()
}));

vi.mock('@alga-psa/workflows/persistence', () => {
  const emptyModel = new Proxy({}, { get: () => vi.fn() });
  return {
    WorkflowActionInvocationModelV2: emptyModel,
    WorkflowDataStoreModel: emptyModel,
    WorkflowDefinitionModelV2: {
      getById: vi.fn(async () => fixture.workflow),
      update: vi.fn(async (_knex: any, _tenant: string, _id: string, data: Record<string, unknown>) => {
        fixture.updated.push(data);
        return data;
      })
    },
    WorkflowDefinitionVersionModelV2: {
      create: vi.fn(async (_knex: any, data: Record<string, unknown>) => {
        fixture.created.push(data);
        return { ...data, version: data.version };
      })
    },
    WorkflowEntityLinkModel: emptyModel,
    WorkflowRunLogModelV2: emptyModel,
    WorkflowRunModelV2: emptyModel,
    WorkflowRunSnapshotModelV2: emptyModel,
    WorkflowRunStepModelV2: emptyModel,
    WorkflowRunWaitModelV2: emptyModel,
    WorkflowRuntimeEventModelV2: {
      getById: vi.fn(),
      getLatestByEventName: vi.fn(async (_knex: any, tenant: string, eventName: string) => {
        if (fixture.latestError) throw fixture.latestError;
        return fixture.events.find((event) => event.tenant === tenant && event.event_name === eventName) ?? null;
      })
    }
  };
});

vi.mock('@alga-psa/workflows/runtime', async () => ({
  workflowDefinitionSchema: z.record(z.any()),
  initializeWorkflowRuntimeV2: vi.fn(),
  getActionRegistryV2: vi.fn(() => ({ list: () => [] })),
  getNodeTypeRegistry: vi.fn(() => ({ list: () => [] })),
  getSchemaRegistry: vi.fn(() => ({
    has: (ref: string) => ref === 'payload.Event.v1' || ref === 'payload.Other.v1',
    get: () => z.object({ ticket_id: z.string() }),
    toJsonSchema: () => ({ type: 'object', properties: { ticket_id: { type: 'string' } } }),
    listRefs: () => ['payload.Event.v1', 'payload.Other.v1']
  })),
  applyRedactions: (await import('../../../../../shared/workflow/runtime/utils/redactionUtils')).applyRedactions,
  isWorkflowEventTrigger: vi.fn((trigger) => trigger?.type === 'event'),
  isWorkflowOneTimeScheduleTrigger: vi.fn(() => false),
  isWorkflowRecurringScheduleTrigger: vi.fn(() => false),
  isWorkflowTimeTrigger: vi.fn((trigger) => trigger?.type === 'time'),
  resolveActionCallOutputSchema: vi.fn(() => null),
  buildWorkflowDesignerActionCatalog: vi.fn(() => []),
  getWorkflowIntegrationModuleRegistry: vi.fn(() => ({ list: () => [] })),
  resolveAvailableIntegrationModuleKeys: vi.fn(async () => new Set()),
  zodToWorkflowJsonSchema: vi.fn(() => ({})),
  validateWorkflowDefinition: vi.fn(() => ({ errors: [], warnings: [], secretRefs: new Set<string>() })),
  validateInputMapping: vi.fn(() => ({ ok: true, errors: [], warnings: [], secretRefs: [] })),
  resolveInputMapping: vi.fn(async () => ({})),
  createSecretResolverFromProvider: vi.fn(() => vi.fn()),
  verifySecretsExist: vi.fn(async () => ({ missing: [] })),
  simulateWorkflowDefinition: vi.fn(),
  applyTriggerPayloadMapping: vi.fn(async ({ definition, eventPayload }: any) => {
    if (definition.trigger?.payloadMapping) {
      return { payload: { ticket_id: eventPayload.ticket_id }, mappingApplied: true };
    }
    return { payload: eventPayload, mappingApplied: false };
  }),
  buildSampleFromJsonSchema: vi.fn(() => ({})),
  buildWorkflowAuthoringGuide: vi.fn(() => ({})),
  didYouMean: vi.fn(() => [])
}));

import { WorkflowRuntimeEventModelV2 } from '@alga-psa/workflows/persistence';
import { validateWorkflowDefinition } from '@alga-psa/workflows/runtime';
import { publishWorkflowDefinitionAction } from './workflow-runtime-v2-actions';

const eventTriggerDefinition = {
  id: 'wf-1',
  version: 1,
  name: 'Publish replay workflow',
  payloadSchemaRef: 'payload.Event.v1',
  trigger: { type: 'event', eventName: 'ticket.created' },
  steps: []
};

const eventRow = (overrides: Partial<RuntimeEventRow> = {}): RuntimeEventRow => ({
  event_id: '11111111-1111-4111-8111-111111111111',
  tenant: 'tenant-a',
  event_name: 'ticket.created',
  payload: { ticket_id: 'ticket-1' },
  payload_schema_ref: 'payload.Event.v1',
  created_at: '2026-07-16T12:00:00.000Z',
  ...overrides
});

const publish = (definition: Record<string, unknown> = eventTriggerDefinition) =>
  publishWorkflowDefinitionAction({ workflowId: 'wf-1', version: 1, definition }) as Promise<any>;

describe('publishWorkflowDefinitionAction latest-event replay warning', () => {
  beforeEach(() => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    fixture.tenant = 'tenant-a';
    fixture.events = [];
    fixture.latestError = null;
    fixture.created = [];
    fixture.updated = [];
    fixture.workflow = {
      workflow_id: 'wf-1',
      tenant: 'tenant-a',
      payload_schema_mode: 'pinned',
      draft_definition: eventTriggerDefinition,
      is_paused: false
    };
    vi.mocked(WorkflowRuntimeEventModelV2.getLatestByEventName).mockClear();
    vi.mocked(validateWorkflowDefinition).mockReturnValue({ errors: [], warnings: [], secretRefs: new Set<string>() } as any);
  });

  it('warns (without blocking) when the latest stored event carries a different source schema ref', async () => {
    fixture.events = [eventRow({ payload_schema_ref: 'payload.Other.v1' })];

    const result = await publish();

    expect(result.ok).toBe(true);
    const warning = result.warnings.find((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP');
    expect(warning).toBeDefined();
    expect(warning.severity).toBe('warning');
    expect(warning.stepPath).toBe('root.trigger');
    expect(warning.message).toContain('Production would skip this event');
    expect(warning.message).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('adds no warning when the latest event matches', async () => {
    fixture.events = [eventRow()];
    const result = await publish();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP')).toBe(false);
  });

  it('adds no warning when no event is stored', async () => {
    const result = await publish();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP')).toBe(false);
  });

  it('warns when the latest event payload fails the workflow payload schema', async () => {
    fixture.events = [eventRow({ payload: { other: 1 } })];
    const result = await publish();
    expect(result.ok).toBe(true);
    const warning = result.warnings.find((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP');
    expect(warning?.message).toContain('failed workflow payload schema');
  });

  it('never blocks the publish when the event lookup throws', async () => {
    fixture.latestError = new Error('db down');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await publish();
    consoleError.mockRestore();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP')).toBe(false);
  });

  it('does not attempt the replay when validation returned errors', async () => {
    vi.mocked(validateWorkflowDefinition).mockReturnValue({
      errors: [{ severity: 'error', stepPath: 'root', code: 'X', message: 'bad' }],
      warnings: [],
      secretRefs: new Set<string>()
    } as any);
    fixture.events = [eventRow({ payload_schema_ref: 'payload.Other.v1' })];
    const result = await publish();
    expect(result.ok).toBe(false);
    expect(WorkflowRuntimeEventModelV2.getLatestByEventName).not.toHaveBeenCalled();
  });

  it('does not attempt the replay for a non-event trigger', async () => {
    fixture.events = [eventRow({ payload_schema_ref: 'payload.Other.v1' })];
    const result = await publish({ ...eventTriggerDefinition, trigger: { type: 'time' } });
    expect(result.ok).toBe(true);
    expect(WorkflowRuntimeEventModelV2.getLatestByEventName).not.toHaveBeenCalled();
  });

  it('does not persist the replay warning on the version record or the workflow', async () => {
    fixture.events = [eventRow({ payload_schema_ref: 'payload.Other.v1' })];
    const result = await publish();
    expect(result.warnings.some((w: any) => w.code === 'LATEST_EVENT_WOULD_SKIP')).toBe(true);
    expect(fixture.created).toHaveLength(1);
    expect(JSON.stringify(fixture.created[0].validation_warnings)).not.toContain('LATEST_EVENT_WOULD_SKIP');
    expect(JSON.stringify(fixture.updated[0].validation_warnings)).not.toContain('LATEST_EVENT_WOULD_SKIP');
  });
});
