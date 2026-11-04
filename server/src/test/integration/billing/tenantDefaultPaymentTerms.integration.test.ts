import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import { resolveEffectiveBillingIdentity } from '@alga-psa/shared/billingClients/billingProfileSettings';
import {
  readTenantDefaultPaymentTerms,
  resolveTenantDefaultPaymentTerms,
} from '@alga-psa/shared/billingClients/tenantPaymentTerms';
import { resolveInvoiceDueDate } from '../../../../../packages/billing/src/lib/billing/invoiceDueDate';

/**
 * Tenant-level default payment term (alga-2026-0002607 follow-up;
 * ee/docs/plans/2026-10-20-tenant-default-payment-term.md).
 *
 * Resolution is profile → client → tenant default → Net 30, and every due-date
 * path reads it through resolveEffectiveBillingIdentity. Manual and generated
 * invoice `due_date` end to end is covered in
 * src/test/infrastructure/billing/invoices/manualInvoice.test.ts.
 */

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 300_000;
const migration = require(
  path.resolve(process.cwd(), 'migrations', '20261020120000_add_default_payment_terms_to_billing_settings.cjs'),
);

let db: Knex;
let tenantId: string;

// The settings actions are withAuth-wrapped and open their own connection.
const authRef: { user: any } = { user: null };
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => authRef.user),
  hasPermission: vi.fn(async () => true),
  withAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user, { tenant: authRef.user.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user, { tenant: authRef.user.tenant }, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => action(authRef.user, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
  };
});

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function createClient(values: Record<string, unknown>): Promise<string> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 6)}`,
    billing_cycle: 'monthly',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...values,
  });
  await ensureDefaultBillingProfile({ db, tenantId }, clientId);
  return clientId;
}

/** Set the stored tenant default directly (bypassing the action), creating the row if needed. */
async function setTenantDefault(value: string | null) {
  const existing = await table('default_billing_settings').first();
  if (existing) {
    await table('default_billing_settings').update({ default_payment_terms: value });
  } else {
    await table('default_billing_settings').insert({
      tenant: tenantId,
      default_payment_terms: value,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
    });
  }
}

async function clearTenantSettingsRow() {
  await table('default_billing_settings').delete();
}

describe('tenant default payment terms', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_tenant_default_payment_terms' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Tenant Terms Fixture',
        email: `ttd-${tenantId.slice(0, 8)}@profiles.test`,
      });
    authRef.user = { user_id: uuidv4(), tenant: tenantId, roles: [{ role_name: 'Admin' }] };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('unset profile and client take the tenant default, with source "tenant"', async () => {
    await setTenantDefault('net_14');
    const clientId = await createClient({ payment_terms: '' });

    const identity = await resolveEffectiveBillingIdentity(db, tenantId, clientId);
    expect(identity.paymentTerms).toBe('net_14');
    expect(identity.paymentTermsSource).toBe('tenant');
    expect(identity.overriddenFields).not.toContain('payment_terms');
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22')).toBe('2026-10-06');
  }, HOOK_TIMEOUT);

  it('a client term wins over the tenant default, and a profile term wins over both', async () => {
    await setTenantDefault('net_14');
    const clientId = await createClient({ payment_terms: 'net_7' });
    const onReceipt = await createBillingProfile({ db, tenantId }, clientId, 'On Receipt');
    await table('client_billing_profiles')
      .where({ billing_profile_id: onReceipt })
      .update({ payment_terms: 'due_on_receipt' });

    const clientWins = await resolveEffectiveBillingIdentity(db, tenantId, clientId);
    expect(clientWins.paymentTerms).toBe('net_7');
    expect(clientWins.paymentTermsSource).toBe('client');
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22')).toBe('2026-09-29');

    const profileWins = await resolveEffectiveBillingIdentity(db, tenantId, clientId, onReceipt);
    expect(profileWins.paymentTerms).toBe('due_on_receipt');
    expect(profileWins.paymentTermsSource).toBe('profile');
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22', onReceipt)).toBe('2026-09-22');
  }, HOOK_TIMEOUT);

  it('a legacy free-text client value falls through to the tenant default', async () => {
    await setTenantDefault('net_14');
    const clientId = await createClient({ payment_terms: 'Net 45 days' });

    const identity = await resolveEffectiveBillingIdentity(db, tenantId, clientId);
    expect(identity.paymentTerms).toBe('net_14');
    expect(identity.paymentTermsSource).toBe('tenant');
  }, HOOK_TIMEOUT);

  it('no row, a NULL column, or an unknown stored value resolve to net_30 with source "system"', async () => {
    const clientId = await createClient({ payment_terms: '' });

    await clearTenantSettingsRow();
    for (const arrange of [
      async () => undefined, // no settings row
      async () => setTenantDefault(null),
      async () => setTenantDefault('net_45'),
    ]) {
      await arrange();
      const identity = await resolveEffectiveBillingIdentity(db, tenantId, clientId);
      expect(identity.paymentTerms).toBe('net_30');
      expect(identity.paymentTermsSource).toBe('system');
      expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22')).toBe('2026-10-22');
    }

    await clearTenantSettingsRow();
    expect(await readTenantDefaultPaymentTerms(db, tenantId)).toBeNull();
    expect(await resolveTenantDefaultPaymentTerms(db, tenantId)).toBe('net_30');
  }, HOOK_TIMEOUT);

  describe('updateDefaultBillingSettings', () => {
    it('rejects an unknown term, clears with null, and leaves the column alone when the key is omitted', async () => {
      const { updateDefaultBillingSettings, getDefaultBillingSettings } = await import(
        '@alga-psa/billing/actions/billingSettingsActions'
      );
      await clearTenantSettingsRow();

      // Insert branch (no row yet).
      expect(await updateDefaultBillingSettings({ defaultPaymentTerms: 'net_14' })).toMatchObject({ success: true });
      expect((await getDefaultBillingSettings() as any).defaultPaymentTerms).toBe('net_14');

      // Rejected before anything is written.
      const rejected = await updateDefaultBillingSettings({ defaultPaymentTerms: 'net_45' as any });
      expect(rejected).toMatchObject({
        actionError: expect.any(String),
        messageKey: 'msp/billing-settings:general.paymentTerms.errors.invalid',
      });
      expect(await readTenantDefaultPaymentTerms(db, tenantId)).toBe('net_14');

      // A save from another section omits the key: untouched.
      await updateDefaultBillingSettings({ suppressZeroDollarInvoices: true });
      expect(await readTenantDefaultPaymentTerms(db, tenantId)).toBe('net_14');

      // null clears it (not set → Net 30).
      expect(await updateDefaultBillingSettings({ defaultPaymentTerms: null })).toMatchObject({ success: true });
      expect(await readTenantDefaultPaymentTerms(db, tenantId)).toBeNull();
      expect((await getDefaultBillingSettings() as any).defaultPaymentTerms).toBeNull();
    }, HOOK_TIMEOUT);

    it('does not rewrite existing clients when the default changes', async () => {
      const { updateDefaultBillingSettings } = await import('@alga-psa/billing/actions/billingSettingsActions');
      const pinned = await createClient({ payment_terms: 'net_30' });
      await updateDefaultBillingSettings({ defaultPaymentTerms: 'net_7' });
      const row = await table('clients').where({ client_id: pinned }).first('payment_terms');
      expect(row.payment_terms).toBe('net_30');
      expect((await resolveEffectiveBillingIdentity(db, tenantId, pinned)).paymentTerms).toBe('net_30');
    }, HOOK_TIMEOUT);
  });

  it('migration is idempotent and down drops the column', async () => {
    await migration.up(db);
    expect(await db.schema.hasColumn('default_billing_settings', 'default_payment_terms')).toBe(true);
    await migration.down(db);
    expect(await db.schema.hasColumn('default_billing_settings', 'default_payment_terms')).toBe(false);
    await migration.up(db);
    expect(await db.schema.hasColumn('default_billing_settings', 'default_payment_terms')).toBe(true);
  }, HOOK_TIMEOUT);
});
