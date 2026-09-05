import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { createBillingProfile, ensureDefaultBillingProfile } from '../../../../test-utils/billingProfileTestHelpers';

/**
 * S5 — the unresolved-item carve-out (T049, T050, T052).
 *
 * This is the **only** authorised deviation from the T013 gate (decision D10),
 * and these tests are what bound it. The changed population must be exactly the
 * items that are ambiguous under today's rules — anything else billing
 * differently is a defect, not a feature.
 *
 * The two reasons an item is unresolved get opposite treatment:
 *
 *   no_match  — no contract covers the service. Catalog rate is the only rate
 *               there is, so it is honest. **Unchanged** (T050).
 *   ambiguous — a contract does cover it, so a negotiated rate exists and
 *               catalog pricing is wrong. Never applied silently (T049).
 */

let db: Knex;
let tenantId: string;
let userId: string;

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 300_000;

const WINDOW_START = '2025-05-01';
const WINDOW_END = '2025-06-01';

let getUnresolvedChargeReview: typeof import('@alga-psa/billing/actions/unresolvedChargeActions')['getUnresolvedChargeReview'];
let assignContractLineToUnresolvedItem: typeof import('@alga-psa/billing/actions/unresolvedChargeActions')['assignContractLineToUnresolvedItem'];
let acknowledgeCatalogPricing: typeof import('@alga-psa/billing/actions/unresolvedChargeActions')['acknowledgeCatalogPricing'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

/** A contract with one line covering `serviceId`, optionally on a profile. */
async function seedContractCovering(
  clientId: string,
  serviceId: string,
  contractName: string,
  billingProfileId: string | null,
): Promise<{ contractLineId: string }> {
  const contractId = uuidv4();
  const contractLineId = uuidv4();
  await table('contracts').insert({
    contract_id: contractId,
    tenant: tenantId,
    contract_name: contractName,
    is_active: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('contract_lines').insert({
    contract_line_id: contractLineId,
    tenant: tenantId,
    contract_id: contractId,
    contract_line_name: `${contractName} line`,
    contract_line_type: 'Hourly',
    billing_profile_id: billingProfileId,
  });
  await table('contract_line_services').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    quantity: 1,
  });
  await table('client_contracts').insert({
    client_contract_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    contract_id: contractId,
    start_date: '2025-01-01',
    end_date: null,
    is_active: true,
    billing_profile_id: billingProfileId,
  });
  return { contractLineId };
}

async function seedTimeEntry(
  clientId: string,
  ticketId: string,
  serviceId: string,
  workDate: string,
): Promise<string> {
  const entryId = uuidv4();
  await table('time_entries').insert({
    entry_id: entryId,
    tenant: tenantId,
    user_id: userId,
    work_item_id: ticketId,
    work_item_type: 'ticket',
    service_id: serviceId,
    start_time: `${workDate}T10:00:00Z`,
    end_time: `${workDate}T11:00:00Z`,
    billable_duration: 60,
    approval_status: 'APPROVED',
    work_date: workDate,
    work_timezone: 'UTC',
    contract_line_id: null,
    invoiced: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return entryId;
}

describe('billing profiles S5 — unresolved-item carve-out (T049, T050, T052)', () => {
  let clientId: string;
  let ticketId: string;
  let ambiguousServiceId: string;
  let uncoveredServiceId: string;
  let northLineId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Unresolved Carve-out Fixture',
        email: `carveout-${tenantId.slice(0, 8)}@profiles.test`,
      });

    userId = uuidv4();
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'carveout-tester',
      email: 'carveout@profiles.test',
      hashed_password: 'test_hash',
      first_name: 'Carve',
      last_name: 'Out',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });

    clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Parallel Contracts Client',
      billing_cycle: 'monthly',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await ensureDefaultBillingProfile({ db, tenantId }, clientId, { name: 'Corporate' });
    const northProfileId = await createBillingProfile({ db, tenantId }, clientId, 'North Plant');
    const southProfileId = await createBillingProfile({ db, tenantId }, clientId, 'South Plant');

    ticketId = uuidv4();
    await table('tickets').insert({
      ticket_id: ticketId,
      tenant: tenantId,
      ticket_number: 'CARVE-1',
      title: 'Carve-out work',
      client_id: clientId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const serviceTypeId = uuidv4();
    await table('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: 'Carve-out Type',
    });
    ambiguousServiceId = uuidv4();
    uncoveredServiceId = uuidv4();
    await table('service_catalog').insert([
      {
        service_id: ambiguousServiceId,
        tenant: tenantId,
        service_name: 'Shared support',
        billing_method: 'per_unit',
        custom_service_type_id: serviceTypeId,
        default_rate: 15000,
      },
      {
        service_id: uncoveredServiceId,
        tenant: tenantId,
        service_name: 'One-off consulting',
        billing_method: 'per_unit',
        custom_service_type_id: serviceTypeId,
        default_rate: 20000,
      },
    ]);

    // Two per-profile contracts each carrying the SAME service — exactly the
    // ambiguity this plan creates, and the case D10 exists to handle.
    ({ contractLineId: northLineId } = await seedContractCovering(
      clientId,
      ambiguousServiceId,
      'North Plant Agreement',
      northProfileId,
    ));
    await seedContractCovering(
      clientId,
      ambiguousServiceId,
      'South Plant Agreement',
      southProfileId,
    );

    ({ getUnresolvedChargeReview, assignContractLineToUnresolvedItem, acknowledgeCatalogPricing } =
      await import('@alga-psa/billing/actions/unresolvedChargeActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  // T052 boundary — the two reasons are told apart, which is what bounds the
  // changed population to exactly the ambiguous set.
  // Each test seeds its own entries: the suite runs shuffled, and a test that
  // resolves an entry would otherwise remove it from another test's fixture.
  it('T052: distinguishes an ambiguous item from an uncovered one', async () => {
    const ambiguousEntryId = await seedTimeEntry(clientId, ticketId, ambiguousServiceId, '2025-05-10');
    const uncoveredEntryId = await seedTimeEntry(clientId, ticketId, uncoveredServiceId, '2025-05-11');

    const rows: any = await getUnresolvedChargeReview({
      clientId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    const ambiguous = rows.find((row: any) => row.recordId === ambiguousEntryId);
    const uncovered = rows.find((row: any) => row.recordId === uncoveredEntryId);

    expect(ambiguous.reason).toBe('ambiguous');
    expect(ambiguous.eligibleContractLines).toHaveLength(2);
    // T049 — not billable at catalog rate until someone decides.
    expect(ambiguous.billsAtCatalogRate).toBe(false);

    expect(uncovered.reason).toBe('no_match');
    expect(uncovered.eligibleContractLines).toHaveLength(0);
    // T050 — unchanged from current behaviour.
    expect(uncovered.billsAtCatalogRate).toBe(true);
  }, HOOK_TIMEOUT);

  it('T049: assigning a contract line takes the item out of catalog pricing entirely', async () => {
    const ambiguousEntryId = await seedTimeEntry(clientId, ticketId, ambiguousServiceId, '2025-05-14');
    const result: any = await assignContractLineToUnresolvedItem({
      kind: 'time_entry',
      recordId: ambiguousEntryId,
      contractLineId: northLineId,
    });
    expect(result).toEqual({ success: true });

    const entry = await table('time_entries').where({ entry_id: ambiguousEntryId }).first();
    expect(entry.contract_line_id).toBe(northLineId);
    // Provenance records that a person chose it, not that the resolver did.
    expect(entry.contract_line_source).toBe('explicit');
    expect(entry.contract_line_unresolved_reason).toBeNull();

    // No longer in the queue at all: it is a contract-billed entry now.
    const rows: any = await getUnresolvedChargeReview({
      clientId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(rows.find((row: any) => row.recordId === ambiguousEntryId)).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T049: choosing catalog pricing is recorded as a decision, with an actor', async () => {
    const entryId = await seedTimeEntry(clientId, ticketId, ambiguousServiceId, '2025-05-12');

    const before: any = await getUnresolvedChargeReview({
      clientId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(before.find((row: any) => row.recordId === entryId).billsAtCatalogRate).toBe(false);

    await acknowledgeCatalogPricing({ kind: 'time_entry', recordId: entryId, accepted: true });

    const row = await table('time_entries').where({ entry_id: entryId }).first();
    expect(row.catalog_pricing_acknowledged_at).toBeTruthy();
    expect(row.catalog_pricing_acknowledged_by).toBe(userId);

    const after: any = await getUnresolvedChargeReview({
      clientId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(after.find((r: any) => r.recordId === entryId).billsAtCatalogRate).toBe(true);

    // And it can be withdrawn — the decision is reversible until the invoice
    // is generated.
    await acknowledgeCatalogPricing({ kind: 'time_entry', recordId: entryId, accepted: false });
    const reverted = await table('time_entries').where({ entry_id: entryId }).first();
    expect(reverted.catalog_pricing_acknowledged_at).toBeNull();
  }, HOOK_TIMEOUT);

  it('T049: assigning a line supersedes an earlier catalog-pricing decision', async () => {
    const entryId = await seedTimeEntry(clientId, ticketId, ambiguousServiceId, '2025-05-13');
    await acknowledgeCatalogPricing({ kind: 'time_entry', recordId: entryId, accepted: true });
    await assignContractLineToUnresolvedItem({
      kind: 'time_entry',
      recordId: entryId,
      contractLineId: northLineId,
    });

    const row = await table('time_entries').where({ entry_id: entryId }).first();
    // Leaving the acceptance would record a decision that is no longer in force.
    expect(row.catalog_pricing_acknowledged_at).toBeNull();
    expect(row.catalog_pricing_acknowledged_by).toBeNull();
  }, HOOK_TIMEOUT);
});
