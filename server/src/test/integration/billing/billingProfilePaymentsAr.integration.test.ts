import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import {
  clearDefaultPaymentMethod,
  getPaymentMethodForInvoice,
  listPaymentMethods,
  resolvePaymentBillingProfileId,
} from '@alga-psa/shared/billingClients/billingProfilePayments';
import { getAvailableCredit, getAvailableCreditByProfile } from '@alga-psa/billing/lib/creditBalance';

/**
 * S9/S10 — payment methods and AR, scoped per billing profile (T038–T041).
 *
 * The defect these guard against is a real one, not a tidiness concern: two
 * separately-billed sites of the same client have different cards, different
 * owners, and often different bank accounts. Charging one site's card for the
 * other's invoice, or letting one site's credit settle the other's bill, moves
 * money between entities that never agreed to it.
 *
 * The corresponding safety property is that a client nobody has segmented is
 * untouched — one profile, one set of cards, one credit pool, and every figure
 * exactly what it was before.
 */

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedClient(name: string): Promise<string> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function addCard(
  clientId: string,
  billingProfileId: string,
  last4: string,
  isDefault: boolean,
): Promise<string> {
  const paymentMethodId = uuidv4();
  await table('payment_methods').insert({
    tenant: tenantId,
    payment_method_id: paymentMethodId,
    client_id: clientId,
    billing_profile_id: billingProfileId,
    type: 'credit_card',
    last4,
    is_default: isDefault,
    is_deleted: false,
    created_at: new Date().toISOString(),
  });
  return paymentMethodId;
}

async function grantCreditRow(
  clientId: string,
  billingProfileId: string | null,
  amount: number,
): Promise<string> {
  const transactionId = uuidv4();
  const creditId = uuidv4();
  const now = new Date().toISOString();
  await table('transactions').insert({
    tenant: tenantId,
    transaction_id: transactionId,
    client_id: clientId,
    billing_profile_id: billingProfileId,
    amount,
    type: 'credit_issuance',
    status: 'completed',
    description: 'Test credit',
    created_at: now,
    currency_code: 'USD',
  });
  await table('credit_tracking').insert({
    tenant: tenantId,
    credit_id: creditId,
    client_id: clientId,
    billing_profile_id: billingProfileId,
    transaction_id: transactionId,
    amount,
    remaining_amount: amount,
    created_at: now,
    updated_at: now,
    is_expired: false,
    currency_code: 'USD',
  });
  return creditId;
}

describe('billing profiles S9/S10 — payment methods and AR (T038–T041)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'S9 Fixture',
        email: `s9-${tenantId.slice(0, 8)}@profiles.test`,
      });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T038: each profile keeps its own default card', async () => {
    const clientId = await seedClient('Two Sites');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site B');

    await addCard(clientId, defaultProfileId, '1111', true);
    await addCard(clientId, siteProfileId, '2222', true);

    // Two defaults on the same client is exactly what segmentation requires;
    // the pre-S9 client-level unique index would have rejected the second.
    const cards = await listPaymentMethods(db, tenantId, clientId);
    expect(cards.filter((card) => card.is_default)).toHaveLength(2);

    // A second default *within* one profile is still a duplicate.
    await expect(addCard(clientId, siteProfileId, '3333', true)).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    );
  }, HOOK_TIMEOUT);

  it('T038: clearing a default touches only its own profile', async () => {
    const clientId = await seedClient('Clearing Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site C');
    await addCard(clientId, defaultProfileId, '4444', true);
    await addCard(clientId, siteProfileId, '5555', true);

    await clearDefaultPaymentMethod(db, tenantId, clientId, siteProfileId);

    const cards = await listPaymentMethods(db, tenantId, clientId);
    const byLast4 = new Map(cards.map((card) => [card.last4, card]));
    // The sibling entity keeps the card it authorised.
    expect(byLast4.get('4444')!.is_default).toBe(true);
    expect(byLast4.get('5555')!.is_default).toBe(false);
  }, HOOK_TIMEOUT);

  it('T039: an invoice is charged to its own profile’s card, never a sibling’s', async () => {
    const clientId = await seedClient('Charging Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site D');
    await addCard(clientId, defaultProfileId, '6666', true);
    await addCard(clientId, siteProfileId, '7777', true);

    expect((await getPaymentMethodForInvoice(db, tenantId, clientId, siteProfileId))!.last4).toBe('7777');
    expect((await getPaymentMethodForInvoice(db, tenantId, clientId, defaultProfileId))!.last4).toBe('6666');

    // A profile with no card of its own gets nothing rather than a sibling's.
    const cardlessProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site E');
    expect(await getPaymentMethodForInvoice(db, tenantId, clientId, cardlessProfileId)).toBeNull();
  }, HOOK_TIMEOUT);

  it('T039: an unsegmented client resolves to its only profile without being asked', async () => {
    const clientId = await seedClient('Ordinary Payer');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    await addCard(clientId, defaultProfileId, '8888', true);

    expect(await resolvePaymentBillingProfileId(db, tenantId, clientId)).toBe(defaultProfileId);
    // An invoice raised before profiles existed carries none, and still finds
    // the client's default card — which is what it has always been charged to.
    expect((await getPaymentMethodForInvoice(db, tenantId, clientId, null))!.last4).toBe('8888');
  }, HOOK_TIMEOUT);

  it('T039: a profile belonging to another client is refused', async () => {
    const clientId = await seedClient('Client One');
    const otherClientId = await seedClient('Client Two');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const foreignProfileId = await ensureDefaultBillingProfile({ db, tenantId }, otherClientId);

    // Filing a card under an entity that never authorised it is the failure
    // worth being loud about.
    await expect(
      resolvePaymentBillingProfileId(db, tenantId, clientId, foreignProfileId),
    ).rejects.toThrow(/does not belong to client/);
  }, HOOK_TIMEOUT);

  it('T040/T041: credit balance is per profile, and the client figure is their sum', async () => {
    const clientId = await seedClient('Credit Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site F');

    await grantCreditRow(clientId, defaultProfileId, 100);
    await grantCreditRow(clientId, siteProfileId, 250);

    expect(await getAvailableCredit(db, tenantId, clientId, 'USD', defaultProfileId)).toBe(100);
    expect(await getAvailableCredit(db, tenantId, clientId, 'USD', siteProfileId)).toBe(250);
    // No profile means the client rollup — every credit counted exactly once.
    expect(await getAvailableCredit(db, tenantId, clientId, 'USD')).toBe(350);

    const byProfile = await getAvailableCreditByProfile(db, tenantId, clientId, 'USD');
    expect(byProfile.get(defaultProfileId)).toBe(100);
    expect(byProfile.get(siteProfileId)).toBe(250);
    expect([...byProfile.values()].reduce((total, value) => total + value, 0)).toBe(350);
  }, HOOK_TIMEOUT);

  it('T041: an unsegmented client’s balance is unchanged by any of this', async () => {
    const clientId = await seedClient('Plain Credit Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    await grantCreditRow(clientId, defaultProfileId, 500);

    // The number the client has always had, reached without mentioning profiles.
    expect(await getAvailableCredit(db, tenantId, clientId, 'USD')).toBe(500);
    expect(await getAvailableCredit(db, tenantId, clientId, 'USD', defaultProfileId)).toBe(500);
  }, HOOK_TIMEOUT);
});
