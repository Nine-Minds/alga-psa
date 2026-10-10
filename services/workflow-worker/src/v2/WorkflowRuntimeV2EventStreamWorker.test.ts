import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  redisInitializeMock,
  redisRegisterConsumerMock,
  redisCloseMock,
  workflowEventParseMock,
  initializeWorkflowRuntimeV2Mock,
  workflowRuntimeEventGetByIdMock,
  workflowRuntimeEventCreateMock,
  workflowRuntimeEventUpdateMock,
  workflowRunWaitListEventWaitCandidatesMock,
  workflowRunGetByIdMock,
  workflowDefinitionListMock,
  workflowDefinitionVersionListByWorkflowMock,
  launchPublishedWorkflowRunMock,
  signalWorkflowRuntimeV2EventMock,
  signalWorkflowRuntimeV2HumanTaskMock,
  resolveInputMappingMock,
  getAdminConnectionMock,
  schemaRegistryHasMock,
  schemaRegistryGetMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerDebugMock,
  loggerErrorMock,
  insertOutboxRowMock
} = vi.hoisted(() => ({
  redisInitializeMock: vi.fn(async () => undefined),
  redisRegisterConsumerMock: vi.fn(),
  redisCloseMock: vi.fn(async () => undefined),
  workflowEventParseMock: vi.fn((value) => value),
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  workflowRuntimeEventGetByIdMock: vi.fn(),
  workflowRuntimeEventCreateMock: vi.fn(),
  workflowRuntimeEventUpdateMock: vi.fn(async () => undefined),
  workflowRunWaitListEventWaitCandidatesMock: vi.fn(),
  workflowRunGetByIdMock: vi.fn(),
  workflowDefinitionListMock: vi.fn(),
  workflowDefinitionVersionListByWorkflowMock: vi.fn(),
  launchPublishedWorkflowRunMock: vi.fn(),
  signalWorkflowRuntimeV2EventMock: vi.fn(async () => undefined),
  signalWorkflowRuntimeV2HumanTaskMock: vi.fn(async () => undefined),
  resolveInputMappingMock: vi.fn(),
  getAdminConnectionMock: vi.fn(),
  schemaRegistryHasMock: vi.fn(),
  schemaRegistryGetMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  insertOutboxRowMock: vi.fn(async () => undefined)
}));

let registeredConsumer: ((event: unknown) => Promise<void>) | null = null;

vi.mock('@shared/core/logger.js', () => ({
  default: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    debug: (...args: unknown[]) => loggerDebugMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args),
  }
}));

vi.mock('@shared/db/admin.js', () => ({
  getAdminConnection: (...args: unknown[]) => getAdminConnectionMock(...args)
}));

// Must match the worker's import specifier exactly, or the real
// RedisStreamClient is constructed and dials Redis.
vi.mock('@alga-psa/shared/workflow/streams/index.js', () => ({
  RedisStreamClient: class {
    async initialize() {
      return redisInitializeMock();
    }

    registerConsumer(stream: string, consumer: (event: unknown) => Promise<void>) {
      registeredConsumer = consumer;
      return redisRegisterConsumerMock(stream, consumer);
    }

    async close() {
      return redisCloseMock();
    }
  },
  WorkflowEventBaseSchema: {
    parse: (...args: unknown[]) => workflowEventParseMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/runtime/core', () => ({
  initializeWorkflowRuntimeV2: (...args: unknown[]) => initializeWorkflowRuntimeV2Mock(...args),
  getSchemaRegistry: () => ({
    has: (...args: unknown[]) => schemaRegistryHasMock(...args),
    get: (...args: unknown[]) => schemaRegistryGetMock(...args)
  }),
  isWorkflowEventTrigger: (trigger: any) => Boolean(trigger && typeof trigger === 'object' && trigger.type === 'event' && typeof trigger.eventName === 'string'),
  resolveInputMapping: (...args: unknown[]) => resolveInputMappingMock(...args),
  createSecretResolverFromProvider: vi.fn((resolver: unknown) => resolver)
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  listPublishedWorkflowDefinitions: async (knex: unknown, tenantId: string) => {
    const workflows = (await workflowDefinitionListMock(knex, tenantId)) as any[];
    const results = await Promise.all(
      workflows
        .filter((workflow) => workflow.status === 'published')
        .map(async (workflow) => {
          const [latestVersion] = (await workflowDefinitionVersionListByWorkflowMock(knex, workflow.workflow_id)) as any[];
          return latestVersion ? { workflow, latestVersion, definition: latestVersion.definition_json ?? null } : null;
        })
    );
    return results.filter((result) => result !== null);
  },
  WorkflowDefinitionModelV2: {
    list: (...args: unknown[]) => workflowDefinitionListMock(...args)
  },
  WorkflowDefinitionVersionModelV2: {
    listByWorkflow: (...args: unknown[]) => workflowDefinitionVersionListByWorkflowMock(...args)
  },
  WorkflowRuntimeEventModelV2: {
    getById: (...args: unknown[]) => workflowRuntimeEventGetByIdMock(...args),
    create: (...args: unknown[]) => workflowRuntimeEventCreateMock(...args),
    update: (...args: unknown[]) => workflowRuntimeEventUpdateMock(...args)
  },
  WorkflowRunWaitModelV2: {
    listEventWaitCandidates: (...args: unknown[]) => workflowRunWaitListEventWaitCandidatesMock(...args)
  },
  WorkflowRunModelV2: {
    getById: (...args: unknown[]) => workflowRunGetByIdMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRunMock(...args)
}));

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  signalWorkflowRuntimeV2Event: (...args: unknown[]) => signalWorkflowRuntimeV2EventMock(...args),
  signalWorkflowRuntimeV2HumanTask: (...args: unknown[]) => signalWorkflowRuntimeV2HumanTaskMock(...args)
}));

vi.mock('@alga-psa/workflows/secrets', () => ({
  createTenantSecretProvider: vi.fn(() => ({
    getValue: vi.fn(async () => null)
  }))
}));

vi.mock('../../../../shared/services/email/inboundEmailDurableStore', () => ({
  insertOutboxRow: (...args: unknown[]) => insertOutboxRowMock(...args)
}));

import { convertToWorkflowEvent } from '../../../../packages/event-schemas/src/schemas/eventBusSchema';
import { workflowEventPayloadSchemas } from '../../../../packages/event-schemas/src/schemas/domain/workflowEventPayloadSchemas';
import { InboundEmailOutboxEventPublisher } from '../../../../shared/workflow/adapters/inboundEmailOutboxEventPublisher';
import { WorkflowRuntimeV2EventStreamWorker } from './WorkflowRuntimeV2EventStreamWorker';

let catalogSchemaRef = 'payload.WorkflowEvent.v1';

const knexMock: any = (table: string) => {
  if (table === 'event_catalog' || table === 'system_event_catalog') {
    return {
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({ payload_schema_ref: catalogSchemaRef })),
    };
  }

  throw new Error(`Unexpected table access: ${table}`);
};

describe('WorkflowRuntimeV2EventStreamWorker', () => {
  beforeEach(() => {
    delete process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON;
    registeredConsumer = null;
    catalogSchemaRef = 'payload.WorkflowEvent.v1';
    insertOutboxRowMock.mockClear();

    redisInitializeMock.mockReset();
    redisRegisterConsumerMock.mockReset();
    redisCloseMock.mockReset();
    workflowEventParseMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    workflowRuntimeEventGetByIdMock.mockReset();
    workflowRuntimeEventCreateMock.mockReset();
    workflowRuntimeEventUpdateMock.mockReset();
    workflowRunWaitListEventWaitCandidatesMock.mockReset();
    workflowRunGetByIdMock.mockReset();
    workflowDefinitionListMock.mockReset();
    workflowDefinitionVersionListByWorkflowMock.mockReset();
    launchPublishedWorkflowRunMock.mockReset();
    signalWorkflowRuntimeV2EventMock.mockReset();
    signalWorkflowRuntimeV2HumanTaskMock.mockReset();
    resolveInputMappingMock.mockReset();
    getAdminConnectionMock.mockReset();
    schemaRegistryHasMock.mockReset();
    schemaRegistryGetMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerDebugMock.mockReset();
    loggerErrorMock.mockReset();

    workflowEventParseMock.mockImplementation((value) => value);
    workflowRuntimeEventGetByIdMock.mockResolvedValue(null);
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-1' });
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-1',
        status: 'published',
        trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' }
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockResolvedValue([
      {
        version: 7,
        definition_json: {
          id: 'workflow-1',
          version: 7,
          payloadSchemaRef: 'payload.WorkflowEvent.v1',
          trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' },
          steps: []
        }
      }
    ]);
    launchPublishedWorkflowRunMock.mockResolvedValue({ runId: 'run-1', workflowVersion: 7 });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([
      {
        wait_id: 'wait-1',
        run_id: 'run-wait-1',
        wait_type: 'event',
        payload: null,
      },
      {
        wait_id: 'wait-2',
        run_id: 'run-wait-2',
        wait_type: 'event',
        payload: null,
      }
    ]);
    workflowRunGetByIdMock.mockResolvedValue({ engine: 'temporal' });
    getAdminConnectionMock.mockResolvedValue(knexMock);
    schemaRegistryHasMock.mockReturnValue(true);
    schemaRegistryGetMock.mockReturnValue({
      safeParse: () => ({ success: true })
    });
    resolveInputMappingMock.mockResolvedValue({});
  });

  it('T031: starts the stream consumer and ingests matching events into workflow launches', async () => {
    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');

    await worker.start();

    expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
    expect(redisInitializeMock).toHaveBeenCalledTimes(1);
    expect(redisRegisterConsumerMock).toHaveBeenCalledWith('global', expect.any(Function));
    expect(registeredConsumer).not.toBeNull();

    await registeredConsumer?.({
      event_id: 'event-1',
      event_type: 'PING',
      workflow_correlation_key: 'corr-1',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRuntimeEventCreateMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        event_id: 'event-1',
        tenant: 'tenant-1',
        event_name: 'PING',
        correlation_key: 'corr-1',
        payload: { foo: 'bar' },
        payload_schema_ref: 'payload.WorkflowEvent.v1'
      })
    );
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflowId: 'workflow-1',
        workflowVersion: 7,
        tenantId: 'tenant-1',
        payload: { foo: 'bar' },
        triggerType: 'event',
        eventType: 'PING',
        sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1',
        triggerMappingApplied: false
      })
    );
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({
        matched_run_id: 'run-wait-1'
      })
   ,
      'tenant-1'
    );
    expect(workflowRunWaitListEventWaitCandidatesMock).toHaveBeenCalledWith(
      knexMock,
      'PING',
      'corr-1',
      'tenant-1',
      ['event', 'human']
    );
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(2);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: 'run-wait-1',
        eventId: 'event-1',
        eventName: 'PING',
        correlationKey: 'corr-1',
      })
    );
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: 'run-wait-2',
        eventId: 'event-1',
        eventName: 'PING',
        correlationKey: 'corr-1',
      })
    );

    await worker.stop();
    expect(redisCloseMock).toHaveBeenCalledTimes(1);
  });

  describe('workflow lineage guard', () => {
    const fire = async (payload: Record<string, unknown>) => {
      const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
      await worker.start();
      await registeredConsumer?.({
        event_id: 'event-1',
        event_type: 'PING',
        workflow_correlation_key: 'corr-1',
        tenant: 'tenant-1',
        payload,
      });
      await worker.stop();
    };

    it('skips a workflow whose id is already in the event lineage and warns', async () => {
      workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
      await fire({ foo: 'bar', workflowLineage: ['workflow-1'] });

      expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining('already in the event lineage'),
        expect.objectContaining({ workflowId: 'workflow-1', workflowLineage: ['workflow-1'] })
      );
      expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
        knexMock,
        'event-1',
        expect.objectContaining({
          error_message: expect.stringContaining('workflow is already in the event lineage (trigger loop guard)'),
        }),
        'tenant-1'
      );
    });

    it('still launches a workflow that is not in the lineage and records the lineage on the run', async () => {
      await fire({ foo: 'bar', workflowLineage: ['workflow-upstream'] });

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
        knexMock,
        expect.objectContaining({
          workflowId: 'workflow-1',
          triggerMetadata: expect.objectContaining({ workflowLineage: ['workflow-upstream'] }),
        })
      );
    });

    it('adds no workflowLineage to trigger metadata for events without one', async () => {
      await fire({ foo: 'bar' });

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
      const arg = launchPublishedWorkflowRunMock.mock.calls[0][1];
      expect(arg.triggerMetadata).not.toHaveProperty('workflowLineage');
    });
  });

  it('ignores duplicate ingested events without relaunching workflows', async () => {
    workflowRuntimeEventGetByIdMock.mockResolvedValueOnce({ event_id: 'event-1' });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-1',
      event_type: 'PING',
      workflow_correlation_key: 'corr-1',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRuntimeEventCreateMock).not.toHaveBeenCalled();
    expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
    expect(signalWorkflowRuntimeV2EventMock).not.toHaveBeenCalled();
  });

  describe('workflow self-trigger guard', () => {
    const baseEvent = {
      event_id: 'event-1',
      event_type: 'PING',
      workflow_correlation_key: 'corr-1',
      tenant: 'tenant-1',
      payload: { foo: 'bar' },
    };

    async function deliver(event: Record<string, unknown>) {
      workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
      const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
      await worker.start();
      await registeredConsumer?.({ ...baseEvent, ...event });
      await worker.stop();
    }

    it('does not launch a workflow from an event published by its own run', async () => {
      workflowRunGetByIdMock.mockResolvedValue({ run_id: 'run-origin', workflow_id: 'workflow-1', trigger_metadata_json: null });

      await deliver({ execution_id: 'run-origin' });

      expect(workflowRunGetByIdMock).toHaveBeenCalledWith(knexMock, 'run-origin', 'tenant-1');
      expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining('Skipping workflow launch'),
        expect.objectContaining({ workflowId: 'workflow-1', reason: 'self_trigger' })
      );
      expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
        knexMock,
        'event-1',
        expect.objectContaining({
          error_message: expect.stringContaining('published by a run of this same workflow'),
        }),
        'tenant-1'
      );
    });

    it('launches a workflow for another definition and carries causationDepth in trigger metadata', async () => {
      workflowRunGetByIdMock.mockResolvedValue({
        run_id: 'run-origin',
        workflow_id: 'other-workflow',
        trigger_metadata_json: { causationDepth: 2 },
      });

      await deliver({ execution_id: 'run-origin' });

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
        knexMock,
        expect.objectContaining({
          workflowId: 'workflow-1',
          triggerMetadata: expect.objectContaining({ causationDepth: 3 }),
        })
      );
    });

    it('refuses chains deeper than the causation cap', async () => {
      workflowRunGetByIdMock.mockResolvedValue({
        run_id: 'run-origin',
        workflow_id: 'other-workflow',
        trigger_metadata_json: { causationDepth: 5 },
      });

      await deliver({ execution_id: 'run-origin' });

      expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining('Skipping workflow launch'),
        expect.objectContaining({ reason: 'causation_depth_exceeded', causationDepth: 6 })
      );
      expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
        knexMock,
        'event-1',
        expect.objectContaining({
          error_message: expect.stringContaining('deeper than the causation limit (depth 6'),
        }),
        'tenant-1'
      );
    });

    it('launches normally without an origin run and omits causationDepth', async () => {
      await deliver({});

      expect(workflowRunGetByIdMock).not.toHaveBeenCalled();
      const args = launchPublishedWorkflowRunMock.mock.calls[0][1];
      expect(args.triggerMetadata).not.toHaveProperty('causationDepth');
    });

    it('launches when the origin run id is unknown', async () => {
      workflowRunGetByIdMock.mockResolvedValue(null);

      await deliver({ execution_id: 'ghost-run' });

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
    });
  });

  it('derives correlation key from configured payload paths when explicit key is absent', async () => {
    process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = JSON.stringify({
      PING: ['ticket.id']
    });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-2',
      event_type: 'PING',
      tenant: 'tenant-1',
      payload: { workflowCorrelationKey: 'wrong-key', ticket: { id: 'ticket-42' } }
    });

    expect(workflowRuntimeEventCreateMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        event_id: 'event-2',
        correlation_key: 'ticket-42'
      })
    );
    expect(workflowRunWaitListEventWaitCandidatesMock).toHaveBeenCalledWith(
      knexMock,
      'PING',
      'ticket-42',
      'tenant-1',
      ['event', 'human']
    );
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-2',
        correlationKey: 'ticket-42'
      })
    );
  });

  it('records a clear audit error and skips wait routing when correlation cannot be resolved', async () => {
    process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = JSON.stringify({
      PING: ['ticket.id']
    });
    workflowDefinitionListMock.mockResolvedValue([]);
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-3' });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-3',
      event_type: 'PING',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRunWaitListEventWaitCandidatesMock).not.toHaveBeenCalled();
    expect(signalWorkflowRuntimeV2EventMock).not.toHaveBeenCalled();
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-3',
      expect.objectContaining({
        error_message: expect.stringContaining('Missing workflow correlation key')
      })
   ,
      'tenant-1'
    );
  });

  it('does not persist a correlation error when wait routing is skipped but the event still starts matching workflows', async () => {
    process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = JSON.stringify({
      PING: ['ticket.id']
    });
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-4' });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-4',
      event_type: 'PING',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRunWaitListEventWaitCandidatesMock).not.toHaveBeenCalled();
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-4',
      expect.objectContaining({
        matched_run_id: 'run-1'
      })
   ,
      'tenant-1'
    );
    expect(
      workflowRuntimeEventUpdateMock.mock.calls.some(([, eventId, patch]) => {
        return eventId === 'event-4' && patch && typeof patch === 'object' && 'error_message' in (patch as Record<string, unknown>);
      })
    ).toBe(false);
  });

  it('logs and persists payload validation failures before skipping workflow launch', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-validation' });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-1',
        key: 'workflow-key',
        status: 'published',
        trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' }
      }
    ]);
    schemaRegistryGetMock.mockReturnValue({
      safeParse: () => ({
        success: false,
        error: {
          issues: [
            {
              path: ['occurredAt'],
              code: 'invalid_type',
              message: 'Required',
            },
          ],
        },
      }),
    });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-validation',
      event_type: 'PING',
      workflow_correlation_key: 'corr-validation',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[WorkflowRuntimeV2EventStreamWorker] Payload validation failed; skipping workflow launch',
      expect.objectContaining({
        eventType: 'PING',
        workflowId: 'workflow-1',
        workflowKey: 'workflow-key',
        payloadSchemaRef: 'payload.WorkflowEvent.v1',
        issues: [
          {
            path: 'occurredAt',
            code: 'invalid_type',
            message: 'Required',
          },
        ],
      })
    );
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-validation',
      expect.objectContaining({
        error_message: expect.stringContaining('Payload validation failed for workflow workflow-key'),
      }),
      'tenant-1'
    );
  });

  it('persists a schema-mismatch skip onto the event row instead of skipping silently (alga-2026-0002379)', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-mismatch' });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-mismatch',
        key: 'workflow-mismatch-key',
        status: 'published',
        trigger: { type: 'event', eventName: 'PING' }
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockResolvedValue([
      {
        version: 1,
        definition_json: {
          id: 'workflow-mismatch',
          version: 1,
          payloadSchemaRef: 'payload.Other.v1',
          trigger: { type: 'event', eventName: 'PING' },
          steps: []
        }
      }
    ]);
    schemaRegistryHasMock.mockReturnValue(true);

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-mismatch',
      event_type: 'PING',
      workflow_correlation_key: 'corr-mismatch',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-mismatch',
      expect.objectContaining({
        error_message: expect.stringContaining('workflow-mismatch-key'),
      }),
      'tenant-1'
    );
  });

  it('launches a published TICKET_CREATED workflow for an inbound-email ticket (alga-2026-0002379)', async () => {
    catalogSchemaRef = 'payload.TicketCreated.v1';
    const tenant = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
    const ticketId = '7fa265ac-3a50-4ad6-9454-4a860d884996';

    // Real durable-inbound publisher -> row payload the dispatcher replays -> the
    // conversion EventBus.publish applies before XADD to workflow:events:global.
    await new InboundEmailOutboxEventPublisher({ trx: {} as any, tenantId: tenant, inboxId: 'inbox-1' })
      .publishTicketCreated({ tenantId: tenant, ticketId, metadata: { source: 'email' } });
    const row = (insertOutboxRowMock.mock.calls[0] as unknown[])[1] as { event_type: string; payload: Record<string, unknown> };
    const streamed = convertToWorkflowEvent({
      eventType: row.event_type,
      payload: row.payload,
      id: 'c9f1f8d4-7c1f-4a0c-9b0e-5a2f1f7f3a11',
      timestamp: new Date().toISOString()
    } as any);

    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: streamed.event_id });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-new-ticket-email',
        key: 'new-ticket-email',
        status: 'published',
        trigger: { type: 'event', eventName: 'TICKET_CREATED' }
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockResolvedValue([
      {
        version: 3,
        definition_json: {
          id: 'workflow-new-ticket-email',
          version: 3,
          payloadSchemaRef: 'payload.TicketCreated.v1',
          trigger: { type: 'event', eventName: 'TICKET_CREATED' },
          steps: []
        }
      }
    ]);
    schemaRegistryHasMock.mockReturnValue(true);
    schemaRegistryGetMock.mockImplementation((ref: string) => workflowEventPayloadSchemas[ref]);

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();
    await registeredConsumer?.({
      event_id: streamed.event_id,
      event_type: streamed.event_type,
      tenant: streamed.tenant,
      payload: streamed.payload
    });

    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflowId: 'workflow-new-ticket-email',
        tenantId: tenant,
        payload: expect.objectContaining({ ticketId, tenantId: tenant, occurredAt: expect.any(String) })
      })
    );
  });

  it('does not stamp a validation error when the event still launches another workflow', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-fanout' });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-bad',
        key: 'workflow-bad-key',
        status: 'published',
        trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.Bad.v1' }
      },
      {
        workflow_id: 'workflow-good',
        key: 'workflow-good-key',
        status: 'published',
        trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' }
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockImplementation(async (_knex: unknown, workflowId: string) => ([
      {
        version: 7,
        definition_json: {
          id: workflowId,
          version: 7,
          payloadSchemaRef: workflowId === 'workflow-bad' ? 'payload.Bad.v1' : 'payload.WorkflowEvent.v1',
          trigger: {
            type: 'event',
            eventName: 'PING',
            sourcePayloadSchemaRef: workflowId === 'workflow-bad' ? 'payload.Bad.v1' : 'payload.WorkflowEvent.v1'
          },
          steps: []
        }
      }
    ]));
    schemaRegistryGetMock.mockImplementation((ref: string) => ({
      safeParse: () => ref === 'payload.Bad.v1'
        ? {
            success: false,
            error: { issues: [{ path: ['occurredAt'], code: 'invalid_type', message: 'Required' }] },
          }
        : { success: true },
    }));

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-fanout',
      event_type: 'PING',
      workflow_correlation_key: 'corr-fanout',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({ workflowId: 'workflow-good' })
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[WorkflowRuntimeV2EventStreamWorker] Payload validation failed; skipping workflow launch',
      expect.objectContaining({ workflowId: 'workflow-bad' })
    );
    for (const call of workflowRuntimeEventUpdateMock.mock.calls) {
      expect(call[2]).not.toHaveProperty('error_message');
    }
  });

  it('persists Temporal delivery failures onto the event row without blocking other deliveries', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-5' });
    signalWorkflowRuntimeV2EventMock.mockRejectedValueOnce(new Error('temporal signal failed'));

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-5',
      event_type: 'PING',
      workflow_correlation_key: 'corr-5',
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(2);
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({ workflowId: 'workflow-1' })
    );
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-5',
      expect.objectContaining({
        error_message: expect.stringContaining('temporal signal failed')
      }),
      'tenant-1'
    );
  });

  describe('fan-out across matching workflows', () => {
    const pingVersion = (workflowId: string) => [{
      version: 7,
      definition_json: {
        id: workflowId,
        version: 7,
        payloadSchemaRef: 'payload.WorkflowEvent.v1',
        trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' },
        steps: []
      }
    }];
    const pingWorkflow = (workflowId: string, extra: Record<string, unknown> = {}) => ({
      workflow_id: workflowId,
      status: 'published',
      trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1' },
      ...extra
    });

    beforeEach(() => {
      workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-fan' });
      workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
      workflowDefinitionVersionListByWorkflowMock.mockImplementation(
        async (_knex: unknown, workflowId: string) => pingVersion(workflowId)
      );
    });

    const deliver = async () => {
      const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
      await worker.start();
      await registeredConsumer?.({
        event_id: 'event-fan',
        event_type: 'PING',
        workflow_correlation_key: 'corr-fan',
        tenant: 'tenant-1',
        payload: { foo: 'bar' }
      });
    };

    it('skips a paused workflow without blocking the workflows after it or recording an error', async () => {
      workflowDefinitionListMock.mockResolvedValue([
        pingWorkflow('workflow-paused', { is_paused: true }),
        pingWorkflow('workflow-after')
      ]);
      launchPublishedWorkflowRunMock.mockResolvedValue({ runId: 'run-after', workflowVersion: 7 });

      await deliver();

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
        knexMock,
        expect.objectContaining({ workflowId: 'workflow-after' })
      );
      expect(loggerDebugMock).toHaveBeenCalledWith(
        '[WorkflowRuntimeV2EventStreamWorker] Event processed',
        expect.objectContaining({ startedRuns: 1, skipStats: expect.objectContaining({ paused: 1 }) })
      );
      expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
        knexMock,
        'event-fan',
        expect.objectContaining({ matched_run_id: 'run-after' }),
        'tenant-1'
      );
      for (const call of workflowRuntimeEventUpdateMock.mock.calls) {
        expect(call[2]).not.toHaveProperty('error_message');
      }
    });

    it('keeps launching later workflows when one launch fails and records every failure', async () => {
      workflowDefinitionListMock.mockResolvedValue([
        pingWorkflow('workflow-limited'),
        pingWorkflow('workflow-after'),
        pingWorkflow('workflow-down')
      ]);
      launchPublishedWorkflowRunMock.mockImplementation(async (_knex: unknown, request: { workflowId: string }) => {
        if (request.workflowId === 'workflow-limited') throw new Error('Workflow concurrency limit reached');
        if (request.workflowId === 'workflow-down') throw new Error('Failed to connect before the deadline');
        return { runId: 'run-after', workflowVersion: 7 };
      });

      await deliver();

      expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(3);
      expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
        knexMock,
        'event-fan',
        expect.objectContaining({ matched_run_id: 'run-after' }),
        'tenant-1'
      );
      const errorUpdate = workflowRuntimeEventUpdateMock.mock.calls.find((call) => 'error_message' in (call[2] as object));
      expect(errorUpdate?.[2]).toEqual(expect.objectContaining({
        error_message: expect.stringMatching(/workflow-limited: Workflow concurrency limit reached[\s\S]*workflow-down: Failed to connect/)
      }));
    });

    describe('mixed outcomes (alga-2026-0002379)', () => {
      const deliverFrom = async (executionId: string, candidates: unknown[] = []) => {
        workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue(candidates);
        const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
        await worker.start();
        await registeredConsumer?.({
          event_id: 'event-fan',
          event_type: 'PING',
          workflow_correlation_key: 'corr-fan',
          tenant: 'tenant-1',
          execution_id: executionId,
          payload: { foo: 'bar' }
        });
      };
      const originatedBy = (workflowId: string) =>
        workflowRunGetByIdMock.mockResolvedValue({ run_id: 'run-origin', workflow_id: workflowId, trigger_metadata_json: null });
      const finalUpdates = () => workflowRuntimeEventUpdateMock.mock.calls.filter((c) => c[1] === 'event-fan');

      it('persists the self-trigger skip alongside a started run, keeping matched_run_id and processed_at', async () => {
        workflowDefinitionListMock.mockResolvedValue([pingWorkflow('workflow-a', { key: 'a' }), pingWorkflow('workflow-b')]);
        originatedBy('workflow-a');
        launchPublishedWorkflowRunMock.mockResolvedValue({ runId: 'run-b', workflowVersion: 7 });

        await deliverFrom('run-origin');

        expect(launchPublishedWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(finalUpdates()).toHaveLength(1);
        expect(finalUpdates()[0][2]).toEqual(expect.objectContaining({
          matched_run_id: 'run-b',
          processed_at: expect.any(String),
          error_message: expect.stringContaining('published by a run of this same workflow'),
        }));
        expect(finalUpdates()[0][3]).toBe('tenant-1');
      });

      it('persists a lineage skip alongside a signaled wait and matches the signaled run', async () => {
        workflowDefinitionListMock.mockResolvedValue([pingWorkflow('workflow-a')]);
        originatedBy('other-workflow');

        await deliverFrom('run-origin', [{ wait_id: 'wait-1', run_id: 'run-wait-1', wait_type: 'event', payload: null }]);
        workflowRuntimeEventUpdateMock.mockClear();
        launchPublishedWorkflowRunMock.mockClear();

        // Same event, but the matching workflow is in the lineage and a wait is signaled.
        workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([
          { wait_id: 'wait-1', run_id: 'run-wait-1', wait_type: 'event', payload: null },
        ]);
        const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
        await worker.start();
        await registeredConsumer?.({
          event_id: 'event-fan',
          event_type: 'PING',
          workflow_correlation_key: 'corr-fan',
          tenant: 'tenant-1',
          payload: { foo: 'bar', workflowLineage: ['workflow-a'] }
        });

        expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
        expect(finalUpdates()).toHaveLength(1);
        expect(finalUpdates()[0][2]).toEqual(expect.objectContaining({
          matched_run_id: 'run-wait-1',
          processed_at: expect.any(String),
          error_message: expect.stringContaining('trigger loop guard'),
        }));
      });

      it('combines delivery errors with skip diagnostics, delivery first', async () => {
        workflowDefinitionListMock.mockResolvedValue([pingWorkflow('workflow-a'), pingWorkflow('workflow-down')]);
        originatedBy('workflow-a');
        launchPublishedWorkflowRunMock.mockRejectedValue(new Error('Failed to connect before the deadline'));

        await deliverFrom('run-origin');

        expect(finalUpdates()).toHaveLength(1);
        const message = (finalUpdates()[0][2] as { error_message: string }).error_message;
        expect(message).toMatch(/Failed to connect before the deadline[\s\S]*published by a run of this same workflow/);
        expect(finalUpdates()[0][2]).not.toHaveProperty('matched_run_id');
        expect(finalUpdates()[0][3]).toBe('tenant-1');
      });

      it('keeps a paused workflow silent next to a started run', async () => {
        workflowDefinitionListMock.mockResolvedValue([pingWorkflow('workflow-paused', { is_paused: true }), pingWorkflow('workflow-b')]);
        launchPublishedWorkflowRunMock.mockResolvedValue({ runId: 'run-b', workflowVersion: 7 });

        await deliverFrom('');

        expect(finalUpdates()).toHaveLength(1);
        expect(finalUpdates()[0][2]).toEqual(expect.objectContaining({ matched_run_id: 'run-b' }));
        expect(finalUpdates()[0][2]).not.toHaveProperty('error_message');
      });
    });
  });

  it('routes temporal human waits from the stream worker', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-6' });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([
      {
        wait_id: 'wait-human-1',
        run_id: 'run-human-1',
        wait_type: 'human',
        payload: { taskId: 'task-1' },
      }
    ]);

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-6',
      event_type: 'HUMAN_TASK_COMPLETED',
      workflow_correlation_key: 'corr-6',
      tenant: 'tenant-1',
      payload: { approved: true }
    });

    expect(signalWorkflowRuntimeV2HumanTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-human-1',
        taskId: 'task-1',
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: { approved: true }
      })
    );
  });

  it('applies trigger payload mapping in the stream worker before launching', async () => {
    workflowRuntimeEventCreateMock.mockResolvedValue({ event_id: 'event-7' });
    workflowRunWaitListEventWaitCandidatesMock.mockResolvedValue([]);
    workflowDefinitionListMock.mockResolvedValue([
      {
        workflow_id: 'workflow-map-1',
        status: 'published',
        trigger: {
          type: 'event',
          eventName: 'PING',
          sourcePayloadSchemaRef: 'payload.SourceEvent.v1',
          payloadMapping: {
            'payload.ticketId': { $expr: 'event.payload.ticket.id' }
          }
        },
        payload_schema_ref: 'payload.WorkflowEvent.v1'
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockResolvedValue([
      {
        version: 3,
        definition_json: {
          id: 'workflow-map-1',
          version: 3,
          payloadSchemaRef: 'payload.WorkflowEvent.v1',
          trigger: {
            type: 'event',
            eventName: 'PING',
            sourcePayloadSchemaRef: 'payload.SourceEvent.v1',
            payloadMapping: {
              'payload.ticketId': { $expr: 'event.payload.ticket.id' }
            }
          },
          steps: []
        }
      }
    ]);
    resolveInputMappingMock.mockResolvedValue({ 'payload.ticketId': 'ticket-42' });

    const worker = new WorkflowRuntimeV2EventStreamWorker('worker-1');
    await worker.start();

    await registeredConsumer?.({
      event_id: 'event-7',
      event_type: 'PING',
      workflow_correlation_key: 'corr-7',
      tenant: 'tenant-1',
      payload: { ticket: { id: 'ticket-42' } }
    });

    expect(resolveInputMappingMock).toHaveBeenCalled();
    expect(launchPublishedWorkflowRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflowId: 'workflow-map-1',
        payload: { payload: { ticketId: 'ticket-42' } },
        sourcePayloadSchemaRef: 'payload.SourceEvent.v1',
        triggerMappingApplied: true
      })
    );
  });
});
