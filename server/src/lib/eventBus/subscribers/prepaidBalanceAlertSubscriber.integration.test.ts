import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { registerFeatureFlagChecker } from '@alga-psa/core';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { handlePrepaidBalanceAlertScanRequested } from './prepaidBalanceAlertSubscriber';
import {
  evaluatePrepaidBalanceAlertsForTenant,
} from './prepaidBalanceAlertEvaluator';
import {
  planAndDrainDeliveriesForTenant,
} from './prepaidBalanceAlertDelivery';

vi.mock('../../notifications/sendEventEmail', () => ({
  sendEventEmail: vi.fn(async () => undefined),
}));

import { sendEventEmail } from '../../notifications/sendEventEmail';

const sendEmailMock = sendEventEmail as unknown as ReturnType<typeof vi.fn>;

let db: Knex;
let flagEnabled = true;

function scanEvent(tenantId: string, clientId?: string): unknown {
  return {
    id: randomUUID(),
    eventType: 'PREPAID_BALANCE_ALERT_SCAN_REQUESTED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId,
      occurredAt: new Date().toISOString(),
      ...(clientId ? { clientId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function createTenant(prefix: string): Promise<string> {
  const tenantId = randomUUID();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `${prefix} Tenant`,
    email: `${prefix}-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return tenantId;
}

async function createClient(
  tenantId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const clientId = randomUUID();
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Prepaid Fixture ${clientId.slice(0, 8)}`,
    is_inactive: false,
    default_currency_code: 'USD',
    ...overrides,
  });
  return clientId;
}

async function createManager(
  tenantId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const userId = randomUUID();
  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `mgr-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: 'manager@example.com',
    user_type: 'internal',
    is_inactive: false,
    ...overrides,
  });
  return userId;
}

async function createContact(
  tenantId: string,
  clientId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const contactId = randomUUID();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `Billing Contact ${contactId.slice(0, 8)}`,
    email: 'billing-contact@example.com',
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  });
  return contactId;
}

async function createBillingSettings(
  tenantId: string,
  clientId: string,
  policy: {
    threshold?: number | null;
    currency?: string | null;
    percent?: number | null;
    notifyClient?: boolean;
  }
): Promise<void> {
  await db('client_billing_settings').insert({
    tenant: tenantId,
    client_id: clientId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    prepaid_credit_alert_threshold: policy.threshold ?? null,
    prepaid_credit_alert_currency_code: policy.currency ?? null,
    bucket_usage_alert_percent: policy.percent ?? null,
    notify_client_on_prepaid_alert: policy.notifyClient ?? false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function createCredit(
  tenantId: string,
  clientId: string,
  {
    amount,
    currency = 'USD',
    isExpired = false,
  }: { amount: number; currency?: string; isExpired?: boolean }
): Promise<void> {
  const transactionId = randomUUID();
  await db('transactions').insert({
    tenant: tenantId,
    transaction_id: transactionId,
    type: 'credit_issuance',
    amount,
    currency_code: currency,
    created_at: db.fn.now(),
  });
  await db('credit_tracking').insert({
    tenant: tenantId,
    credit_id: randomUUID(),
    transaction_id: transactionId,
    client_id: clientId,
    amount,
    remaining_amount: amount,
    currency_code: currency,
    is_expired: isExpired,
    created_at: db.fn.now(),
  });
}

async function createBucketFixture(
  tenantId: string,
  clientId: string,
  {
    totalMinutes,
    minutesUsed,
    rolledOverMinutes = 0,
    periodStart,
    periodEnd,
    configurationType = 'Bucket',
    allowRollover = true,
  }: {
    totalMinutes: number;
    minutesUsed: number;
    rolledOverMinutes?: number;
    periodStart: string;
    periodEnd: string;
    configurationType?: string;
    allowRollover?: boolean;
  }
): Promise<{ contractLineId: string; usageId: string; serviceId: string }> {
  const contractId = randomUUID();
  const contractLineId = randomUUID();
  const clientContractId = randomUUID();
  const configId = randomUUID();
  const serviceId = randomUUID();
  const usageId = randomUUID();

  await db('contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: 'Prepaid Fixture Contract',
    billing_frequency: 'monthly',
    status: 'active',
    is_template: false,
    currency_code: 'USD',
    is_system_managed_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('client_contracts').insert({
    tenant: tenantId,
    client_contract_id: clientContractId,
    client_id: clientId,
    contract_id: contractId,
    start_date: '2026-01-01',
    status: 'pending',
    is_active: true,
    renewal_mode: 'manual',
    notice_period_days: 30,
    use_tenant_renewal_defaults: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('contract_lines').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    contract_line_name: 'Prepaid Bucket Line',
    contract_id: contractId,
    billing_frequency: 'Monthly',
    is_template: false,
    billing_timing: 'arrears',
    display_order: 0,
    enable_proration: false,
    billing_cycle_alignment: 'start',
    cadence_owner: 'client',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('contract_line_service_configuration').insert({
    tenant: tenantId,
    config_id: configId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    configuration_type: configurationType,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('contract_line_service_bucket_config').insert({
    tenant: tenantId,
    config_id: configId,
    total_minutes: totalMinutes,
    billing_period: 'Monthly',
    overage_rate: 100,
    allow_rollover: allowRollover,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('bucket_usage').insert({
    tenant: tenantId,
    usage_id: usageId,
    client_id: clientId,
    contract_line_id: contractLineId,
    service_catalog_id: serviceId,
    period_start: periodStart,
    period_end: periodEnd,
    minutes_used: minutesUsed,
    rolled_over_minutes: rolledOverMinutes,
    overage_minutes: 0,
  });

  return { contractLineId, usageId, serviceId };
}

async function countAlerts(tenantId: string, clientId?: string): Promise<number> {
  const q = tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId });
  if (clientId) q.andWhere({ client_id: clientId });
  const row = await q.count('alert_id as n').first();
  return Number(row?.n ?? 0);
}

async function openAlerts(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return (await tenantDb(db, tenantId).table('prepaid_balance_alerts')
    .where({ tenant: tenantId, resolved_at: null })
    .select('*')) as Array<Record<string, unknown>>;
}

async function deliveries(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return (await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries')
    .where({ tenant: tenantId })
    .select('*')) as Array<Record<string, unknown>>;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  if (!tenantId) return;
  await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('client_billing_settings').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('bucket_usage').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('credit_tracking').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('transactions').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('contract_line_service_bucket_config').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('contract_line_service_configuration').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('contract_lines').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('client_contracts').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('contracts').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('user_notification_preferences').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('user_preferences').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('internal_notifications').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('users').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('contacts').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('clients').where({ tenant: tenantId }).del();
  await tenantDb(db, tenantId).table('tenants').where({ tenant: tenantId }).del();
}

const createdTenants: string[] = [];

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  registerFeatureFlagChecker(async () => flagEnabled);
}, 300_000);

afterAll(async () => {
  for (const tenantId of createdTenants) {
    await cleanupTenant(tenantId);
  }
  if (db) {
    await db.destroy().catch(() => undefined);
  }
});

beforeEach(() => {
  flagEnabled = true;
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue(undefined);
});

describe('prepaid balance alert scan (DB-backed)', () => {
  // -------------------------------------------------------------------------
  // T021: flag-off guard
  // -------------------------------------------------------------------------
  it('produces zero writes when the feature flag is disabled', async () => {
    const tenantId = await createTenant('flag-off');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId);
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD', percent: 80 });
    await createCredit(tenantId, clientId, { amount: 100 });

    flagEnabled = false;
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    expect(await countAlerts(tenantId)).toBe(0);
    expect(await deliveries(tenantId)).toHaveLength(0);
    const notifications = await tenantDb(db, tenantId).table('internal_notifications').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(notifications?.n ?? 0)).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('fails closed at the delivery boundary when the flag turns off during evaluation', async () => {
    const tenantId = await createTenant('flag-off-before-delivery');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId);
    await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    let checks = 0;
    registerFeatureFlagChecker(async () => {
      checks += 1;
      return checks === 1;
    });
    try {
      await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    } finally {
      registerFeatureFlagChecker(async () => flagEnabled);
    }

    expect(await countAlerts(tenantId)).toBe(1);
    expect(await deliveries(tenantId)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T009: credit episode lifecycle
  // -------------------------------------------------------------------------
  it('opens, dedupes, resolves, and rearms credit episodes', async () => {
    const tenantId = await createTenant('credit');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });

    // No history -> no zero-balance alert.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(await countAlerts(tenantId, clientId)).toBe(0);

    // Fund then consume to below threshold -> eligible.
    await createCredit(tenantId, clientId, { amount: 1000 });
    await createCredit(tenantId, clientId, { amount: 3000 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const first = await openAlerts(tenantId);
    expect(first).toHaveLength(1);
    expect(first[0].alert_type).toBe('credit');

    // Repeated low scan dedupes (still one open alert).
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(await openAlerts(tenantId)).toHaveLength(1);
    expect(await countAlerts(tenantId, clientId)).toBe(1);

    // Recovery to exactly the threshold resolves the episode.
    await createCredit(tenantId, clientId, { amount: 5000 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const resolved = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId }).select('*');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolved_at).not.toBeNull();
    expect(resolved[0].resolution_reason).toBe('recovered');
    expect(await openAlerts(tenantId)).toHaveLength(0);

    // A later drop opens a new episode (monotonic episode counter).
    await db('credit_tracking').where({ tenant: tenantId, client_id: clientId }).update({ remaining_amount: 0 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const episodes = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId }).orderBy('created_at', 'asc').select('episode', 'resolved_at');
    expect(episodes).toHaveLength(2);
    expect(Number(episodes[1].episode)).toBe(2);
    expect(episodes[1].resolved_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T008: credit aggregation uses only non-expired rows in the configured
  // currency and never mixes currencies.
  // -------------------------------------------------------------------------
  it('sums only non-expired credit in the configured currency for the alert', async () => {
    const tenantId = await createTenant('credit-aggregate');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });

    // Expired USD and live EUR rows must not contribute to the USD balance.
    await createCredit(tenantId, clientId, { amount: 10000, isExpired: true });
    await createCredit(tenantId, clientId, { amount: 20000, currency: 'EUR' });
    await createCredit(tenantId, clientId, { amount: 4000 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const alerts = await openAlerts(tenantId);
    expect(alerts).toHaveLength(1);
    // observed_value is 4000 (the live USD row), not 4000+10000+20000.
    expect(Number(alerts[0].observed_value)).toBe(4000);
  });

  // -------------------------------------------------------------------------
  // Regression: concurrent drains must not double-claim one delivery (atomic
  // SELECT ... FOR UPDATE SKIP LOCKED + claim inside a single transaction).
  // -------------------------------------------------------------------------
  it('does not double-claim a delivery under concurrent drains', async () => {
    const tenantId = await createTenant('claim-atomic');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    const { knex } = await (await import('@alga-psa/db')).createTenantKnex();
    await evaluatePrepaidBalanceAlertsForTenant(knex, tenantId);
    const alert = (await openAlerts(tenantId))[0];
    const deliveryId = randomUUID();
    await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').insert({
      tenant: tenantId,
      delivery_id: deliveryId,
      alert_id: alert.alert_id,
      channel: 'email',
      recipient_roles: JSON.stringify(['account_manager']),
      recipient_key: 'manager@example.com',
      recipient_user_id: managerId,
      recipient_email: 'manager@example.com',
      status: 'pending',
      attempt_count: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    sendEmailMock.mockResolvedValue(undefined);
    await Promise.all([
      planAndDrainDeliveriesForTenant(knex, tenantId),
      planAndDrainDeliveriesForTenant(knex, tenantId),
    ]);

    const row = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ delivery_id: deliveryId }).first();
    expect(Number(row.attempt_count)).toBe(1);
    expect(row.status).toBe('sent');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Regression: shared contract lines (system-managed defaults) must not let
  // client A alert on client B's bucket usage.
  // -------------------------------------------------------------------------
  it('does not alert client A on client B bucket usage via a shared contract line', async () => {
    const tenantId = await createTenant('shared-contract');
    createdTenants.push(tenantId);
    const clientA = await createClient(tenantId);
    const clientB = await createClient(tenantId);
    await createBillingSettings(tenantId, clientA, { percent: 80 });
    await createBillingSettings(tenantId, clientB, { percent: 80 });

    const contractId = randomUUID();
    const contractLineId = randomUUID();
    const configId = randomUUID();
    const serviceId = randomUUID();
    const usageId = randomUUID();
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);

    await db('contracts').insert({
      tenant: tenantId,
      contract_id: contractId,
      contract_name: 'Shared Contract',
      billing_frequency: 'monthly',
      status: 'active',
      is_template: false,
      currency_code: 'USD',
      is_system_managed_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    for (const cid of [clientA, clientB]) {
      await db('client_contracts').insert({
        tenant: tenantId,
        client_contract_id: randomUUID(),
        client_id: cid,
        contract_id: contractId,
        start_date: '2026-01-01',
        status: 'pending',
        is_active: true,
        renewal_mode: 'manual',
        notice_period_days: 30,
        use_tenant_renewal_defaults: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }
    await db('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: contractLineId,
      contract_line_name: 'Shared Line',
      contract_id: contractId,
      billing_frequency: 'Monthly',
      is_template: false,
      billing_timing: 'arrears',
      display_order: 0,
      enable_proration: false,
      billing_cycle_alignment: 'start',
      cadence_owner: 'client',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('contract_line_service_configuration').insert({
      tenant: tenantId,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('contract_line_service_bucket_config').insert({
      tenant: tenantId,
      config_id: configId,
      total_minutes: 1000,
      billing_period: 'Monthly',
      overage_rate: 100,
      allow_rollover: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('bucket_usage').insert({
      tenant: tenantId,
      usage_id: usageId,
      client_id: clientB,
      contract_line_id: contractLineId,
      service_catalog_id: serviceId,
      period_start: start,
      period_end: end,
      minutes_used: 900,
      rolled_over_minutes: 0,
      overage_minutes: 0,
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const aAlerts = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId, client_id: clientA }).select('*');
    const bAlerts = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId, client_id: clientB }).select('*');
    expect(aAlerts).toHaveLength(0);
    expect(bAlerts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Regression: consumption oscillating around the bucket threshold WITHIN one
  // period must NOT re-alert (one alert per (bucket_usage, period, percentage));
  // policy changes resolve the prior open state while the durable identity
  // remains exactly (bucket usage period, configured percentage) — and bucket
  // transitions never roll back the client's committed credit evaluation.
  // -------------------------------------------------------------------------
  it('suppresses bucket oscillation within one period and re-arms only on policy change', async () => {
    const tenantId = await createTenant('bucket-oscillation');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD', percent: 80 });
    await createCredit(tenantId, clientId, { amount: 100 });
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 800,
      periodStart: start,
      periodEnd: end,
    });

    // Fire: credit and bucket episodes both open.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    let byType = new Map((await openAlerts(tenantId)).map((a) => [a.alert_type, a]));
    expect(byType.get('credit')).toBeDefined();
    expect(byType.get('bucket')).toBeDefined();

    // Suppress: repeated scans dedupe.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect((await openAlerts(tenantId)).filter((a) => a.alert_type === 'bucket')).toHaveLength(1);

    // Oscillate BELOW the threshold: the episode must neither resolve nor re-open.
    await db('bucket_usage').where({ tenant: tenantId }).update({ minutes_used: 700 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect((await openAlerts(tenantId)).filter((a) => a.alert_type === 'bucket')).toHaveLength(1);

    // Oscillate BACK to the threshold: still the SAME episode, no re-alert.
    await db('bucket_usage').where({ tenant: tenantId }).update({ minutes_used: 800 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    let bucketRows = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, alert_type: 'bucket' })
      .orderBy('created_at', 'asc')
      .select('episode', 'resolved_at', 'dedupe_key');
    expect(bucketRows).toHaveLength(1);
    expect(Number(bucketRows[0].episode)).toBe(1);
    expect(bucketRows[0].resolved_at).toBeNull();

    // Policy disabled mid-period: the sweep resolves the open episode as
    // policy_changed so it can never strand.
    await db('client_billing_settings').where({ client_id: clientId }).update({ bucket_usage_alert_percent: null });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect((await openAlerts(tenantId)).filter((a) => a.alert_type === 'bucket')).toHaveLength(0);

    // Re-enable the same percentage: reopen the SAME logical identity, without
    // inserting another 80-percent row for this usage period.
    await db('client_billing_settings').where({ client_id: clientId }).update({ bucket_usage_alert_percent: 80 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    bucketRows = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, alert_type: 'bucket' })
      .orderBy('created_at', 'asc')
      .select('episode', 'bucket_percent', 'resolved_at', 'dedupe_key');
    expect(bucketRows).toHaveLength(1);
    expect(Number(bucketRows[0].episode)).toBe(1);
    expect(bucketRows[0].resolved_at).toBeNull();

    // 80 -> 90 creates one distinct 90-percent identity; 90 -> 80 reuses the
    // original 80-percent row. There are never two rows for the same pair.
    await db('bucket_usage').where({ tenant: tenantId }).update({ minutes_used: 950 });
    await db('client_billing_settings').where({ client_id: clientId }).update({ bucket_usage_alert_percent: 90 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    await db('client_billing_settings').where({ client_id: clientId }).update({ bucket_usage_alert_percent: 80 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    bucketRows = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, alert_type: 'bucket' })
      .orderBy('bucket_percent', 'asc')
      .select('episode', 'bucket_percent', 'resolved_at', 'dedupe_key');
    expect(bucketRows).toHaveLength(2);
    expect(bucketRows.map((row) => Number(row.bucket_percent))).toEqual([80, 90]);
    expect(bucketRows[0].resolved_at).toBeNull();
    expect(bucketRows[1].resolved_at).not.toBeNull();
    expect(bucketRows[0].dedupe_key).toContain(':80pct');
    expect(bucketRows[1].dedupe_key).toContain(':90pct');

    // The credit alert survived every bucket transition (separate transactions).
    byType = new Map((await openAlerts(tenantId)).map((a) => [a.alert_type, a]));
    expect(byType.get('credit')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // T010: credit policy change
  // -------------------------------------------------------------------------
  it('resolves an open episode as policy_changed when the threshold changes', async () => {
    const tenantId = await createTenant('credit-policy');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(await openAlerts(tenantId)).toHaveLength(1);

    await db('client_billing_settings').where({ client_id: clientId }).update({ prepaid_credit_alert_threshold: 8000 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const rows = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId }).orderBy('created_at', 'asc').select('credit_threshold', 'resolution_reason', 'resolved_at');
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].credit_threshold)).toBe(5000);
    expect(rows[0].resolution_reason).toBe('policy_changed');
    expect(Number(rows[1].credit_threshold)).toBe(8000);
    expect(rows[1].resolved_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T012 + T013: bucket ownership, period, dedupe, rollover
  // -------------------------------------------------------------------------
  it('evaluates only current Bucket configurations owned by the client', async () => {
    const tenantId = await createTenant('bucket-own');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const otherClientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { percent: 80 });

    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    const staleEnd = new Date(today.getTime() - 5 * 86400_000).toISOString().slice(0, 10);

    // Current bucket at 90% (alerts).
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
    });
    // Non-Bucket configuration on the same client (Hourly overlay) — excluded.
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
      configurationType: 'Hourly',
    });
    // Noncurrent period — excluded.
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: '2020-01-01',
      periodEnd: staleEnd,
    });
    // Unrelated client — excluded.
    await createBillingSettings(tenantId, otherClientId, { percent: 80 });
    await createBucketFixture(tenantId, otherClientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    // The unrelated client is a distinct, independently evaluated subject; the
    // client under test gets exactly one bucket alert from its own buckets.
    const clientAlerts = (await openAlerts(tenantId)).filter((a) => a.client_id === clientId);
    expect(clientAlerts).toHaveLength(1);
    expect(clientAlerts[0].alert_type).toBe('bucket');

    // Repeated scan dedupes; a new period is independently eligible.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect((await openAlerts(tenantId)).filter((a) => a.client_id === clientId)).toHaveLength(1);
    expect(await countAlerts(tenantId, clientId)).toBe(1);

    // Simulate a period rollover: the first period ends (no longer current)
    // and a new current period appears. The old episode resolves as recovered;
    // the new period is independently eligible.
    await db('bucket_usage')
      .where({ tenant: tenantId, client_id: clientId, period_start: start })
      .update({ period_end: new Date(today.getTime() - 1 * 86400_000).toISOString().slice(0, 10) });
    const nextStart = new Date(today.getTime() - 1 * 86400_000).toISOString().slice(0, 10);
    const nextEnd = new Date(today.getTime() + 59 * 86400_000).toISOString().slice(0, 10);
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 800,
      periodStart: nextStart,
      periodEnd: nextEnd,
    });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const allForClient = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, client_id: clientId }).orderBy('created_at', 'asc').select('resolved_at', 'resolution_reason');
    expect(allForClient).toHaveLength(2);
    expect(allForClient[0].resolved_at).not.toBeNull();
    expect(allForClient[0].resolution_reason).toBe('recovered');
    expect(allForClient[1].resolved_at).toBeNull();
  });

  it('opens at bucket equality and keeps observations above 100 percent unclamped', async () => {
    const tenantId = await createTenant('bucket-boundary');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { percent: 80 });

    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);

    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 800,
      periodStart: start,
      periodEnd: end,
    });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const alerts = await openAlerts(tenantId);
    expect(alerts).toHaveLength(1);
    expect(Number(alerts[0].observed_value)).toBe(800);

    // Overage: 1100/1000 -> 110% observed, still one alert.
    await db('bucket_usage').where({ tenant: tenantId }).update({ minutes_used: 1100 });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const after = await openAlerts(tenantId);
    expect(after).toHaveLength(1);
    const payload = typeof after[0].payload === 'string'
      ? JSON.parse(after[0].payload)
      : after[0].payload as Record<string, unknown>;
    expect(payload.usedPercent).toBe(110);
  });

  // -------------------------------------------------------------------------
  // T014: concurrency
  // -------------------------------------------------------------------------
  it('converges concurrent scans on one logical alert via the unique dedupe key', async () => {
    const tenantId = await createTenant('concurrency');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD', percent: 80 });
    await createCredit(tenantId, clientId, { amount: 100 });
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
    });

    const { knex } = await (await import('@alga-psa/db')).createTenantKnex();
    await Promise.allSettled([
      evaluatePrepaidBalanceAlertsForTenant(knex, tenantId),
      evaluatePrepaidBalanceAlertsForTenant(knex, tenantId),
      evaluatePrepaidBalanceAlertsForTenant(knex, tenantId),
    ]);
    const alerts = await tenantDb(db, tenantId).table('prepaid_balance_alerts').where({ tenant: tenantId }).select('*');
    expect(alerts).toHaveLength(2); // one credit + one bucket, never duplicates of either
    const byType = new Map(alerts.map((a) => [a.alert_type, a]));
    expect(byType.get('credit').dedupe_key).toBe(byType.get('credit').dedupe_key);
    expect(byType.get('bucket').dedupe_key).toBe(byType.get('bucket').dedupe_key);
  });

  // -------------------------------------------------------------------------
  // T015 + T016 + T017: recipients
  // -------------------------------------------------------------------------
  it('routes manager internal + email, collapses shared addresses, and honors opt-in', async () => {
    const tenantId = await createTenant('recipient');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, { billing_email: 'client-billing@example.com' });
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    // Client opt-in OFF: manager only (internal + email).
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    let rows = await deliveries(tenantId);
    expect(rows.filter((r) => r.channel === 'internal')).toHaveLength(1);
    expect(rows.filter((r) => r.channel === 'email')).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe('manager@example.com');

    // Turn opt-in ON: client email added to the canonical recipient.
    await db('client_billing_settings').where({ client_id: clientId }).update({ notify_client_on_prepaid_alert: true });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    rows = await deliveries(tenantId);
    const emails = rows.filter((r) => r.channel === 'email');
    expect(emails.map((r) => r.recipient_email).sort()).toEqual(
      ['client-billing@example.com', 'manager@example.com'].sort()
    );
    // The scan re-runs but a successful role delivery is never resent.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    // Manager reassignment after success does not resend.
    const newManagerId = await createManager(tenantId, { email: 'new-manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: newManagerId });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it('collapses a shared manager/client address into one email delivery retaining both roles', async () => {
    const tenantId = await createTenant('recipient-collapse');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, { billing_email: 'shared@example.com' });
    const managerId = await createManager(tenantId, { email: 'shared@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD', notifyClient: true });
    await createCredit(tenantId, clientId, { amount: 100 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const emails = (await deliveries(tenantId)).filter((r) => r.channel === 'email');
    expect(emails).toHaveLength(1);
    expect(emails[0].recipient_email).toBe('shared@example.com');
    const rawRoles = emails[0].recipient_roles;
    const roles = Array.isArray(rawRoles)
      ? rawRoles.map(String)
      : JSON.parse(String(rawRoles));
    expect(roles).toContain('account_manager');
    expect(roles).toContain('client_billing_recipient');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('applies shared-address email preferences per role and falls back to the opted-in client route', async () => {
    const tenantId = await createTenant('recipient-collapse-preferences');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, {
      billing_email: 'shared-preferences@example.com',
      properties: JSON.stringify({ defaultLocale: 'de' }),
    });
    const managerId = await createManager(tenantId, { email: 'shared-preferences@example.com' });
    await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, {
      threshold: 5000,
      currency: 'USD',
      notifyClient: true,
    });
    await createCredit(tenantId, clientId, { amount: 100 });

    const subtype = await db('notification_subtypes')
      .where({ name: 'prepaid-credit-low-balance' })
      .first('id');
    await db('user_notification_preferences').insert({
      tenant: tenantId,
      user_id: managerId,
      subtype_id: subtype.id,
      is_enabled: false,
      frequency: 'realtime',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const send = sendEmailMock.mock.calls[0][0];
    expect(send.to).toBe('shared-preferences@example.com');
    expect(send.locale).toBe('de');
    expect(send.recipientUserId).toBeUndefined();
    expect(send.recipientClientId).toBe(clientId);
    expect(send.context.alert.link).toContain('/client-portal/billing');
    expect(send.context.alert.link).not.toContain('/msp/clients/');

    const emailRows = (await deliveries(tenantId)).filter((row) => row.channel === 'email');
    expect(emailRows).toHaveLength(1);
    expect(emailRows[0].status).toBe('sent');
  });

  it('isolates an inactive/email-less manager without failing the scan', async () => {
    const tenantId = await createTenant('recipient-inactive');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    // No manager at all.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    let rows = await deliveries(tenantId);
    expect(rows).toHaveLength(0);
    expect(await openAlerts(tenantId)).toHaveLength(1);

    // Inactive manager -> still no manager delivery, scan succeeds.
    const inactiveManagerId = await createManager(tenantId, { email: 'inactive@example.com', is_inactive: true });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: inactiveManagerId });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    rows = await deliveries(tenantId);
    expect(rows).toHaveLength(0);

    // Active manager with no email -> internal delivery only.
    const emailLessManagerId = await createManager(tenantId, { email: '' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: emailLessManagerId });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    rows = await deliveries(tenantId);
    expect(rows.filter((r) => r.channel === 'internal')).toHaveLength(1);
    expect(rows.filter((r) => r.channel === 'email')).toHaveLength(0);
  });

  it('rejects non-internal managers and inactive or unrelated billing contacts', async () => {
    const tenantId = await createTenant('recipient-authorization');
    createdTenants.push(tenantId);
    const managerId = await createManager(tenantId, { email: 'valid-manager@example.com' });

    const unrelatedContactClientId = await createClient(tenantId);
    const unrelatedContactId = await createContact(tenantId, unrelatedContactClientId, {
      email: 'unrelated-contact@example.com',
    });

    const wrongContactClientId = await createClient(tenantId, {
      account_manager_id: managerId,
      billing_contact_id: unrelatedContactId,
      billing_email: 'wrong-contact-fallback@example.com',
    });
    await createBillingSettings(tenantId, wrongContactClientId, {
      threshold: 5000,
      currency: 'USD',
      notifyClient: true,
    });
    await createCredit(tenantId, wrongContactClientId, { amount: 100 });

    const inactiveContactClientId = await createClient(tenantId, {
      account_manager_id: managerId,
      billing_email: 'inactive-contact-fallback@example.com',
    });
    const inactiveContactId = await createContact(tenantId, inactiveContactClientId, {
      email: 'inactive-contact@example.com',
      is_inactive: true,
    });
    await db('clients').where({ tenant: tenantId, client_id: inactiveContactClientId })
      .update({ billing_contact_id: inactiveContactId });
    await createBillingSettings(tenantId, inactiveContactClientId, {
      threshold: 5000,
      currency: 'USD',
      notifyClient: true,
    });
    await createCredit(tenantId, inactiveContactClientId, { amount: 100 });

    const invalidManagerClientId = await createClient(tenantId);
    const clientUserId = await createManager(tenantId, {
      email: 'client-user@example.com',
      user_type: 'client',
    });
    await db('clients').where({ tenant: tenantId, client_id: invalidManagerClientId })
      .update({ account_manager_id: clientUserId });
    await createBillingSettings(tenantId, invalidManagerClientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, invalidManagerClientId, { amount: 100 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const sentTo = sendEmailMock.mock.calls.map((call) => call[0].to);
    expect(sentTo).toContain('wrong-contact-fallback@example.com');
    expect(sentTo).toContain('inactive-contact-fallback@example.com');
    expect(sentTo).not.toContain('unrelated-contact@example.com');
    expect(sentTo).not.toContain('inactive-contact@example.com');
    expect(sentTo).not.toContain('client-user@example.com');

    const invalidManagerAlerts = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ client_id: invalidManagerClientId })
      .select('alert_id');
    const invalidManagerDeliveries = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries')
      .whereIn('alert_id', invalidManagerAlerts.map((row) => row.alert_id));
    expect(invalidManagerDeliveries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T022 + T024: leases, retries, exhaustion
  // -------------------------------------------------------------------------
  it('retries transient email failures up to five attempts and then exhausts', async () => {
    const tenantId = await createTenant('retry');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    sendEmailMock.mockRejectedValue(new Error('provider down'));
    for (let i = 0; i < 5; i += 1) {
      await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    }

    const emailRows = (await deliveries(tenantId)).filter((r) => r.channel === 'email');
    expect(emailRows).toHaveLength(1);
    expect(emailRows[0].status).toBe('exhausted');
    expect(Number(emailRows[0].attempt_count)).toBe(5);
    expect(String(emailRows[0].last_error)).toContain('provider down');

    // A later drain does not exceed the bound.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(Number(emailRows[0].attempt_count)).toBe(5);
  });

  it('claims deliveries disjointly with SKIP LOCKED and reclaims stale leases', async () => {
    const tenantId = await createTenant('lease');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    // First drain claims and sends; email is mocked to succeed immediately.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    // Force a stale processing lease on a new delivery row and reclaim it.
    const alert = (await openAlerts(tenantId))[0];
    const deliveryId = randomUUID();
    await db('users').where({ tenant: tenantId, user_id: managerId }).update({ email: 'stale@example.com' });
    await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').insert({
      tenant: tenantId,
      delivery_id: deliveryId,
      alert_id: alert.alert_id,
      channel: 'email',
      recipient_roles: JSON.stringify(['account_manager']),
      recipient_key: 'stale@example.com',
      recipient_user_id: managerId,
      recipient_email: 'stale@example.com',
      status: 'processing',
      attempt_count: 1,
      worker_id: 'dead-worker',
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    sendEmailMock.mockResolvedValue(undefined);
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const reclaimed = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ delivery_id: deliveryId }).first();
    expect(reclaimed.status).toBe('sent');
  });

  it('drains more than one claim batch without retrying same-run failures', async () => {
    const tenantId = await createTenant('multi-batch-drain');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'batch-manager@example.com' });
    await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });

    const alertRows: Array<Record<string, unknown> & { alert_id: string }> = Array.from(
      { length: 51 },
      (_, index) => ({
        tenant: tenantId,
        alert_id: randomUUID(),
        client_id: clientId,
        alert_type: 'credit',
        dedupe_key: `batch-credit:${clientId}:${index}`,
        episode: index + 1,
        credit_threshold: 5000,
        credit_currency_code: 'USD',
        observed_value: 100,
        payload: JSON.stringify({ batch: index }),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
    );
    await tenantDb(db, tenantId).table('prepaid_balance_alerts').insert(alertRows);

    const deliveryRows: Array<Record<string, unknown>> = alertRows.flatMap((alert) => [
      {
        tenant: tenantId,
        delivery_id: randomUUID(),
        alert_id: alert.alert_id,
        channel: 'internal',
        recipient_roles: JSON.stringify(['account_manager']),
        recipient_key: `user:${managerId}`,
        recipient_user_id: managerId,
        recipient_email: null,
        status: 'sent',
        attempt_count: 1,
        sent_at: db.fn.now(),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        delivery_id: randomUUID(),
        alert_id: alert.alert_id,
        channel: 'email',
        recipient_roles: JSON.stringify(['account_manager']),
        recipient_key: 'batch-manager@example.com',
        recipient_user_id: managerId,
        recipient_email: 'batch-manager@example.com',
        status: 'pending',
        attempt_count: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);
    await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').insert(deliveryRows);

    sendEmailMock.mockRejectedValueOnce(new Error('first attempt fails'));
    sendEmailMock.mockResolvedValue(undefined);
    const { knex } = await (await import('@alga-psa/db')).createTenantKnex();
    await planAndDrainDeliveriesForTenant(knex, tenantId);

    expect(sendEmailMock).toHaveBeenCalledTimes(51);
    const emailRows = (await deliveries(tenantId)).filter((row) => row.channel === 'email');
    expect(emailRows.filter((row) => row.status === 'sent')).toHaveLength(50);
    const failed = emailRows.filter((row) => row.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(Number(failed[0].attempt_count)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // T023: internal transactional delivery
  // -------------------------------------------------------------------------
  it('commits internal notification creation and sent status together, replay is idempotent', async () => {
    const tenantId = await createTenant('internal-trx');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: '' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const notifications = await tenantDb(db, tenantId).table('internal_notifications')
      .where({ tenant: tenantId }).select('*');
    // Exactly one internal notification despite two scans (one delivery row).
    expect(notifications).toHaveLength(1);
    const internalRows = (await deliveries(tenantId)).filter((r) => r.channel === 'internal');
    expect(internalRows).toHaveLength(1);
    expect(internalRows[0].status).toBe('sent');
  });

  it('marks a preference-disabled internal delivery terminal skipped', async () => {
    const tenantId = await createTenant('internal-skip');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: '' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    // Disable the subtype for the manager.
    const subtype = await db('internal_notification_subtypes').where({ name: 'prepaid-credit-low-balance' }).first();
    await db('user_internal_notification_preferences').insert({
      tenant: tenantId,
      user_id: managerId,
      subtype_id: subtype.internal_notification_subtype_id,
      is_enabled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const internalRows = (await deliveries(tenantId)).filter((r) => r.channel === 'internal');
    expect(internalRows).toHaveLength(1);
    expect(internalRows[0].status).toBe('skipped');
    const notifications = await tenantDb(db, tenantId).table('internal_notifications').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(notifications?.n ?? 0)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T025: observability summary
  // -------------------------------------------------------------------------
  it('reports an empty summary for a tenant with no configured clients', async () => {
    const tenantId = await createTenant('summary');
    createdTenants.push(tenantId);
    const { knex } = await (await import('@alga-psa/db')).createTenantKnex();
    const summary = await evaluatePrepaidBalanceAlertsForTenant(knex, tenantId);
    expect(summary.configuredClients).toBe(0);
    expect(summary.creditSubjects).toBe(0);
    expect(summary.bucketSubjects).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T027: tenant isolation
  // -------------------------------------------------------------------------
  it('does not let one tenant read or write another tenant is not done; a failed client does not abort the scan', async () => {
    const tenantA = await createTenant('iso-a');
    const tenantB = await createTenant('iso-b');
    createdTenants.push(tenantA, tenantB);

    const clientA = await createClient(tenantA);
    const clientB = await createClient(tenantB);
    await createBillingSettings(tenantA, clientA, { threshold: 5000, currency: 'USD' });
    await createBillingSettings(tenantB, clientB, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantA, clientA, { amount: 100 });
    await createCredit(tenantB, clientB, { amount: 100 });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantA));

    const alertsA = await tenantDb(db, tenantA).table('prepaid_balance_alerts').where({ tenant: tenantA }).select('client_id');
    const alertsB = await tenantDb(db, tenantB).table('prepaid_balance_alerts').where({ tenant: tenantB }).select('client_id');
    expect(alertsA).toHaveLength(1);
    expect(alertsA[0].client_id).toBe(clientA);
    expect(alertsB).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Disabled policies must not strand open episodes (draft-review defect #1):
  // a policy turned off between scans — even a client that drops out of the
  // configured set entirely — resolves its open episodes as policy_changed.
  // -------------------------------------------------------------------------
  it('resolves open episodes as policy_changed when a policy type is disabled', async () => {
    const tenantId = await createTenant('disable-policy');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD', percent: 80 });
    await createCredit(tenantId, clientId, { amount: 100 });
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(await openAlerts(tenantId)).toHaveLength(2);

    // Disable only the credit type (the client stays configured via its bucket
    // policy): the open credit episode resolves as policy_changed while the
    // bucket episode stays open.
    await db('client_billing_settings').where({ client_id: clientId }).update({
      prepaid_credit_alert_threshold: null,
      prepaid_credit_alert_currency_code: null,
    });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    let open = await openAlerts(tenantId);
    expect(open).toHaveLength(1);
    expect(open[0].alert_type).toBe('bucket');
    const creditRows = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, alert_type: 'credit' }).select('resolved_at', 'resolution_reason');
    expect(creditRows).toHaveLength(1);
    expect(creditRows[0].resolved_at).not.toBeNull();
    expect(creditRows[0].resolution_reason).toBe('policy_changed');

    // Disable the bucket type too: the client drops OUT of the configured set,
    // and the tenant-wide sweep still resolves the open bucket episode.
    await db('client_billing_settings').where({ client_id: clientId }).update({ bucket_usage_alert_percent: null });
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(await openAlerts(tenantId)).toHaveLength(0);
    const bucketRows = await tenantDb(db, tenantId).table('prepaid_balance_alerts')
      .where({ tenant: tenantId, alert_type: 'bucket' }).select('resolved_at', 'resolution_reason');
    expect(bucketRows).toHaveLength(1);
    expect(bucketRows[0].resolved_at).not.toBeNull();
    expect(bucketRows[0].resolution_reason).toBe('policy_changed');
  });

  // -------------------------------------------------------------------------
  // Delivery must never send after an episode is resolved (draft-review
  // defect #2). Each of the three resolution causes — recovery, period
  // rollover, policy disabled — terminalizes an orphaned retrying send as
  // `superseded` instead of claiming and resending it.
  // -------------------------------------------------------------------------
  it('supersedes a retrying send once recovery resolves the episode', async () => {
    const tenantId = await createTenant('delivery-recovered');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    sendEmailMock.mockRejectedValueOnce(new Error('transient provider error'));
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const pendingDelivery = (await deliveries(tenantId)).find((row) => row.channel === 'email');
    expect(pendingDelivery?.status).toBe('failed');

    // Balance recovers to equality: the evaluator resolves the episode and the
    // drain must terminalize the orphaned retrying send, not resend it.
    await createCredit(tenantId, clientId, { amount: 5000 });
    sendEmailMock.mockClear();
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const row = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ delivery_id: pendingDelivery?.delivery_id }).first();
    expect(row.status).toBe('superseded');
    expect(await openAlerts(tenantId)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('supersedes a retrying send once a period rollover resolves the episode', async () => {
    const tenantId = await createTenant('delivery-rollover');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { percent: 80 });
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    const { usageId } = await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 900,
      periodStart: start,
      periodEnd: end,
    });

    sendEmailMock.mockRejectedValueOnce(new Error('transient provider error'));
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const pendingDelivery = (await deliveries(tenantId)).find((row) => row.channel === 'email');
    expect(pendingDelivery?.status).toBe('failed');

    // The period is no longer current: the old episode resolves as recovered
    // and its undelivered send is superseded, never sent.
    await db('bucket_usage').where({ tenant: tenantId, usage_id: usageId })
      .update({ period_end: new Date(today.getTime() - 1 * 86400_000).toISOString().slice(0, 10) });
    sendEmailMock.mockClear();
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const row = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ delivery_id: pendingDelivery?.delivery_id }).first();
    expect(row.status).toBe('superseded');
    expect((await openAlerts(tenantId)).filter((a) => a.alert_type === 'bucket')).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('supersedes a retrying send once a disabled policy resolves the episode', async () => {
    const tenantId = await createTenant('delivery-policy-off');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId);
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    sendEmailMock.mockRejectedValueOnce(new Error('transient provider error'));
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const pendingDelivery = (await deliveries(tenantId)).find((row) => row.channel === 'email');
    expect(pendingDelivery?.status).toBe('failed');

    // Disabling the credit policy resolves the episode as policy_changed; the
    // retrying send is terminalized, never claimed again.
    await db('client_billing_settings').where({ client_id: clientId }).update({
      prepaid_credit_alert_threshold: null,
      prepaid_credit_alert_currency_code: null,
    });
    sendEmailMock.mockClear();
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const row = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries').where({ delivery_id: pendingDelivery?.delivery_id }).first();
    expect(row.status).toBe('superseded');
    expect(await openAlerts(tenantId)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Recipient authorization (draft-review defect #3): client billing-recipient
  // email is strictly opt-in. Opted out ⇒ zero client-facing sends even though
  // an episode fires; opted in ⇒ exactly the canonical recipient is emailed.
  // -------------------------------------------------------------------------
  it('emails zero client-facing recipients when the client opt-in is off, and the canonical recipient when enabled', async () => {
    const tenantId = await createTenant('recipient-optin');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, { billing_email: 'client-billing@example.com' });
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
    await createCredit(tenantId, clientId, { amount: 100 });

    // Opt-in defaults OFF: only the account manager is emailed.
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const toAddresses = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(toAddresses).toEqual(['manager@example.com']);
    expect(toAddresses).not.toContain('client-billing@example.com');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // Opt-in ON: the canonical billing recipient is added exactly once; the
    // already-successful manager email is never resent.
    await db('client_billing_settings').where({ client_id: clientId }).update({ notify_client_on_prepaid_alert: true });
    sendEmailMock.mockClear();
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    expect(sendEmailMock.mock.calls.map((c) => c[0].to)).toEqual(['client-billing@example.com']);
    expect(sendEmailMock.mock.calls.some((c) => c[0].to === 'manager@example.com')).toBe(false);
  });

  it('does not retry a client delivery after the client opt-in is turned off', async () => {
    const tenantId = await createTenant('recipient-optout-retry');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, { billing_email: 'client-billing@example.com' });
    await createBillingSettings(tenantId, clientId, {
      threshold: 5000,
      currency: 'USD',
      notifyClient: true,
    });
    await createCredit(tenantId, clientId, { amount: 100 });

    sendEmailMock.mockRejectedValueOnce(new Error('transient provider error'));
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));
    const failed = (await deliveries(tenantId)).find((row) => row.channel === 'email');
    expect(failed?.status).toBe('failed');

    await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId })
      .update({ notify_client_on_prepaid_alert: false });
    sendEmailMock.mockClear();
    sendEmailMock.mockResolvedValue(undefined);
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const afterOptOut = await tenantDb(db, tenantId).table('prepaid_balance_alert_deliveries')
      .where({ delivery_id: failed?.delivery_id })
      .first();
    expect(afterOptOut.status).toBe('superseded');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Localization (draft-review defect #3): client emails follow the client's
  // locale; internal notifications (and manager emails) follow the recipient
  // user's locale. EUR 50.00 formats as "50,00 €" (de) vs "€ 50,00" (nl).
  // -------------------------------------------------------------------------
  it('uses the client locale for client emails and the recipient user locale for internal notifications', async () => {
    const tenantId = await createTenant('localization');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, { billing_email: 'client-billing@example.com' });
    const managerId = await createManager(tenantId, { email: 'manager@example.com' });
    await db('clients').where({ client_id: clientId }).update({
      account_manager_id: managerId,
      properties: JSON.stringify({ defaultLocale: 'de' }),
    });
    await db('user_preferences').insert({
      tenant: tenantId,
      user_id: managerId,
      setting_name: 'locale',
      setting_value: '"nl"',
      updated_at: db.fn.now(),
    });
    await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'EUR', notifyClient: true });
    await createCredit(tenantId, clientId, { amount: 100, currency: 'EUR' });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    // Manager email formatted in the manager's nl locale: "€ 50,00" (nl uses a
    // non-breaking space between the currency symbol and the amount).
    const managerCall = sendEmailMock.mock.calls.find((c) => c[0].to === 'manager@example.com');
    expect(managerCall).toBeDefined();
    expect(managerCall[0].locale).toBe('nl');
    expect(managerCall[0].context.alert.threshold).toBe(`€\u00A050,00`);

    // Client email formatted in the client's de locale: "50,00 €" (de also
    // uses a non-breaking space before the currency symbol).
    const clientCall = sendEmailMock.mock.calls.find((c) => c[0].to === 'client-billing@example.com');
    expect(clientCall).toBeDefined();
    expect(clientCall[0].locale).toBe('de');
    expect(clientCall[0].context.alert.threshold).toBe(`50,00\u00A0€`);

    // Internal notification follows the recipient user's locale (nl), including
    // the locale-formatted threshold in the rendered message.
    const notification = await tenantDb(db, tenantId).table('internal_notifications')
      .where({ tenant: tenantId, user_id: managerId })
      .orderBy('created_at', 'desc')
      .first();
    expect(notification).toBeDefined();
    expect(notification.language_code).toBe('nl');
    expect(String(notification.message)).toContain(`€\u00A050,00`);
  });

  it('includes locale-formatted bucket usage periods in manager, client, and internal contexts', async () => {
    const tenantId = await createTenant('bucket-period-localization');
    createdTenants.push(tenantId);
    const clientId = await createClient(tenantId, {
      billing_email: 'period-client@example.com',
      properties: JSON.stringify({ defaultLocale: 'de' }),
    });
    const managerId = await createManager(tenantId, { email: 'period-manager@example.com' });
    await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ account_manager_id: managerId });
    await db('user_preferences').insert({
      tenant: tenantId,
      user_id: managerId,
      setting_name: 'locale',
      setting_value: '"nl"',
      updated_at: db.fn.now(),
    });
    await createBillingSettings(tenantId, clientId, { percent: 80, notifyClient: true });

    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const periodStartDate = new Date(Date.UTC(year, month, 1));
    const periodEndDate = new Date(Date.UTC(year, month + 1, 0));
    const periodStart = periodStartDate.toISOString().slice(0, 10);
    const periodEnd = periodEndDate.toISOString().slice(0, 10);
    await createBucketFixture(tenantId, clientId, {
      totalMinutes: 1000,
      minutesUsed: 800,
      periodStart,
      periodEnd,
    });

    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantId));

    const managerCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'period-manager@example.com');
    const clientCall = sendEmailMock.mock.calls.find((call) => call[0].to === 'period-client@example.com');
    expect(managerCall).toBeDefined();
    expect(clientCall).toBeDefined();

    const nlStart = new Intl.DateTimeFormat('nl', { dateStyle: 'medium', timeZone: 'UTC' }).format(periodStartDate);
    const nlEnd = new Intl.DateTimeFormat('nl', { dateStyle: 'medium', timeZone: 'UTC' }).format(periodEndDate);
    const deStart = new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeZone: 'UTC' }).format(periodStartDate);
    const deEnd = new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeZone: 'UTC' }).format(periodEndDate);

    expect(managerCall[0].locale).toBe('nl');
    expect(managerCall[0].context.alert).toMatchObject({ periodStart: nlStart, periodEnd: nlEnd });
    expect(clientCall[0].locale).toBe('de');
    expect(clientCall[0].context.alert).toMatchObject({ periodStart: deStart, periodEnd: deEnd });

    const notification = await tenantDb(db, tenantId).table('internal_notifications')
      .where({ tenant: tenantId, user_id: managerId })
      .orderBy('created_at', 'desc')
      .first();
    expect(notification.language_code).toBe('nl');
    expect(String(notification.message)).toContain(nlStart);
    expect(String(notification.message)).toContain(nlEnd);
  });

  // -------------------------------------------------------------------------
  // Tenant isolation end-to-end (draft-review defect #4): two tenants with
  // identical clients/policies; scanning and delivering for tenant A never
  // touches tenant B's alerts, deliveries, or recipients.
  // -------------------------------------------------------------------------
  it('keeps scan and delivery fully isolated between tenants with identical fixtures', async () => {
    const tenantA = await createTenant('delivery-iso-a');
    const tenantB = await createTenant('delivery-iso-b');
    createdTenants.push(tenantA, tenantB);

    for (const [tenantId, tag] of [[tenantA, 'a'], [tenantB, 'b']] as const) {
      const clientId = await createClient(tenantId, { billing_email: `client-${tag}@example.com` });
      const managerId = await createManager(tenantId, { email: `manager-${tag}@example.com` });
      await db('clients').where({ client_id: clientId }).update({ account_manager_id: managerId });
      await createBillingSettings(tenantId, clientId, { threshold: 5000, currency: 'USD' });
      await createCredit(tenantId, clientId, { amount: 100 });
    }

    sendEmailMock.mockClear();
    await handlePrepaidBalanceAlertScanRequested(scanEvent(tenantA));

    const alertsB = await tenantDb(db, tenantB).table('prepaid_balance_alerts').where({ tenant: tenantB }).select('client_id');
    expect(alertsB).toHaveLength(0);

    const deliveriesA = await tenantDb(db, tenantA).table('prepaid_balance_alert_deliveries').where({ tenant: tenantA }).select('*');
    const deliveriesB = await tenantDb(db, tenantB).table('prepaid_balance_alert_deliveries').where({ tenant: tenantB }).select('*');
    expect(deliveriesA.length).toBeGreaterThan(0);
    expect(deliveriesB).toHaveLength(0);

    const toAddresses = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(toAddresses).toContain('manager-a@example.com');
    expect(toAddresses).not.toContain('manager-b@example.com');
    expect(toAddresses).not.toContain('client-b@example.com');
  });
});
