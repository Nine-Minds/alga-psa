import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
  simulatedCalls: [] as Array<{ payload: unknown }>,
  run: {
    run_id: 'run-1',
    tenant: 'tenant-a',
  } as Record<string, unknown>,
  steps: [] as Array<Record<string, unknown>>,
  snapshots: [] as Array<Record<string, unknown>>,
  invocations: [] as Array<Record<string, unknown>>,
  waits: [] as Array<Record<string, unknown>>,
}));

const knexMock: any = vi.hoisted(() => vi.fn());
knexMock.schema = { hasTable: vi.fn(async () => false) };

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
  const byNewest = (a: RuntimeEventRow, b: RuntimeEventRow) => {
    const created = b.created_at.localeCompare(a.created_at);
    return created !== 0 ? created : b.event_id.localeCompare(a.event_id);
  };
  return {
    WorkflowActionInvocationModelV2: {
      listByRun: vi.fn(async () => fixture.invocations),
    },
    WorkflowDataStoreModel: emptyModel,
    WorkflowDefinitionModelV2: emptyModel,
    WorkflowDefinitionVersionModelV2: emptyModel,
    WorkflowEntityLinkModel: emptyModel,
    WorkflowRunLogModelV2: emptyModel,
    WorkflowRunModelV2: {
      getById: vi.fn(async () => fixture.run),
    },
    WorkflowRunSnapshotModelV2: {
      listByRun: vi.fn(async () => fixture.snapshots),
    },
    WorkflowRunStepModelV2: {
      listByRun: vi.fn(async () => fixture.steps),
    },
    WorkflowRunWaitModelV2: {
      listByRun: vi.fn(async () => fixture.waits),
    },
    WorkflowRuntimeEventModelV2: {
      getById: vi.fn(async (_knex: any, eventId: string, tenant: string) =>
        fixture.events.find((event) => event.event_id === eventId && event.tenant === tenant) ?? null
      ),
      getLatestByEventName: vi.fn(async (_knex: any, tenant: string, eventName: string) =>
        [...fixture.events]
          .filter((event) => event.tenant === tenant && event.event_name === eventName)
          .sort(byNewest)[0] ?? null
      )
    }
  };
});

vi.mock('@alga-psa/workflows/runtime', () => ({
  workflowDefinitionSchema: z.record(z.any()),
  initializeWorkflowRuntimeV2: vi.fn(),
  getActionRegistryV2: vi.fn(() => ({ list: () => [] })),
  getNodeTypeRegistry: vi.fn(() => ({ list: () => [] })),
  getSchemaRegistry: vi.fn(() => ({
    has: (ref: string) => ref === 'payload.Workflow.v1' || ref === 'payload.Event.v1',
    get: (ref: string) => {
      if (ref === 'payload.Workflow.v1') return z.object({ ticketId: z.string() });
      return z.record(z.any());
    },
    toJsonSchema: (ref: string) =>
      ref === 'payload.Event.v1'
        ? { type: 'object', properties: { ticket_id: { type: 'string' } } }
        : { type: 'object', properties: { ticketId: { type: 'string' } } },
    listRefs: () => ['payload.Workflow.v1', 'payload.Event.v1']
  })),
  applyRedactions: vi.fn((input) => input),
  isWorkflowEventTrigger: vi.fn((trigger) => trigger?.type === 'event'),
  isWorkflowOneTimeScheduleTrigger: vi.fn(() => false),
  isWorkflowRecurringScheduleTrigger: vi.fn(() => false),
  isWorkflowTimeTrigger: vi.fn(() => false),
  resolveActionCallOutputSchema: vi.fn(() => null),
  buildWorkflowDesignerActionCatalog: vi.fn(() => []),
  getWorkflowIntegrationModuleRegistry: vi.fn(() => ({ list: () => [] })),
  resolveAvailableIntegrationModuleKeys: vi.fn(async () => new Set()),
  zodToWorkflowJsonSchema: vi.fn(() => ({})),
  validateWorkflowDefinition: vi.fn(() => ({ errors: [], warnings: [] })),
  validateInputMapping: vi.fn(() => ({ ok: true, errors: [] })),
  resolveInputMapping: vi.fn(async () => ({})),
  createSecretResolverFromProvider: vi.fn(() => vi.fn()),
  verifySecretsExist: vi.fn(async () => ({ missing: [] })),
  simulateWorkflowDefinition: vi.fn(async ({ payload }: { payload: Record<string, unknown> }) => {
    fixture.simulatedCalls.push({ payload });
    return {
      status: 'completed',
      trace: [],
      finalVars: {},
      finalPayload: payload,
      invocations: [],
      errors: [],
      warnings: []
    };
  }),
  applyTriggerPayloadMapping: vi.fn(async ({ definition, eventPayload }: any) => {
    if (definition.trigger?.payloadMapping) {
      return { payload: { ticketId: eventPayload.ticket_id }, mappingApplied: true };
    }
    return { payload: eventPayload, mappingApplied: false };
  }),
  buildSampleFromJsonSchema: vi.fn(() => ({ ticket_id: 'sample-ticket' })),
  buildWorkflowAuthoringGuide: vi.fn(() => ({})),
  didYouMean: vi.fn(() => [])
}));

import { listWorkflowRunStepsAction, simulateWorkflowDefinitionDraftAction } from './workflow-runtime-v2-actions';

const definition = {
  id: 'wf-1',
  version: 1,
  name: 'Replay test workflow',
  payloadSchemaRef: 'payload.Workflow.v1',
  trigger: {
    type: 'event',
    eventName: 'ticket.created',
    sourcePayloadSchemaRef: 'payload.Event.v1',
    payloadMapping: {
      ticketId: { $expr: 'event.payload.ticket_id' }
    }
  },
  steps: []
};

const eventRow = (overrides: Partial<RuntimeEventRow>): RuntimeEventRow => ({
  event_id: '11111111-1111-4111-8111-111111111111',
  tenant: 'tenant-a',
  event_name: 'ticket.created',
  correlation_key: 'corr-1',
  payload: { ticket_id: 'ticket-1' },
  payload_schema_ref: 'payload.Event.v1',
  created_at: '2026-07-16T12:00:00.000Z',
  ...overrides
});

describe('simulateWorkflowDefinitionDraftAction replay payload resolution', () => {
  beforeEach(() => {
    fixture.tenant = 'tenant-a';
    fixture.events = [];
    fixture.simulatedCalls = [];
    fixture.run = {
      run_id: 'run-1',
      tenant: 'tenant-a',
    };
    fixture.steps = [];
    fixture.snapshots = [];
    fixture.invocations = [];
    fixture.waits = [];
    knexMock.mockClear();
    knexMock.schema.hasTable.mockClear();
  });

  it('replays a stored event by eventId and reports replay metadata', async () => {
    fixture.events = [eventRow({ event_id: '11111111-1111-4111-8111-111111111111' })];

    const result = await simulateWorkflowDefinitionDraftAction({
      definition,
      eventId: '11111111-1111-4111-8111-111111111111'
    }) as any;

    expect(result.status).toBe('completed');
    expect(result.payloadSource).toBe('replayed-event');
    expect(result.triggerMappingApplied).toBe(true);
    expect(result.simulatedPayload).toEqual({ ticketId: 'ticket-1' });
    expect(result.replayedEvent).toEqual({
      event_id: '11111111-1111-4111-8111-111111111111',
      event_type: 'ticket.created',
      occurred_at: '2026-07-16T12:00:00.000Z'
    });
  });

  it('useLatestEvent selects the newest event for the tenant and trigger event type', async () => {
    fixture.events = [
      eventRow({
        event_id: '11111111-1111-4111-8111-111111111111',
        payload: { ticket_id: 'older' },
        created_at: '2026-07-16T10:00:00.000Z'
      }),
      eventRow({
        event_id: '22222222-2222-4222-8222-222222222222',
        payload: { ticket_id: 'newer' },
        created_at: '2026-07-16T11:00:00.000Z'
      }),
      eventRow({
        event_id: '33333333-3333-4333-8333-333333333333',
        tenant: 'tenant-b',
        payload: { ticket_id: 'wrong-tenant' },
        created_at: '2026-07-16T12:00:00.000Z'
      }),
      eventRow({
        event_id: '44444444-4444-4444-8444-444444444444',
        event_name: 'ticket.updated',
        payload: { ticket_id: 'wrong-type' },
        created_at: '2026-07-16T13:00:00.000Z'
      })
    ];

    const result = await simulateWorkflowDefinitionDraftAction({ definition, useLatestEvent: true }) as any;

    expect(result.simulatedPayload).toEqual({ ticketId: 'newer' });
    expect(result.replayedEvent?.event_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('returns a failed simulation result when the replayed event cannot satisfy the workflow payload schema', async () => {
    fixture.events = [
      eventRow({
        event_id: '55555555-5555-4555-8555-555555555555',
        payload: { other_field: 'not mapped' }
      })
    ];

    const result = await simulateWorkflowDefinitionDraftAction({
      definition,
      eventId: '55555555-5555-4555-8555-555555555555'
    }) as any;

    expect(result.status).toBe('failed');
    expect(result.payloadSource).toBe('replayed-event');
    expect(result.errors[0]?.message).toContain('failed workflow payload schema');
    expect(result.warnings[0]?.message).toContain('failed workflow payload schema');
    expect(fixture.simulatedCalls).toHaveLength(0);
  });

  it('fails replay when production would skip the launch (no mapping, mismatched schema refs)', async () => {
    fixture.events = [eventRow({ event_id: '66666666-6666-4666-8666-666666666666' })];
    const unmappedDefinition = {
      ...definition,
      trigger: {
        type: 'event',
        eventName: 'ticket.created',
        sourcePayloadSchemaRef: 'payload.Event.v1'
      }
    };

    const result = await simulateWorkflowDefinitionDraftAction({
      definition: unmappedDefinition,
      eventId: '66666666-6666-4666-8666-666666666666'
    }) as any;

    expect(result.status).toBe('failed');
    expect(result.payloadSource).toBe('replayed-event');
    expect(result.errors[0]?.message).toContain('Production would skip this event');
    expect(result.replayedEvent?.event_id).toBe('66666666-6666-4666-8666-666666666666');
    expect(fixture.simulatedCalls).toHaveLength(0);
  });

  it('rejects explicit payload combined with eventId', async () => {
    await expect(simulateWorkflowDefinitionDraftAction({
      definition,
      payload: { ticketId: 'ticket-explicit' },
      eventId: '11111111-1111-4111-8111-111111111111'
    })).rejects.toThrow(/either payload or eventId\/useLatestEvent/i);
  });

  it('adds a warning when the payload is synthesized from schema', async () => {
    const result = await simulateWorkflowDefinitionDraftAction({ definition }) as any;

    expect(result.payloadSource).toBe('synthesized-from-event');
    expect(result.warnings).toContainEqual({
      message: 'payload synthesized from schema; no real event of this type has been validated against this definition — consider useLatestEvent: true'
    });
    expect(result.replayedEvent).toBeNull();
  });

  it('includes structured invocation error_json in run step details', async () => {
    fixture.invocations = [{
      invocation_id: 'invocation-1',
      run_id: 'run-1',
      tenant: 'tenant-a',
      step_path: 'root.steps[0]',
      action_id: 'integration.call',
      action_version: 1,
      idempotency_key: 'tenant-a:key-1',
      status: 'FAILED',
      attempt: 1,
      input_json: null,
      output_json: null,
      error_message: 'Provider rate limit exceeded',
      error_json: {
        category: 'IntegrationError',
        code: 'RATE_LIMITED',
        message: 'Provider rate limit exceeded',
        details: {
          apiKey: 'stored-secret',
        },
        nodePath: 'root.steps[0]',
        at: '2026-07-16T12:00:00.000Z',
      },
      created_at: '2026-07-16T12:00:00.000Z',
    }];

    const result = await listWorkflowRunStepsAction({ runId: 'run-1' }) as any;

    expect(result.invocations[0].error_json).toEqual({
      category: 'IntegrationError',
      code: 'RATE_LIMITED',
      message: 'Provider rate limit exceeded',
      details: {
        apiKey: '[REDACTED]',
      },
      nodePath: 'root.steps[0]',
      at: '2026-07-16T12:00:00.000Z',
    });
  });
});
