import { afterEach, describe, expect, it, vi } from 'vitest';

// CM L5 deploy fix: the email-service entry point alone must leave the co-managed capability gate
// REGISTERED. This file loads exactly the import graph services/email-service/src/index.ts loads:
// no server instrumentation, no test-setup capability registration (shared/vitest.config.ts has no
// setupFiles), and the database barrel and capability gate are real. Only the heavy collaborators
// (IMAP service, queue consumers, observability) are stubbed. Without the capability import in
// @alga-psa/co-managed/deliveryRegistration, serves('co-managed') answers `resolver-unregistered`, the
// seam resolves null, and a cm reply is treated as inert and lost.
const noop = vi.hoisted(() => ({ start: async () => undefined }));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('./emailService', () => ({
  EmailService: class {
    start() {
      return noop.start();
    }
    async stop() {}
    getListenerStats() {
      return {};
    }
  },
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer', () => ({
  UnifiedInboundEmailQueueConsumer: class {
    lastSuccessfulTickAt = null;
    start() {
      return noop.start();
    }
    stop() {}
  },
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor', () => ({
  processUnifiedInboundEmailQueueJob: vi.fn(),
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumerV2', () => ({
  UnifiedInboundEmailQueueConsumerV2: class {
    lastSuccessfulTickAt = null;
    start() {
      return noop.start();
    }
    stop() {}
  },
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessorV2', () => ({
  processUnifiedInboundEmailDurableJob: vi.fn(),
  renewPostgresLeaseForV2Job: vi.fn(),
}));
vi.mock('@alga-psa/shared/services/email/inboundEmailDurableStore', () => ({
  getInboundDurableMode: () => 'off',
}));
vi.mock('@alga-psa/shared/services/email/inboundAuthPauseNotifier', () => ({
  assertInboundAuthPauseNotifierRegistered: vi.fn(),
}));
vi.mock('@alga-psa/shared/services/email/inboundAuthPauseEventNotifier', () => ({
  registerInboundAuthPauseEventPublisher: vi.fn(),
}));
vi.mock('@alga-psa/shared/services/email/inboundEmailMetrics', () => ({
  installInboundEmailMetricsSink: vi.fn(),
}));
vi.mock('./observability/registry', () => ({
  createInboundEmailMetrics: () => ({ setLiveStateProvider: vi.fn() }),
}));
vi.mock('./observability/promSink', () => ({ createPromSink: vi.fn() }));
vi.mock('./observability/healthCollector', () => ({
  collectRealSnapshot: vi.fn(),
  readRealQueueDepths: vi.fn(),
  createHealthCollector: () => ({ start: vi.fn(), stop: vi.fn(), getCache: vi.fn() }),
}));
vi.mock('./observability/readiness', () => ({ createReadiness: vi.fn(() => ({})) }));
vi.mock('./observability/healthServer', () => ({
  createHealthServer: () => ({
    on: vi.fn(),
    listen: (_p: number, _h: string, cb: () => void) => cb(),
    close: (cb: () => void) => cb(),
  }),
}));


const SERVED_TENANT = '374a6b30-392b-4e3d-8d09-2ea8dc447c72';

describe('email-service entry registers the co-managed capability (and only that graph)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves participation registered and the delivery seam resolving for a served tenant', async () => {
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:on');
    const { capabilityResolverStatus } = await import('@alga-psa/core/capability');
    // Precondition that makes this test meaningful: nothing registered it before the entry point ran.
    expect(capabilityResolverStatus('co-managed').participation).not.toBe('registered');

    const onSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('./index');
      const { coManagedDeliverySeam, coManagedInboundCommentSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      await vi.waitFor(() => {
        expect(coManagedDeliverySeam.hasProvider()).toBe(true);
        expect(coManagedInboundCommentSeam.hasProvider()).toBe(true);
      }, { timeout: 30_000 });

      expect(capabilityResolverStatus('co-managed').participation).toBe('registered');
      expect(capabilityResolverStatus('co-managed').eligibility).toBe('registered');
      expect(await coManagedDeliverySeam.resolve(SERVED_TENANT)).not.toBeNull();
    } finally {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    }
  }, 60_000);
});
