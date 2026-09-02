import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = { rows: [] as any[] };
  const whereLog: Array<Record<string, unknown>> = [];

  const createQuery = (rows: any[]) => {
    const filters: Record<string, unknown>[] = [];
    const filtered = () =>
      rows.filter((row) => filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));

    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        whereLog.push(cond);
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
      async update(values: Record<string, unknown>) {
        const rowsToUpdate = filtered();
        rowsToUpdate.forEach((row) => Object.assign(row, values));
        return rowsToUpdate.length;
      },
      async insert(values: Record<string, unknown>) {
        rows.push({ provider_id: `provider-${rows.length + 1}`, ...values });
        return [{ provider_id: `provider-${rows.length}` }];
      },
    };
    return query;
  };

  const knexMock: any = () => createQuery(state.rows);
  knexMock.fn = { now: () => 'NOW()' };

  return { state, whereLog, knexMock };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: () => hoisted.knexMock().where({ tenant }),
  }),
}));

import {
  activateThreecxProvider,
  deactivateThreecxProvider,
  getThreecxProviderState,
  parseThreecxConfig,
  rotateThreecxApiKey,
  setThreecxAutoCreateTickets,
} from './providerState';

const TENANT = 'tenant-1';

function seedRow(overrides: Record<string, unknown> = {}) {
  const row = {
    tenant: TENANT,
    provider_id: 'provider-1',
    provider: '3cx',
    status: 'active',
    config: JSON.stringify({ templateVersion: 0, keyRotatedAt: null }),
    auto_create_tickets: false,
    webhook_secret: null,
    ...overrides,
  };
  hoisted.state.rows.push(row);
  return row;
}

describe('threecx provider state', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.whereLog.length = 0;
  });

  it('T030: returns not_configured with null key fields when no row exists', async () => {
    await expect(getThreecxProviderState(TENANT)).resolves.toEqual({
      provider: '3cx',
      status: 'not_configured',
      autoCreateTickets: false,
      keyLastFour: null,
      keyRotatedAt: null,
      templateVersion: 0,
    });
  });

  it('T031: keyLastFour is the last four characters of webhook_secret', async () => {
    seedRow({ webhook_secret: 'abcdefgh1234' });
    const state = await getThreecxProviderState(TENANT);
    expect(state.keyLastFour).toBe('1234');
  });

  it('T032: activation on a tenant without a row inserts an active row with a 43-char base64url key', async () => {
    const result = await activateThreecxProvider(TENANT);
    expect(result.status).toBe('active');
    const row = hoisted.state.rows[0];
    expect(row.status).toBe('active');
    expect(row.webhook_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('T033: activation on a disabled row keeps the existing key and sets status active', async () => {
    seedRow({ status: 'disabled', webhook_secret: 'existing-key-value' });
    const result = await activateThreecxProvider(TENANT);
    expect(result.status).toBe('active');
    expect(hoisted.state.rows[0].webhook_secret).toBe('existing-key-value');
    expect(result.apiKey).toBeNull();
  });

  it('T034: activation returns the full key only when it generated one', async () => {
    const first = await activateThreecxProvider(TENANT);
    expect(first.apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    hoisted.state.rows[0].status = 'disabled';
    const second = await activateThreecxProvider(TENANT);
    expect(second.apiKey).toBeNull();
  });

  it('T035: deactivation sets status disabled and leaves the key in place', async () => {
    seedRow({ status: 'active', webhook_secret: 'keep-this-key' });
    const state = await deactivateThreecxProvider(TENANT);
    expect(state.status).toBe('disabled');
    expect(hoisted.state.rows[0].webhook_secret).toBe('keep-this-key');
  });

  it('T036: rotation writes a new key and a recent config.keyRotatedAt', async () => {
    seedRow({ webhook_secret: 'old-key' });
    const before = Date.now();
    const result = await rotateThreecxApiKey(TENANT);

    expect(result.apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hoisted.state.rows[0].webhook_secret).toBe(result.apiKey);
    expect(hoisted.state.rows[0].webhook_secret).not.toBe('old-key');

    const config = parseThreecxConfig(hoisted.state.rows[0].config);
    expect(config.keyRotatedAt).not.toBeNull();
    expect(new Date(config.keyRotatedAt as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('T037: after rotation the stored secret matches the new key, not the old', async () => {
    seedRow({ webhook_secret: 'old-key' });
    const result = await rotateThreecxApiKey(TENANT);
    const stored = hoisted.state.rows[0].webhook_secret;
    expect(stored === result.apiKey).toBe(true);
    expect(stored === 'old-key').toBe(false);
  });

  it('T038: a malformed config reads as templateVersion 0 / keyRotatedAt null', async () => {
    seedRow({ config: 'not-json' });
    const state = await getThreecxProviderState(TENANT);
    expect(state.templateVersion).toBe(0);
    expect(state.keyRotatedAt).toBeNull();
  });

  it('T039: setThreecxAutoCreateTickets flips auto_create_tickets on the row', async () => {
    seedRow({ auto_create_tickets: false });
    await setThreecxAutoCreateTickets(TENANT, true);
    expect(hoisted.state.rows[0].auto_create_tickets).toBe(true);
  });

  it('T040: every provider-state query is tenant-scoped', async () => {
    seedRow({ webhook_secret: 'k' });
    await getThreecxProviderState(TENANT);
    await activateThreecxProvider(TENANT);
    await deactivateThreecxProvider(TENANT);
    await rotateThreecxApiKey(TENANT);
    expect(hoisted.whereLog.length).toBeGreaterThan(0);
    expect(hoisted.whereLog.every((cond) => 'tenant' in cond || 'provider' in cond || 'provider_id' in cond)).toBe(true);
    expect(hoisted.whereLog.some((cond) => (cond as any).tenant === TENANT)).toBe(true);
  });
});
