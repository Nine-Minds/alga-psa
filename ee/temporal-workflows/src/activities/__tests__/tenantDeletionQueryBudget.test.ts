/**
 * L0b neutrality: the tenant deletion activity issues exactly the statements it did
 * before the manifest (a knex dialect listener records them). Runs only against a
 * migrated, disposable database: HOTPATH_DB=1 plus DB_HOST/DB_PORT/DB_NAME_SERVER/
 * DB_USER_ADMIN/DB_PASSWORD_ADMIN. HOTPATH_OUT=<prefix> writes the capture that
 * scripts/review/hotpath-diff.mjs compares across commits.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MockActivityEnvironment } from '@temporalio/testing';
// @ts-expect-error plain ESM helper
import { startRecording, emitStep } from '../../../../../scripts/review/hotpathRecorder.mjs';

const enabled = process.env.HOTPATH_DB === '1';

describe.skipIf(!enabled)('tenant deletion query budget', () => {
  it('deletes Stripe mappings before bindings and preserves another tenant through the real deletion activity', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin.js');
    const { deleteTenantData } = await import('../tenant-deletion-activities');
    const admin = await getAdminConnection();
    const target = randomUUID();
    const other = randomUUID();
    const targetCustomer = `cus_delete_${target}`;
    const otherCustomer = `cus_keep_${other}`;
    try {
      await admin('tenants').insert([
        { tenant: target, client_name: 'Stripe deletion target', email: `${target}@example.test` },
        { tenant: other, client_name: 'Stripe deletion neighbor', email: `${other}@example.test` },
      ]);
      await admin('stripe_customer_bindings').insert([
        { tenant: target, stripe_customer_external_id: targetCustomer },
        { tenant: other, stripe_customer_external_id: otherCustomer },
      ]);
      await admin('stripe_customers').insert([
        { tenant: target, stripe_customer_external_id: targetCustomer, email: `${target}@example.test` },
        { tenant: other, stripe_customer_external_id: otherCustomer, email: `${other}@example.test` },
      ]);

      const result = await new MockActivityEnvironment().run(() => deleteTenantData(target, randomUUID()));
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(await admin('stripe_customers').where({ tenant: target })).toHaveLength(0);
      expect(await admin('stripe_customer_bindings').where({ tenant: target })).toHaveLength(0);
      expect(await admin('stripe_customers').where({ tenant: other }).select('stripe_customer_external_id'))
        .toEqual([{ stripe_customer_external_id: otherCustomer }]);
      expect(await admin('stripe_customer_bindings').where({ tenant: other }).select('stripe_customer_external_id'))
        .toEqual([{ stripe_customer_external_id: otherCustomer }]);
    } finally {
      await admin('stripe_customers').whereIn('tenant', [target, other]).del();
      await admin('stripe_customer_bindings').whereIn('tenant', [target, other]).del();
      await admin('tenants').whereIn('tenant', [target, other]).del();
      await admin.destroy();
    }
  }, 300_000);

  it('deleteTenantData on a fixture tenant records a stable statement list', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin.js');
    const { deleteTenantData } = await import('../tenant-deletion-activities');
    const admin = await getAdminConnection();
    const tenant = randomUUID();
    await admin('tenants').insert({ tenant, client_name: 'hotpath fixture', email: 'fixture@example.com' });

    const recorder = startRecording();
    const result = await new MockActivityEnvironment().run(() => deleteTenantData(tenant, randomUUID()));
    recorder.stop();

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(recorder.statements.length).toBeGreaterThan(549);
    // A1: the manifest adds no co-managed probes to the deletion path.
    expect(recorder.statements.some((s: { sql: string }) => /co_manag|product_code/.test(s.sql))).toBe(false);
    emitStep('tenant-deletion-dry-run', recorder.statements);
    await admin.destroy();
  }, 300_000);
});
