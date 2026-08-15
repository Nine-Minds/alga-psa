import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { tenantTableMetadata } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(__dirname, '../20260815000000_add_prepaid_balance_alerts.cjs');
const TENANT_DB_SHIM_PATH = path.resolve(__dirname, '../utils/tenantDb.cjs');

let db: Knex;
let tenantId: string;
let clientId: string;

async function constraintProbe(sql: string): Promise<'accepted' | 'rejected'> {
  try {
    await db.raw(sql);
    return 'accepted';
  } catch (error) {
    return 'rejected';
  }
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  tenantId = randomUUID();
  clientId = randomUUID();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Prepaid Migration Test',
    email: `prepaid-migration-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Prepaid Migration Client ${clientId.slice(0, 8)}`,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, 300_000);

afterAll(async () => {
  if (!db) return;
  await db('client_billing_settings').where({ tenant: tenantId }).del();
  await db('prepaid_balance_alert_deliveries').where({ tenant: tenantId }).del();
  await db('prepaid_balance_alerts').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('prepaid balance alerts migration (DB-backed)', () => {
  it('T005: settings checks accept valid combos and reject invalid ranges/unpaired credit', async () => {
    const T = `'${tenantId}'::uuid`;
    const C = `'${clientId}'::uuid`;

    // Valid: full policy.
    expect(await constraintProbe(
      `INSERT INTO client_billing_settings (tenant, client_id, zero_dollar_invoice_handling, suppress_zero_dollar_invoices, prepaid_credit_alert_threshold, prepaid_credit_alert_currency_code, bucket_usage_alert_percent, notify_client_on_prepaid_alert, created_at, updated_at)
       VALUES (${T}, ${C}, 'normal', false, 5000, 'USD', 80, true, now(), now())`
    )).toBe('accepted');

    // Valid: all disabled (nulls, opt-in false).
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET prepaid_credit_alert_threshold = NULL, prepaid_credit_alert_currency_code = NULL, bucket_usage_alert_percent = NULL, notify_client_on_prepaid_alert = false WHERE client_id = ${C}`
    )).toBe('accepted');

    // Valid: credit only.
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET prepaid_credit_alert_threshold = 100, prepaid_credit_alert_currency_code = 'EUR', bucket_usage_alert_percent = NULL WHERE client_id = ${C}`
    )).toBe('accepted');

    // Rejected: negative threshold.
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET prepaid_credit_alert_threshold = -1 WHERE client_id = ${C}`
    )).toBe('rejected');

    // Rejected: non-uppercase currency.
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET prepaid_credit_alert_currency_code = 'usd' WHERE client_id = ${C}`
    )).toBe('rejected');

    // Rejected: unpaired credit (amount without currency).
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET prepaid_credit_alert_threshold = 100, prepaid_credit_alert_currency_code = NULL WHERE client_id = ${C}`
    )).toBe('rejected');

    // Rejected: out-of-range percent.
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET bucket_usage_alert_percent = 101 WHERE client_id = ${C}`
    )).toBe('rejected');

    // Rejected: zero percent.
    expect(await constraintProbe(
      `UPDATE client_billing_settings SET bucket_usage_alert_percent = 0 WHERE client_id = ${C}`
    )).toBe('rejected');

    await db('client_billing_settings').where({ client_id: clientId }).del();
  });

  it('T006: composite tenant keys, unique dedupe/delivery keys, and tenant metadata registration', async () => {
    // Composite FK: an alert referencing a client in another tenant must fail.
    const otherTenantId = randomUUID();
    await db('tenants').insert({
      tenant: otherTenantId,
      client_name: 'Prepaid Other Tenant',
      email: `prepaid-other-${otherTenantId.slice(0, 8)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const otherClientId = randomUUID();
    await db('clients').insert({
      tenant: otherTenantId,
      client_id: otherClientId,
      client_name: `Prepaid Other Client ${otherClientId.slice(0, 8)}`,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const crossTenant = await constraintProbe(
      `INSERT INTO prepaid_balance_alerts (tenant, alert_id, client_id, alert_type, dedupe_key, episode, created_at, updated_at)
       VALUES ('${tenantId}'::uuid, '${randomUUID()}'::uuid, '${otherClientId}'::uuid, 'credit', 'credit:x:USD:ep1', 1, now(), now())`
    );
    expect(crossTenant).toBe('rejected');

    // Unique (tenant, dedupe_key): duplicate dedupe key rejected.
    const alertId = randomUUID();
    await db('prepaid_balance_alerts').insert({
      tenant: tenantId,
      alert_id: alertId,
      client_id: clientId,
      alert_type: 'credit',
      dedupe_key: 'credit:dup:USD:ep1',
      episode: 1,
      credit_threshold: 100,
      credit_currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const dupDedupe = await constraintProbe(
      `INSERT INTO prepaid_balance_alerts (tenant, alert_id, client_id, alert_type, dedupe_key, episode, created_at, updated_at)
       VALUES ('${tenantId}'::uuid, '${randomUUID()}'::uuid, '${clientId}'::uuid, 'credit', 'credit:dup:USD:ep1', 2, now(), now())`
    );
    expect(dupDedupe).toBe('rejected');

    // Unique (tenant, alert_id, channel, recipient_key): duplicate delivery rejected.
    await db('prepaid_balance_alert_deliveries').insert({
      tenant: tenantId,
      delivery_id: randomUUID(),
      alert_id: alertId,
      channel: 'email',
      recipient_roles: JSON.stringify(['account_manager']),
      recipient_key: 'dup@example.com',
      status: 'pending',
      attempt_count: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const dupDelivery = await constraintProbe(
      `INSERT INTO prepaid_balance_alert_deliveries (tenant, delivery_id, alert_id, channel, recipient_roles, recipient_key, status, attempt_count, created_at, updated_at)
       VALUES ('${tenantId}'::uuid, '${randomUUID()}'::uuid, '${alertId}'::uuid, 'email', '["account_manager"]', 'dup@example.com', 'pending', 0, now(), now())`
    );
    expect(dupDelivery).toBe('rejected');

    // Terminal 'superseded' status is accepted (resolved-alert delivery
    // exclusion marks orphaned sends with it).
    const superseded = await constraintProbe(
      `UPDATE prepaid_balance_alert_deliveries
       SET status = 'superseded', last_error = 'Superseded: alert resolved before delivery'
       WHERE tenant = '${tenantId}'::uuid AND alert_id = '${alertId}'::uuid`
    );
    expect(superseded).toBe('accepted');

    // Cross-tenant delivery reference must fail.
    const crossDelivery = await constraintProbe(
      `INSERT INTO prepaid_balance_alert_deliveries (tenant, delivery_id, alert_id, channel, recipient_roles, recipient_key, status, attempt_count, created_at, updated_at)
       VALUES ('${otherTenantId}'::uuid, '${randomUUID()}'::uuid, '${alertId}'::uuid, 'email', '["account_manager"]', 'x@example.com', 'pending', 0, now(), now())`
    );
    expect(crossDelivery).toBe('rejected');

    // Both tables registered in runtime and migration-only tenant metadata.
    expect(tenantTableMetadata.prepaid_balance_alerts).toEqual({ scope: 'tenant' });
    expect(tenantTableMetadata.prepaid_balance_alert_deliveries).toEqual({ scope: 'tenant' });
    const shim = require(TENANT_DB_SHIM_PATH) as { TENANT_TABLE_METADATA: Record<string, unknown> };
    expect(shim.TENANT_TABLE_METADATA.prepaid_balance_alerts).toEqual({ scope: 'tenant' });
    expect(shim.TENANT_TABLE_METADATA.prepaid_balance_alert_deliveries).toEqual({ scope: 'tenant' });

    await db('prepaid_balance_alert_deliveries').where({ alert_id: alertId }).del();
    await db('prepaid_balance_alerts').where({ alert_id: alertId }).del();
    await db('clients').where({ tenant: otherTenantId }).del();
    await db('tenants').where({ tenant: otherTenantId }).del();
  });

  it('T007: indexes exist, defaults are inert, and down removes deliveries before alerts before columns', async () => {
    // Claim + scan indexes exist.
    const indexes = await db.raw(`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('prepaid_balance_alerts', 'prepaid_balance_alert_deliveries')
    `);
    const names = indexes.rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('prepaid_balance_alert_deliveries_claim_idx');
    expect(names).toContain('prepaid_balance_alerts_open_client_idx');
    expect(names).toContain('prepaid_balance_alerts_type_state_idx');
    expect(names).toContain('prepaid_balance_alert_deliveries_identity_unique');

    // Inert defaults: a fresh billing-settings row has no alert policy enabled.
    const freshClientId = randomUUID();
    await db('clients').insert({
      tenant: tenantId,
      client_id: freshClientId,
      client_name: `Prepaid Fresh ${freshClientId.slice(0, 8)}`,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('client_billing_settings').insert({
      tenant: tenantId,
      client_id: freshClientId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const fresh = await db('client_billing_settings').where({ client_id: freshClientId }).first();
    expect(fresh.prepaid_credit_alert_threshold).toBeNull();
    expect(fresh.prepaid_credit_alert_currency_code).toBeNull();
    expect(fresh.bucket_usage_alert_percent).toBeNull();
    expect(fresh.notify_client_on_prepaid_alert).toBe(false);
    await db('client_billing_settings').where({ client_id: freshClientId }).del();
    await db('clients').where({ client_id: freshClientId }).del();

    // Down order: deliveries dropped first, then alerts, then the settings
    // columns/checks. Run down then re-run up so the migration stays applied
    // for any later file in the same fork.
    const migration = require(MIGRATION_PATH) as { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
    await migration.down(db);
    const hasDeliveries = await db.schema.hasTable('prepaid_balance_alert_deliveries');
    const hasAlerts = await db.schema.hasTable('prepaid_balance_alerts');
    expect(hasDeliveries).toBe(false);
    expect(hasAlerts).toBe(false);
    const hasColumn = await db.schema.hasColumn('client_billing_settings', 'prepaid_credit_alert_threshold');
    expect(hasColumn).toBe(false);

    // The down migration also removes the seeded notification templates and
    // subtypes (and the now-empty categories).
    expect(await db('system_email_templates').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeUndefined();
    expect(await db('internal_notification_templates').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeUndefined();
    expect(await db('notification_subtypes').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeUndefined();
    expect(await db('internal_notification_subtypes').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeUndefined();
    expect(await db('notification_categories').where({ name: 'Prepaid Alerts' }).first()).toBeUndefined();
    expect(await db('internal_notification_categories').where({ name: 'prepaid-alerts' }).first()).toBeUndefined();

    await migration.up(db);
    expect(await db.schema.hasTable('prepaid_balance_alerts')).toBe(true);
    expect(await db.schema.hasTable('prepaid_balance_alert_deliveries')).toBe(true);
    expect(await db.schema.hasColumn('client_billing_settings', 'prepaid_credit_alert_threshold')).toBe(true);
    expect(await db.schema.hasColumn('client_billing_settings', 'notify_client_on_prepaid_alert')).toBe(true);
    expect(await db('system_email_templates').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeDefined();
    expect(await db('internal_notification_templates').whereIn('name', ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']).first()).toBeDefined();
  });
});
