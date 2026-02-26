import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgBossSlaBackend } from '../backends/PgBossSlaBackend';

const loadFactory = async () => {
  vi.resetModules();
  return import('../backends/SlaBackendFactory');
};

describe('SlaBackendFactory', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.EDITION = originalEdition;
  });

  it('returns PgBossSlaBackend when isEnterprise is false', async () => {
    process.env.EDITION = 'ce';
    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend).toBeInstanceOf(PgBossSlaBackend);
    SlaBackendFactory.getInstance().reset();
  });

  it('returns TemporalSlaBackend when isEnterprise is true and Temporal available', async () => {
    process.env.EDITION = 'ee';
    vi.mock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {},
    }));

    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend.constructor.name).toBe('TemporalSlaBackendMock');
    SlaBackendFactory.getInstance().reset();
  });

  it('falls back to PgBossSlaBackend when Temporal unavailable in EE', async () => {
    process.env.EDITION = 'enterprise';
    vi.mock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        constructor() {
          throw new Error('Temporal unavailable');
        }
      },
    }));

    const { SlaBackendFactory } = await loadFactory();
    const backend = await SlaBackendFactory.getBackend();
    expect(backend).toBeInstanceOf(PgBossSlaBackend);
    SlaBackendFactory.getInstance().reset();
  });
});
