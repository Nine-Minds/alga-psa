import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dotenvConfigMock,
  initializeWorkflowRuntimeV2Mock,
  registerWorkflowEmailProviderMock,
  registerEnterpriseStorageProvidersMock,
  runtimeWorkerStartMock,
  runtimeWorkerStopMock,
  eventWorkerStartMock,
  eventWorkerStopMock,
  runtimeWorkerCtorMock,
  eventWorkerCtorMock,
  loggerInfoMock,
  loggerErrorMock
} = vi.hoisted(() => ({
  dotenvConfigMock: vi.fn(),
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  registerWorkflowEmailProviderMock: vi.fn(),
  registerEnterpriseStorageProvidersMock: vi.fn(async () => undefined),
  runtimeWorkerStartMock: vi.fn(async () => undefined),
  runtimeWorkerStopMock: vi.fn(async () => undefined),
  eventWorkerStartMock: vi.fn(async () => undefined),
  eventWorkerStopMock: vi.fn(async () => undefined),
  runtimeWorkerCtorMock: vi.fn(),
  eventWorkerCtorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn()
}));

vi.mock('dotenv', () => ({
  default: {
    config: (...args: unknown[]) => dotenvConfigMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  initializeWorkflowRuntimeV2: (...args: unknown[]) => initializeWorkflowRuntimeV2Mock(...args),
  registerWorkflowEmailProvider: (...args: unknown[]) => registerWorkflowEmailProviderMock(...args)
}));

vi.mock('@alga-psa/workflows/workers', () => ({
  WorkflowRuntimeV2Worker: class {
    constructor(workerId: string) {
      runtimeWorkerCtorMock(workerId);
    }

    async start() {
      return runtimeWorkerStartMock();
    }

    async stop() {
      return runtimeWorkerStopMock();
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

vi.mock('./registerEnterpriseStorageProviders.js', () => ({
  registerEnterpriseStorageProviders: (...args: unknown[]) => registerEnterpriseStorageProvidersMock(...args)
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

    dotenvConfigMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    registerWorkflowEmailProviderMock.mockReset();
    registerEnterpriseStorageProvidersMock.mockReset();
    runtimeWorkerStartMock.mockReset();
    runtimeWorkerStopMock.mockReset();
    eventWorkerStartMock.mockReset();
    eventWorkerStopMock.mockReset();
    runtimeWorkerCtorMock.mockReset();
    eventWorkerCtorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerErrorMock.mockReset();
  });

  it('T024: imports the worker entrypoint and starts only event ingress by default (DB polling worker disabled)', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await import('./index.ts');
      await vi.waitFor(() => {
        expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
        expect(registerWorkflowEmailProviderMock).toHaveBeenCalledTimes(1);
        expect(registerEnterpriseStorageProvidersMock).toHaveBeenCalledTimes(1);
        expect(runtimeWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(runtimeWorkerStartMock).not.toHaveBeenCalled();
        expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
      });

      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });

  it('starts DB polling worker only when WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING is enabled', async () => {
    process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING = 'true';
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await import('./index.ts');
      await vi.waitFor(() => {
        expect(runtimeWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerCtorMock).toHaveBeenCalledTimes(1);
        expect(runtimeWorkerStartMock).toHaveBeenCalledTimes(1);
        expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
      });

      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });
});
