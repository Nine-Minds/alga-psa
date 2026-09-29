import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { listPaymentMethods } from '@alga-psa/shared/billingClients/billingProfilePayments';
import { resolveInvoiceDueDate } from '../../../../../packages/billing/src/lib/billing/invoiceDueDate';

/**
 * Payment method and payment terms per billing profile
 * (ee/docs/plans/2026-09-22-billing-profile-payment-methods — T001–T003, Q3).
 *
 * Both follow the profile inheritance rule: NULL on the profile means "use the
 * client's value", and the client's legacy free-text values count as unset
 * rather than leaking into billing.
 */

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 300_000;
const MIGRATION_DIR = path.resolve(process.cwd(), 'migrations');
const paymentMethodMigration = require(
  path.join(MIGRATION_DIR, '20260922120000_add_billing_profile_payment_method.cjs'),
);

let db: Knex;
let tenantId: string;

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

async function setProfile(billingProfileId: string, values: Record<string, unknown>) {
  await table('client_billing_profiles')
    .where({ billing_profile_id: billingProfileId })
    .update(values);
}

describe('billing profile payment method and terms', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profile_payment_method' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Payment Method Fixture',
        email: `pm-${tenantId.slice(0, 8)}@profiles.test`,
      });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T001: a profile inherits the client method, and its own value overrides it', async () => {
    const clientId = await createClient({ preferred_payment_method: 'credit_card' });
    const inheriting = await createBillingProfile({ db, tenantId }, clientId, 'Card Site');
    const overriding = await createBillingProfile({ db, tenantId }, clientId, 'Check Site');
    await setProfile(overriding, { preferred_payment_method: 'check' });

    const inherited = await resolveEffectiveBillingIdentity(db, tenantId, clientId, inheriting);
    const overridden = await resolveEffectiveBillingIdentity(db, tenantId, clientId, overriding);

    expect(inherited.preferredPaymentMethod).toBe('credit_card');
    expect(inherited.overriddenFields).not.toContain('preferred_payment_method');
    expect(overridden.preferredPaymentMethod).toBe('check');
    expect(overridden.overriddenFields).toContain('preferred_payment_method');
  }, HOOK_TIMEOUT);

  it('T001: the client legacy blank or free-text method resolves to null without throwing', async () => {
    const blankClientId = await createClient({ preferred_payment_method: '' });
    const freeTextClientId = await createClient({ preferred_payment_method: 'Wire transfer please' });

    expect((await resolveEffectiveBillingIdentity(db, tenantId, blankClientId)).preferredPaymentMethod).toBeNull();
    expect((await resolveEffectiveBillingIdentity(db, tenantId, freeTextClientId)).preferredPaymentMethod).toBeNull();
  }, HOOK_TIMEOUT);

  it('T002: the database rejects an unknown profile payment method and accepts null', async () => {
    const clientId = await createClient({});
    const profileId = await createBillingProfile({ db, tenantId }, clientId, 'Constrained');

    await expect(setProfile(profileId, { preferred_payment_method: 'bitcoin' })).rejects.toThrow(
      /preferred_payment_method_check/,
    );
    await setProfile(profileId, { preferred_payment_method: 'bank_transfer' });
    await setProfile(profileId, { preferred_payment_method: null });
    const row = await table('client_billing_profiles').where({ billing_profile_id: profileId }).first();
    expect(row.preferred_payment_method).toBeNull();
  }, HOOK_TIMEOUT);

  it('T003: the card on file is the profile default, never a sibling profile card', async () => {
    const clientId = await createClient({});
    const withCard = await createBillingProfile({ db, tenantId }, clientId, 'Has Card');
    const sibling = await createBillingProfile({ db, tenantId }, clientId, 'No Card');
    await table('payment_methods').insert([
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: withCard,
        type: 'credit_card',
        last4: '4242',
        exp_month: '4',
        exp_year: '2028',
        is_default: true,
        is_deleted: false,
      },
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: withCard,
        type: 'credit_card',
        last4: '0005',
        is_default: false,
        is_deleted: true,
      },
    ]);

    const cards = await listPaymentMethods(db, tenantId, clientId, withCard);
    expect(cards.find((card) => card.is_default)?.last4).toBe('4242');
    expect(cards.map((card) => card.last4)).not.toContain('0005');
    expect(await listPaymentMethods(db, tenantId, clientId, sibling)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('Q3: due dates follow the profile terms, and siblings keep inheriting the client', async () => {
    const clientId = await createClient({ payment_terms: 'net_30' });
    const onReceipt = await createBillingProfile({ db, tenantId }, clientId, 'On Receipt');
    const inheriting = await createBillingProfile({ db, tenantId }, clientId, 'Inheriting');
    await setProfile(onReceipt, { payment_terms: 'due_on_receipt' });

    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22', onReceipt)).toBe('2026-09-22');
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22', inheriting)).toBe('2026-10-22');
    // No profile: the client's default profile, which inherits Net 30.
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22')).toBe('2026-10-22');
  }, HOOK_TIMEOUT);

  it('Q3: legacy free-text terms on a profile are ignored rather than overriding the client', async () => {
    const clientId = await createClient({ payment_terms: 'net_15' });
    const legacy = await createBillingProfile({ db, tenantId }, clientId, 'Legacy Terms');
    await setProfile(legacy, { payment_terms: 'Net 45 days' });

    const identity = await resolveEffectiveBillingIdentity(db, tenantId, clientId, legacy);
    expect(identity.paymentTerms).toBe('net_15');
    expect(identity.overriddenFields).not.toContain('payment_terms');
    expect(await resolveInvoiceDueDate(db, tenantId, clientId, '2026-09-22', legacy)).toBe('2026-10-07');
  }, HOOK_TIMEOUT);

  it('F001/F002: the migration is idempotent and its down migration removes both columns', async () => {
    await paymentMethodMigration.up(db);
    expect(await db.schema.hasColumn('invoices', 'payment_method')).toBe(true);

    await paymentMethodMigration.down(db);
    expect(await db.schema.hasColumn('invoices', 'payment_method')).toBe(false);
    expect(await db.schema.hasColumn('client_billing_profiles', 'preferred_payment_method')).toBe(false);

    await paymentMethodMigration.up(db);
    expect(await db.schema.hasColumn('client_billing_profiles', 'preferred_payment_method')).toBe(true);
  }, HOOK_TIMEOUT);
});
