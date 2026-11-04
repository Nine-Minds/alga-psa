import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Knex } from 'knex';
import { tenantTableMetadata } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261012120000_contract_template_currency_and_price_sets.cjs'));
const shim = require(path.resolve(__dirname, '../utils/tenantDb.cjs'));

class Rollback extends Error {}

let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

/** Run `body` against the pre-migration shape inside a transaction that always rolls back. */
async function withPreMigrationSchema(body: (trx: Knex.Transaction) => Promise<void>) {
  try {
    await db.transaction(async (trx) => {
      await migration.down(trx);
      await body(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function seedTenant(trx: Knex.Transaction, defaultCurrency: string | null) {
  const tenant = randomUUID();
  await trx('tenants').insert({
    tenant,
    client_name: `Template currency ${tenant.slice(0, 8)}`,
    email: `tc-${tenant.slice(0, 8)}@example.com`,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
  if (defaultCurrency) {
    await trx('default_billing_settings').insert({ tenant, default_currency_code: defaultCurrency });
  }
  const templateId = randomUUID();
  await trx('contract_templates').insert({ tenant, template_id: templateId, template_name: 'T' });
  return { tenant, templateId };
}

describe('contract template currency migration (DB-backed)', () => {
  it('backfills each tenant from default_billing_settings, falls back to USD, then NOT NULL', async () => {
    await withPreMigrationSchema(async (trx) => {
      const eur = await seedTenant(trx, 'EUR');
      const none = await seedTenant(trx, null);
      const jpy = await seedTenant(trx, 'JPY');

      await migration.up(trx);

      const read = async (s: { tenant: string; templateId: string }) =>
        (await trx('contract_templates').where({ tenant: s.tenant, template_id: s.templateId }).first()).currency_code;
      expect(await read(eur)).toBe('EUR');
      expect(await read(none)).toBe('USD');
      expect(await read(jpy)).toBe('JPY');

      const col = await trx.raw(
        `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'contract_templates' AND column_name = 'currency_code'`,
      );
      expect(col.rows[0].is_nullable).toBe('NO');
      expect(col.rows[0].column_default).toBeNull();
    });
  });

  it('backfillCurrency falls back to USD for missing or malformed codes', () => {
    expect(migration.backfillCurrency(undefined)).toBe('USD');
    expect(migration.backfillCurrency('')).toBe('USD');
    expect(migration.backfillCurrency('euro')).toBe('USD');
    expect(migration.backfillCurrency('gbp')).toBe('GBP');
  });

  it('creates the price tables with the agreed constraints, and cascades from the template', async () => {
    const tenant = randomUUID();
    const templateId = randomUUID();
    const lineId = randomUUID();
    await db.transaction(async (trx) => {
      await trx('tenants').insert({
        tenant,
        client_name: `Price sets ${tenant.slice(0, 8)}`,
        email: `ps-${tenant.slice(0, 8)}@example.com`,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      await trx('contract_templates').insert({ tenant, template_id: templateId, template_name: 'T', currency_code: 'USD' });
      await trx('contract_template_lines').insert({
        tenant, template_id: templateId, template_line_id: lineId, template_line_name: 'L',
      });
      await trx('contract_template_price_sets').insert({ tenant, template_id: templateId, currency_code: 'EUR' });
      const price = (over: Record<string, unknown>) => ({
        tenant, template_id: templateId, currency_code: 'EUR', template_line_id: lineId,
        slot_kind: 'line_base_rate', slot_key: `line:${lineId}:base_rate`, rate: 100, ...over,
      });
      await trx('contract_template_prices').insert(price({}));

      const probe = async (over: Record<string, unknown>) => {
        await trx.raw('SAVEPOINT p');
        try {
          await trx('contract_template_prices').insert(price(over));
          await trx.raw('RELEASE SAVEPOINT p');
          return 'accepted';
        } catch {
          await trx.raw('ROLLBACK TO SAVEPOINT p');
          return 'rejected';
        }
      };
      expect(await probe({})).toBe('rejected'); // unique (tenant, template, currency, slot_key)
      expect(await probe({ slot_key: 'k2', rate: -1 })).toBe('rejected');
      expect(await probe({ slot_key: 'k3', slot_kind: 'bogus' })).toBe('rejected');
      expect(await probe({ slot_key: 'k4', currency_code: 'GBP' })).toBe('rejected'); // no GBP set
      expect(await probe({ slot_key: 'k5', template_line_id: randomUUID() })).toBe('rejected');

      await trx('contract_template_lines').where({ tenant, template_line_id: lineId }).del();
      expect(await trx('contract_template_prices').where({ tenant }).count('* as c').first().then((r) => Number(r?.c))).toBe(0);

      await trx('contract_templates').where({ tenant, template_id: templateId }).del();
      expect(await trx('contract_template_price_sets').where({ tenant }).count('* as c').first().then((r) => Number(r?.c))).toBe(0);
      await trx.rollback();
    }).catch((e) => {
      if (!/Transaction rejected with non-error|rollback/i.test(String(e?.message ?? e))) throw e;
    });
  });

  it('down migration is clean and up is re-runnable', async () => {
    await withPreMigrationSchema(async (trx) => {
      expect(await trx.schema.hasTable('contract_template_prices')).toBe(false);
      expect(await trx.schema.hasTable('contract_template_price_sets')).toBe(false);
      expect(await trx.schema.hasColumn('contract_templates', 'currency_code')).toBe(false);
      await migration.up(trx);
      expect(await trx.schema.hasTable('contract_template_prices')).toBe(true);
    });
  });

  it('registers both tables as tenant tables in the metadata and the migration shim', () => {
    for (const table of ['contract_template_price_sets', 'contract_template_prices']) {
      expect(tenantTableMetadata[table]).toEqual({ scope: 'tenant' });
      expect(() => shim.tenantDb({} as any, 't').table(table)).not.toThrow(/No tenant table metadata/);
    }
  });
});
