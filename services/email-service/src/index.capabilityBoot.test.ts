import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// The installer may parse the kill switch, but must never evaluate the gate.
vi.mock('@alga-psa/core/capability', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core/capability')>(),
  admits: m.gate,
  serves: m.gate,
  filterServed: m.gate,
  isCapabilityServed: m.gate,
  filterCapabilityServed: m.gate,
  activityServesCapability: m.gate,
  evaluateCapability: m.gate,
}));
vi.mock('@alga-psa/db', () => {
  throw new Error('Worker bootstrap must not load the database connection/model barrel');
});
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
    m.serviceStart.mockClear();
    m.consumerStart.mockClear();
  });

  afterEach(async () => {
    const { resetWriteAdmissionResolver, invalidateWriteAdmission } = await import('@alga-psa/db/writeAdmission');
    resetWriteAdmissionResolver();
    invalidateWriteAdmission();
    vi.unstubAllEnvs();
  });

  it.each(['', 'co-managed:off'])('starts and installs working admission without consulting the gate (force=%j)', async (force) => {
    vi.stubEnv('FORCE_CAPABILITIES', force);
    const onSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('./index');
      await vi.waitFor(() => expect(m.info).toHaveBeenCalledWith('[IMAP] IMAP service started'));
      const { admitTenantWrite, hasWriteAdmissionResolver } = await import('@alga-psa/db/writeAdmission');
      expect(hasWriteAdmissionResolver()).toBe(true);
      const lookup = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ product_code: 'co_managed' }),
      };
      const db = vi.fn(() => lookup) as unknown as Knex;
      await expect(admitTenantWrite(db, 'tenant-boot', { operation: 'email-boot-test' })).resolves.toBeUndefined();
      expect(lookup.first).toHaveBeenCalledWith('product_code');
      expect(m.serviceStart).toHaveBeenCalledTimes(1);
      expect(m.consumerStart).toHaveBeenCalledTimes(1);
      expect(m.gate).not.toHaveBeenCalled();
      expect(m.error).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
