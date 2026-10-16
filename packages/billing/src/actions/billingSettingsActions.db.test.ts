import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from './_dbTestUtils';

// T002 needs the tenant-settings write to fail *after* the client propagation,
// so the injection sits in the tenant-scoped table factory while the
// transaction, the client rows, and the rollback all stay real.
const injection = vi.hoisted(() => ({ failSettingsWrite: false }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: (conn: Knex | Knex.Transaction, tenant: string) => {
      const real = actual.tenantDb(conn, tenant);
      return {
        ...real,
        table: (tableExpression: string) => {
          const builder = real.table(tableExpression) as Knex.QueryBuilder;
          if (injection.failSettingsWrite && tableExpression === 'default_billing_settings') {
            builder.update = (() => {
              throw new Error('injected tenant settings write failure');
            }) as unknown as Knex.QueryBuilder['update'];
          }
          return builder;
        },
      };
    },
  };
});

import { hasPermission } from '@alga-psa/auth/rbac';
import { updateDefaultBillingSettings } from './billingSettingsActions';

const user = { user_id: 'test-user', user_type: 'internal' as const };

const tenantA = uuidv4();
const tenantB = uuidv4();
const clientAud = uuidv4();
const clientEur = uuidv4();
const clientAud2 = uuidv4();
const clientOtherTenant = uuidv4();

let db: Knex;

const seedClients = async (): Promise<void> => {
  await db('clients').insert([
    {
      tenant: tenantA,
      client_id: clientAud,
      client_name: 'USD follower one',
      is_inactive: false,
      default_currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantA,
      client_id: clientEur,
      client_name: 'EUR override',
      is_inactive: false,
      default_currency_code: 'EUR',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantA,
      client_id: clientAud2,
      client_name: 'USD follower two',
      is_inactive: false,
      default_currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantB,
      client_id: clientOtherTenant,
      client_name: 'Other tenant USD follower',
      is_inactive: false,
      default_currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);
};

const readCurrency = async (clientId: string): Promise<string | undefined> => {
  const row = await db('clients').where({ client_id: clientId }).first();
  return row?.default_currency_code;
};

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert([
    {
      tenant: tenantA,
      client_name: 'Currency propagation A',
      email: `currency-a-${tenantA.slice(0, 8)}@example.invalid`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantB,
      client_name: 'Currency propagation B',
      email: `currency-b-${tenantB.slice(0, 8)}@example.invalid`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);
});

beforeEach(async () => {
  injection.failSettingsWrite = false;
  (hasPermission as Mock).mockReset().mockResolvedValue(true);
  await db('clients').whereIn('tenant', [tenantA, tenantB]).del();
  await db('default_billing_settings').whereIn('tenant', [tenantA, tenantB]).del();
  // Create the settings rows through the action so every NOT NULL column gets
  // its real default, then start both tenants on USD.
  await (updateDefaultBillingSettings as any)(user, { tenant: tenantA }, { defaultCurrencyCode: 'USD' });
  await (updateDefaultBillingSettings as any)(user, { tenant: tenantB }, { defaultCurrencyCode: 'USD' });
  await seedClients();
});

afterAll(async () => {
  await db('clients').whereIn('tenant', [tenantA, tenantB]).del();
  await db('default_billing_settings').whereIn('tenant', [tenantA, tenantB]).del();
  await db('tenants').whereIn('tenant', [tenantA, tenantB]).del();
  await db.destroy().catch(() => undefined);
});

describe('updateDefaultBillingSettings client currency propagation (DB-backed)', () => {
  it('T001: updates matching tenant clients, preserves distinct currencies, and leaves other tenants alone', async () => {
    const result = await (updateDefaultBillingSettings as any)(
      user,
      { tenant: tenantA },
      { defaultCurrencyCode: 'AUD' }
    );

    expect(result).toMatchObject({
      success: true,
      previousCurrencyCode: 'USD',
      currencyCode: 'AUD',
      propagatedClientCount: 2,
      preservedClientCount: 1,
    });

    expect(await readCurrency(clientAud)).toBe('AUD');
    expect(await readCurrency(clientAud2)).toBe('AUD');
    expect(await readCurrency(clientEur)).toBe('EUR');
    expect(await readCurrency(clientOtherTenant)).toBe('USD');

    const settings = await db('default_billing_settings').where({ tenant: tenantA }).first();
    expect(settings.default_currency_code).toBe('AUD');
    const otherSettings = await db('default_billing_settings').where({ tenant: tenantB }).first();
    expect(otherSettings.default_currency_code).toBe('USD');
  });

  it('reports zero propagated and all preserved when no client matches the previous default', async () => {
    await db('clients').where({ tenant: tenantA, client_id: clientAud }).update({ default_currency_code: 'EUR' });
    await db('clients').where({ tenant: tenantA, client_id: clientAud2 }).update({ default_currency_code: 'GBP' });

    const result = await (updateDefaultBillingSettings as any)(
      user,
      { tenant: tenantA },
      { defaultCurrencyCode: 'AUD' }
    );

    expect(result).toMatchObject({
      success: true,
      propagatedClientCount: 0,
      preservedClientCount: 3,
    });
    expect(await readCurrency(clientEur)).toBe('EUR');
  });

  it('T002: an injected tenant-settings failure rolls back the client currency updates', async () => {
    injection.failSettingsWrite = true;

    await expect(
      (updateDefaultBillingSettings as any)(user, { tenant: tenantA }, { defaultCurrencyCode: 'AUD' })
    ).rejects.toThrow('injected tenant settings write failure');

    // The transaction rolled back both the client updates and the settings write.
    expect(await readCurrency(clientAud)).toBe('USD');
    expect(await readCurrency(clientAud2)).toBe('USD');
    const settings = await db('default_billing_settings').where({ tenant: tenantA }).first();
    expect(settings.default_currency_code).toBe('USD');
  });
});
