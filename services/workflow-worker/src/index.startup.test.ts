import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dotenvConfigMock,
  initializeWorkflowRuntimeV2Mock,
  registerWorkflowEmailProviderMock,
  registerEnterpriseStorageProvidersMock,
  sweepWorkerStartMock,
  sweepWorkerStopMock,
  eventWorkerStartMock,
  eventWorkerStopMock,
  temporalWorkerStartMock,
  temporalWorkerStopMock,
  sweepWorkerCtorMock,
  eventWorkerCtorMock,
  temporalWorkerCtorMock,
  loggerInfoMock,
  loggerErrorMock
} = vi.hoisted(() => ({
  dotenvConfigMock: vi.fn(),
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  registerWorkflowEmailProviderMock: vi.fn(),
  registerEnterpriseStorageProvidersMock: vi.fn(async () => undefined),
  sweepWorkerStartMock: vi.fn(async () => undefined),
  sweepWorkerStopMock: vi.fn(async () => undefined),
  eventWorkerStartMock: vi.fn(async () => undefined),
  eventWorkerStopMock: vi.fn(async () => undefined),
  temporalWorkerStartMock: vi.fn(async () => undefined),
  temporalWorkerStopMock: vi.fn(async () => undefined),
  sweepWorkerCtorMock: vi.fn(),
  eventWorkerCtorMock: vi.fn(),
  temporalWorkerCtorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn()
}));

vi.mock('dotenv', () => ({
  default: {
    config: (...args: unknown[]) => dotenvConfigMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/runtime/worker', () => ({
  initializeWorkflowRuntimeV2: (...args: unknown[]) => initializeWorkflowRuntimeV2Mock(...args),
  registerWorkflowEmailProvider: (...args: unknown[]) => registerWorkflowEmailProviderMock(...args)
}));

vi.mock('@alga-psa/workflows/workers', () => ({
  WorkflowDataStoreSweepWorker: class {
    constructor(workerId: string) {
      sweepWorkerCtorMock(workerId);
    }

    async start() {
      return sweepWorkerStartMock();
    }

    async stop() {
      return sweepWorkerStopMock();
    }
  }
}));

vi.mock('./v2/WorkflowRuntimeV2EventStreamWorker.js', () => ({
  WorkflowRuntimeV2EventStreamWorker: class {
    constructor(workerId: string) {
      eventWorkerCtorMock(workerId);
    }

    async start() {
      return eventWorkerStartMock();
    }

    async stop() {
      return eventWorkerStopMock();
    }
  }
}));

vi.mock('./v2/WorkflowRuntimeV2TemporalWorker.js', () => ({
  WorkflowRuntimeV2TemporalWorker: class {
    constructor(workerId: string) {
      temporalWorkerCtorMock(workerId);
    }

    async start() {
      return temporalWorkerStartMock();
    }

    async stop() {
      return temporalWorkerStopMock();
    }
  }
}));

vi.mock('./registerEnterpriseStorageProviders.js', () => ({
  registerEnterpriseStorageProviders: (...args: unknown[]) => registerEnterpriseStorageProvidersMock(...args)
}));

vi.mock('./healthServer.js', () => ({
  HealthServer: class {
    async start() {}
    async stop() {}
    setWorker() {}
    markReady() {}
  }
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args)
  }
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: class TenantEmailService {},
  StaticTemplateProcessor: class StaticTemplateProcessor {},
  EmailProviderManager: class EmailProviderManager {}
}));

describe('workflow worker startup', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING;
    delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING;

    dotenvConfigMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    registerWorkflowEmailProviderMock.mockReset();
    registerEnterpriseStorageProvidersMock.mockReset();
    sweepWorkerStartMock.mockReset();
    sweepWorkerStopMock.mockReset();
    eventWorkerStartMock.mockReset();
    eventWorkerStopMock.mockReset();
    temporalWorkerStartMock.mockReset();
    temporalWorkerStopMock.mockReset();
    sweepWorkerCtorMock.mockReset();
    eventWorkerCtorMock.mockReset();
    temporalWorkerCtorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerErrorMock.mockReset();
  });

  it('T024: starts the Temporal worker, event ingress, and data-store sweep unconditionally', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await import('./index.ts');
      await vi.waitFor(() => {
        expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
        expect(registerWorkflowEmailProviderMock).toHaveBeenCalledTimes(1);
        expect(registerEnterpriseStorageProvidersMock).toHaveBeenCalledTimes(1);
        expect(temporalWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(sweepWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(temporalWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      });

      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });

  it('ignores the retired engine-selection env flags', async () => {
    process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING = 'true';
    process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING = 'false';
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await import('./index.ts');
      await vi.waitFor(() => {
        expect(temporalWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);
      });

      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });
});
