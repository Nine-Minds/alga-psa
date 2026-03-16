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
  workflowDefinitionListMock,
  workflowDefinitionVersionListByWorkflowMock,
  launchPublishedWorkflowRunMock,
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
  workflowDefinitionListMock: vi.fn(),
  workflowDefinitionVersionListByWorkflowMock: vi.fn(),
  launchPublishedWorkflowRunMock: vi.fn(),
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

vi.mock('@alga-psa/workflows/runtime', () => ({
  initializeWorkflowRuntimeV2: (...args: unknown[]) => initializeWorkflowRuntimeV2Mock(...args),
  getSchemaRegistry: () => ({
    has: (...args: unknown[]) => schemaRegistryHasMock(...args),
    get: (...args: unknown[]) => schemaRegistryGetMock(...args)
  })
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
  }
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRunMock(...args)
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
    registeredConsumer = null;

    redisInitializeMock.mockReset();
    redisRegisterConsumerMock.mockReset();
    redisCloseMock.mockReset();
    workflowEventParseMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    workflowRuntimeEventGetByIdMock.mockReset();
    workflowRuntimeEventCreateMock.mockReset();
    workflowRuntimeEventUpdateMock.mockReset();
    workflowDefinitionListMock.mockReset();
    workflowDefinitionVersionListByWorkflowMock.mockReset();
    launchPublishedWorkflowRunMock.mockReset();
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
        trigger: { eventName: 'PING' }
      }
    ]);
    workflowDefinitionVersionListByWorkflowMock.mockResolvedValue([
      {
        version: 7,
        definition_json: {
          id: 'workflow-1',
          version: 7,
          payloadSchemaRef: 'payload.WorkflowEvent.v1',
          steps: []
        }
      }
    ]);
    launchPublishedWorkflowRunMock.mockResolvedValue({ runId: 'run-1', workflowVersion: 7 });
    getAdminConnectionMock.mockResolvedValue(knexMock);
    schemaRegistryHasMock.mockReturnValue(true);
    schemaRegistryGetMock.mockReturnValue({
      safeParse: () => ({ success: true })
    });
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
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRuntimeEventCreateMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        event_id: 'event-1',
        tenant_id: 'tenant-1',
        event_name: 'PING',
        correlation_key: 'event-1',
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
        triggerMappingApplied: false,
        execute: false
      })
    );
    expect(workflowRuntimeEventUpdateMock).toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({
        matched_run_id: 'run-1'
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
      tenant: 'tenant-1',
      payload: { foo: 'bar' }
    });

    expect(workflowRuntimeEventCreateMock).not.toHaveBeenCalled();
    expect(launchPublishedWorkflowRunMock).not.toHaveBeenCalled();
  });
});
