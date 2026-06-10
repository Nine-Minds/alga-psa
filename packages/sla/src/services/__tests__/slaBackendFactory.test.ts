import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadFactory = async () => {
  vi.resetModules();
  return import('../backends/SlaBackendFactory');
};

// vi.resetModules() gives the factory a fresh module graph, so class identity
// can't be compared against a statically imported class — assert by name.
describe('SlaBackendFactory', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.EDITION = originalEdition;
    vi.doUnmock('@enterprise/lib/sla/TemporalSlaBackend');
  });

  it('returns PgBossSlaBackend when isEnterprise is false', async () => {
    process.env.EDITION = 'ce';
    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend.constructor.name).toBe('PgBossSlaBackend');
    SlaBackendFactory.getInstance().reset();
  });

  it('returns TemporalSlaBackend when isEnterprise is true and Temporal available', async () => {
    process.env.EDITION = 'ee';
    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {},
    }));

    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend.constructor.name).toBe('TemporalSlaBackendMock');
    SlaBackendFactory.getInstance().reset();
  });

  it('falls back to PgBossSlaBackend when Temporal unavailable in EE', async () => {
    process.env.EDITION = 'enterprise';
    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        constructor() {
          throw new Error('Temporal unavailable');
        }
      },
    }));

    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend.constructor.name).toBe('PgBossSlaBackend');
    SlaBackendFactory.getInstance().reset();
  });
});
