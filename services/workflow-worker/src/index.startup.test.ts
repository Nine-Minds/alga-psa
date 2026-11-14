import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  loggerErrorMock,
  registerFeatureFlagCheckerMock,
  featureFlagIsEnabledMock,
  registerCapabilityEligibilityMock,
  registerCapabilityParticipationMock
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
  loggerErrorMock: vi.fn(),
  registerFeatureFlagCheckerMock: vi.fn(),
  featureFlagIsEnabledMock: vi.fn(async () => false),
  registerCapabilityEligibilityMock: vi.fn(),
  registerCapabilityParticipationMock: vi.fn()
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

const { healthState, registrationMode, callOrder } = vi.hoisted(() => ({
  healthState: { workers: {} as Record<string, boolean>, ready: false },
  registrationMode: { fail: false, pending: null as Promise<void> | null, entered: () => {} },
  callOrder: [] as string[]
}));

vi.mock('./healthServer.js', () => ({
  HealthServer: class {
    async start() { callOrder.push('health-start'); }
    async stop() {}
    setWorker(name: string, ready: boolean) { healthState.workers[name] = ready; }
    markReady() { healthState.ready = true; }
  }
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args)
  }
}));

vi.mock('@alga-psa/core/features', () => ({
  registerFeatureFlagChecker: (...args: unknown[]) => registerFeatureFlagCheckerMock(...args)
}));

vi.mock('@alga-psa/core/server', () => ({
  featureFlags: {
    isEnabled: (...args: unknown[]) => featureFlagIsEnabledMock(...args)
  }
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: class TenantEmailService {},
  StaticTemplateProcessor: class StaticTemplateProcessor {},
  EmailProviderManager: class EmailProviderManager {}
}));

// Worker boot safety (capability gate, A6): the gate must be unable to stop the
// worker from booting, so every export throws.
const { capabilityThrow } = vi.hoisted(() => ({
  capabilityThrow: vi.fn(() => {
    throw new Error('capability gate forced to fail');
  })
}));
vi.mock('@alga-psa/core/capability', () => ({
  admits: capabilityThrow,
  serves: capabilityThrow,
  filterServed: capabilityThrow,
  isCapabilityServed: capabilityThrow,
  filterCapabilityServed: capabilityThrow,
  activityServesCapability: capabilityThrow,
  evaluateCapability: capabilityThrow,
  registerCapabilityEligibility: (...args: unknown[]) => registerCapabilityEligibilityMock(...args),
  registerCapabilityParticipation: (...args: unknown[]) => registerCapabilityParticipationMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  getAdminConnection: vi.fn(),
  registerWriteAdmissionProvider: vi.fn(),
  tenantDb: vi.fn()
}));
vi.mock('@alga-psa/licensing/lifecycle', () => ({
  CO_MANAGED_OPERATIONAL_WRITE: 'co-managed-operational-write',
  coManagedLifecycleProvider: { readState: vi.fn() },
  registerCoManagedLifecycleProvider: vi.fn()
}));
vi.mock('@alga-psa/licensing/lifecycle-error', () => ({ CoManagedLifecycleError: class extends Error {} }));

// Exercise the real registration module and capability setup, without loading
// the database-backed operations that its providers will invoke later.
vi.mock('../../../packages/co-managed/src/workflowTicketAuthority', () => ({
  retainCoManagedWorkflowTicketAuthority: vi.fn()
}));
vi.mock('../../../packages/co-managed/src/deliveryProvider', () => ({
  createCoManagedDeliveryProvider: vi.fn()
}));
vi.mock('../../../packages/co-managed/src/inboundCommentWriter', () => ({
  registerCoManagedInboundCommentWriter: vi.fn()
}));

describe('workflow worker startup', () => {
  beforeEach(() => {
    vi.resetModules();
    healthState.workers = {};
    healthState.ready = false;
    registrationMode.fail = false;
    registrationMode.pending = null;
    registrationMode.entered = () => {};
    callOrder.length = 0;
    // Re-run per boot: a vi.mock factory is cached across resetModules.
    // Load the real registration, or simulate an image that cannot resolve it.
    vi.doMock('@alga-psa/co-managed/deliveryRegistration', async (importOriginal) => {
      callOrder.push('import');
      registrationMode.entered();
      await registrationMode.pending;
      if (registrationMode.fail) throw new Error('cannot resolve co-managed');
      return importOriginal();
    });
    delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING;
    delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING;

    dotenvConfigMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockImplementation(() => { callOrder.push('init'); });
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
    registerFeatureFlagCheckerMock.mockReset();
    featureFlagIsEnabledMock.mockReset();
    registerCapabilityEligibilityMock.mockReset();
    registerCapabilityParticipationMock.mockReset();
  });

  it('T024: starts the Temporal worker, event ingress, and data-store sweep unconditionally', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await (await import('./index.ts')).startup;
      expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
      expect(registerFeatureFlagCheckerMock).toHaveBeenCalledTimes(1);
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
      const { coManagedWorkflowTicketSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      expect(coManagedWorkflowTicketSeam.hasProvider()).toBe(true);
      // Both capability shapes must be ready before the runtime can process work.
      for (const register of [registerCapabilityParticipationMock, registerCapabilityEligibilityMock]) {
        expect(register).toHaveBeenCalledTimes(2);
        expect(register).toHaveBeenCalledWith('co-managed', expect.any(Function));
        expect(register).toHaveBeenCalledWith('co-managed-seat', expect.any(Function));
        for (const callOrder of register.mock.invocationCallOrder) {
          expect(callOrder).toBeLessThan(initializeWorkflowRuntimeV2Mock.mock.invocationCallOrder[0]);
        }
      }

      const checker = registerFeatureFlagCheckerMock.mock.calls[0]?.[0];
      await checker('sample-flag', { tenantId: 'tenant-1' });
      expect(featureFlagIsEnabledMock).toHaveBeenCalledWith('sample-flag', {
        tenantId: 'tenant-1'
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
      await (await import('./index.ts')).startup;
      expect(temporalWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);

      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });

  it('boots (startServices completes) when the capability gate throws on every call', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);

    try {
      await (await import('./index.ts')).startup;
      expect(temporalWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).not.toHaveBeenCalled();
    } finally {
      processOnSpy.mockRestore();
    }
  });

  afterEach(async () => {
    const { coManagedWorkflowTicketSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
    coManagedWorkflowTicketSeam.reset();
  });

  it('keeps startup pending and stays not-ready until authority registration completes', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    let release!: () => void;
    registrationMode.pending = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { registrationMode.entered = resolve; });
    const { startup } = await import('./index.ts');
    let finished = false;
    void startup.then(() => { finished = true; });
    try {
      await entered;
      expect(finished).toBe(false);
      expect(healthState.ready).toBe(false);
      expect(initializeWorkflowRuntimeV2Mock).not.toHaveBeenCalled();
      expect(temporalWorkerStartMock).not.toHaveBeenCalled();
      release();
      await startup;
      expect(finished).toBe(true);
      expect(healthState.ready).toBe(true);
      expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
      expect(temporalWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(eventWorkerStartMock).toHaveBeenCalledTimes(1);
      expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await startup;
      processOnSpy.mockRestore();
    }
  });

  it('registers the co-managed workflow ticket authority before initializeWorkflowRuntimeV2 and reports ready', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    try {
      await (await import('./index.ts')).startup;
      expect(healthState.ready).toBe(true);
      const { coManagedWorkflowTicketSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      expect(coManagedWorkflowTicketSeam.hasProvider()).toBe(true);
      expect(healthState.workers['co-managed-workflow-authority']).toBe(true);
      expect(callOrder).toEqual(['health-start', 'import', 'init']);
    } finally {
      processOnSpy.mockRestore();
    }
  });

  it('stays not-ready with a named reason when the provider import throws', async () => {
    registrationMode.fail = true;
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    try {
      await (await import('./index.ts')).startup;
      expect(sweepWorkerStartMock).toHaveBeenCalledTimes(1);
      const { coManagedWorkflowTicketSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      expect(coManagedWorkflowTicketSeam.hasProvider()).toBe(false);
      expect(registerCapabilityParticipationMock).not.toHaveBeenCalled();
      expect(callOrder).toEqual(['health-start', 'import', 'init']);
      expect(healthState.workers.temporal).toBe(true);
      expect(healthState.workers.eventStream).toBe(true);
      expect(healthState.workers.dataStoreSweep).toBe(true);
      expect(healthState.workers['co-managed-workflow-authority']).toBe(false);
      expect(healthState.ready).toBe(false);
      expect(loggerInfoMock).not.toHaveBeenCalledWith('[WorkflowWorker] All services started successfully');
      expect(loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining('NOT ready'));
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('Failed to register the co-managed workflow ticket authority'), expect.anything());
    } finally {
      processOnSpy.mockRestore();
    }
  });
});
