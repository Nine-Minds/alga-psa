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
  loggerErrorMock
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
  loggerErrorMock: vi.fn()
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

vi.mock('@alga-psa/workflow-streams', () => ({
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

import { WorkflowRuntimeV2EventStreamWorker } from './WorkflowRuntimeV2EventStreamWorker';

const knexMock: any = (table: string) => {
  if (table === 'event_catalog' || table === 'system_event_catalog') {
    return {
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({ payload_schema_ref: 'payload.WorkflowEvent.v1' })),
    };
  }

  throw new Error(`Unexpected table access: ${table}`);
};

describe('WorkflowRuntimeV2EventStreamWorker', () => {
  beforeEach(() => {
    delete process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON;
    registeredConsumer = null;

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
        tenant_id: 'tenant-1',
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
    );
    expect(
      workflowRuntimeEventUpdateMock.mock.calls.some(([, eventId, patch]) => {
        return eventId === 'event-4' && patch && typeof patch === 'object' && 'error_message' in (patch as Record<string, unknown>);
      })
    ).toBe(false);
  });

  it('persists Temporal delivery failures onto the event row', async () => {
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

    expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-5',
      expect.objectContaining({
        error_message: expect.stringContaining('temporal signal failed')
      })
    );
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
