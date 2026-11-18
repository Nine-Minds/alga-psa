import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for widening tenants.product_code to admit 'co_managed'
// (20261028130000 step 1, 20261028133000 step 2, 20261028134000 step 3). The
// sequence must end with one validated three-value constraint under the
// original name without RENAME CONSTRAINT, which Citus refuses on the
// distributed `tenants` table, and must recover from the state the earlier
// rename-based step 2 left behind when it failed on Citus mid-way.

const require = createRequire(import.meta.url);
type Migration = { up: (knex: Knex) => Promise<void> };
const step2: Migration = require(path.resolve(__dirname, '../20261028133000_validate_product_code_check.cjs'));
const step3: Migration = require(path.resolve(__dirname, '../20261028134000_finalize_product_code_check.cjs'));

const OLD = 'tenants_product_code_check';
const NEXT = 'tenants_product_code_check_co_managed';
const TWO_VALUES = "CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk'))";
const THREE_VALUES = "CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk', 'co_managed'))";

let db: Knex;
const tenantIds: string[] = [];

async function productChecks(): Promise<Array<{ name: string; validated: boolean; def: string }>> {
  const { rows } = await db.raw(
    `SELECT conname AS name, convalidated AS validated, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'tenants'::regclass AND conname LIKE 'tenants_product_code_check%'
      ORDER BY conname`
  );
  return rows;
}

async function resetConstraints(...statements: string[]): Promise<void> {
  await db.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${NEXT}`);
  await db.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${OLD}`);
  for (const sql of statements) await db.raw(sql);
}

async function insertTenant(productCode: string): Promise<void> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Product Check ${productCode}`,
    email: `product-check-${tenant.slice(0, 8)}@example.com`,
    product_code: productCode,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  tenantIds.push(tenant);
}

async function expectWidenedOnce(): Promise<void> {
  const checks = await productChecks();
  expect(checks).toHaveLength(1);
  expect(checks[0].name).toBe(OLD);
  expect(checks[0].validated).toBe(true);
  expect(checks[0].def).toContain("'co_managed'");
  await insertTenant('co_managed');
  await expect(insertTenant('not_a_product')).rejects.toThrow(/tenants_product_code_check/);
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
}, 300_000);

afterAll(async () => {
  if (!db) return;
  await db('tenants').whereIn('tenant', tenantIds).del().catch(() => undefined);
  // Leave tenants in the migrated state even if a test failed mid-way.
  await resetConstraints(`ALTER TABLE tenants ADD CONSTRAINT ${OLD} ${THREE_VALUES}`).catch(() => undefined);
  await db.destroy().catch(() => undefined);
});

describe('tenants.product_code co_managed widening (DB-backed)', () => {
  it('replaces the two-value check under its original name from the step-1 state', async () => {
    // NOT VALID only so seeded co_managed tenants don't block the setup.
    await resetConstraints(
      `ALTER TABLE tenants ADD CONSTRAINT ${OLD} ${TWO_VALUES} NOT VALID`,
      `ALTER TABLE tenants ADD CONSTRAINT ${NEXT} ${THREE_VALUES} NOT VALID`
    );

    await step2.up(db);
    // Between steps the validated temporary check guards writes.
    const between = await productChecks();
    expect(between.map((c) => [c.name, c.validated])).toEqual([[OLD, false], [NEXT, true]]);
    await expect(insertTenant('not_a_product')).rejects.toThrow(/tenants_product_code_check/);

    await step3.up(db);
    await expectWidenedOnce();
  });

  it('recovers from the half-applied rename-based step 2 (temporary check validated, original dropped)', async () => {
    await resetConstraints(`ALTER TABLE tenants ADD CONSTRAINT ${NEXT} ${THREE_VALUES}`);

    await step2.up(db);
    await step3.up(db);
    await expectWidenedOnce();
  });

  it('is a no-op once widened', async () => {
    await resetConstraints(`ALTER TABLE tenants ADD CONSTRAINT ${OLD} ${THREE_VALUES}`);

    await step2.up(db);
    await step3.up(db);
    await expectWidenedOnce();
  });
});
