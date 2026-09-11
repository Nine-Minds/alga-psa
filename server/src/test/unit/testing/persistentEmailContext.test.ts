import { afterEach, describe, expect, it, vi } from 'vitest';

const { constructed, initialized } = vi.hoisted(() => ({ constructed: vi.fn(), initialized: vi.fn() }));
vi.mock('../../e2e/utils/e2e-test-context', () => ({
  E2ETestContext: class {
    constructor(options: unknown) { constructed(options); }
    async initialize() { initialized(); }
  },
}));
import { createPersistentE2EHelpers, PersistentE2ETestContext } from '../../e2e/utils/persistent-test-context';

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('persistent email fixture initialization', () => {
  it('passes persistent service defaults to the parent before initialization and health checks', async () => {
    const healthy = vi.spyOn(PersistentE2ETestContext.prototype, 'verifyServicesRunning').mockResolvedValue();
    await createPersistentE2EHelpers().beforeAll();
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({
      autoStartServices: false, autoStartEmailPolling: true, runSeeds: true, serviceStartupTimeout: 5000,
    }));
    expect(initialized).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledOnce();
    expect(constructed.mock.invocationCallOrder[0]).toBeLessThan(initialized.mock.invocationCallOrder[0]);
    expect(initialized.mock.invocationCallOrder[0]).toBeLessThan(healthy.mock.invocationCallOrder[0]);
  });

  it('honors explicit fixture overrides instead of discarding them', async () => {
    vi.spyOn(PersistentE2ETestContext.prototype, 'verifyServicesRunning').mockResolvedValue();
    await createPersistentE2EHelpers().beforeAll({ runSeeds: false, autoStartEmailPolling: false, serviceStartupTimeout: 8000 });
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({
      autoStartServices: false, runSeeds: false, autoStartEmailPolling: false, serviceStartupTimeout: 8000,
    }));
  });
});
