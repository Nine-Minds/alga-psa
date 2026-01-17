import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSecretProviderInstance = vi.fn(async () => ({
  getAppSecret: vi.fn(async () => 'pw'),
}));

const createdInstances: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
const knexFactory = vi.fn(() => {
  const instance = { destroy: vi.fn(async () => {}) };
  createdInstances.push(instance);
  return instance as any;
});

vi.mock('@alga-psa/core', () => ({
  getSecretProviderInstance,
}));

vi.mock('knex', () => ({
  default: knexFactory,
  Knex: {},
}));

describe('connection', () => {
  beforeEach(async () => {
    createdInstances.splice(0, createdInstances.length);
    knexFactory.mockClear();
    getSecretProviderInstance.mockClear();

    const { cleanupConnections } = await import('./connection');
    await cleanupConnections();
  });

  it('caches the default knex instance', async () => {
    const { getConnection } = await import('./connection');

    const first = await getConnection();
    const second = await getConnection();

    expect(first).toBe(second);
    expect(knexFactory).toHaveBeenCalledTimes(1);
  });

  it('destroys and clears cached instances', async () => {
    const { cleanupConnections, getConnection } = await import('./connection');

    const first = await getConnection();
    expect(knexFactory).toHaveBeenCalledTimes(1);
    expect(createdInstances).toHaveLength(1);

    await cleanupConnections();
    expect(createdInstances[0]?.destroy).toHaveBeenCalledTimes(1);

    const second = await getConnection();
    expect(knexFactory).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });
});

