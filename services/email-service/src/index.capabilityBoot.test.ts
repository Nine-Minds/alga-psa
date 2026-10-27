import { beforeEach, describe, expect, it, vi } from 'vitest';

// Worker boot safety (capability gate, A6): the email-service entry must finish
// starting when the capability gate throws on every call. The heavy collaborators
// are stubbed; the module under test is the real ./index.ts.
const m = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  gate: vi.fn(() => {
    throw new Error('capability gate forced to fail');
  }),
  serviceStart: vi.fn(async () => undefined),
  consumerStart: vi.fn(async () => undefined),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: m.info, error: m.error, warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core/capability', () => ({
  admits: m.gate,
  serves: m.gate,
  filterServed: m.gate,
  isCapabilityServed: m.gate,
  filterCapabilityServed: m.gate,
  activityServesCapability: m.gate,
  evaluateCapability: m.gate,
}));
vi.mock('./emailService', () => ({
  EmailService: class {
    start() {
      return m.serviceStart();
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
      return m.consumerStart();
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
      return m.consumerStart();
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

describe('email-service boot with a failing capability gate', () => {
  beforeEach(() => {
    vi.resetModules();
    m.info.mockClear();
    m.error.mockClear();
    m.gate.mockClear();
  });

  it('starts without ever consulting or tripping over the gate', async () => {
    const onSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('./index');
      await vi.waitFor(() => expect(m.info).toHaveBeenCalledWith('[IMAP] IMAP service started'));
      expect(m.error).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
