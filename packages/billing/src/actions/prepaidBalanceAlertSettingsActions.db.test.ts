import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from './_dbTestUtils';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
import { hasPermission } from '@alga-psa/auth/rbac';
import { prepaidBalanceAlertSettingsInputSchema } from '@shared/billingClients/prepaidBalanceAlertSettings';
import {
  getPrepaidBalanceAlertSettings,
  updatePrepaidBalanceAlertSettings,
} from './prepaidBalanceAlertSettingsActions';

const user = { user_id: 'test-user', user_type: 'internal' as const };

const tenantId = uuidv4();
const clientId = uuidv4();
const otherTenantId = uuidv4();
const otherTenantClientId = uuidv4();

let db: Knex;

async function deleteFixtureBillingSettings(): Promise<void> {
  await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).del();
  await db('client_billing_settings')
    .where({ tenant: otherTenantId, client_id: otherTenantClientId })
    .del();
}

async function seedBillingSettings(overrides: Record<string, unknown> = {}): Promise<void> {
  await db('client_billing_settings').insert({
    tenant: tenantId,
    client_id: clientId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Prepaid Alert Settings Test',
    email: `prepaid-settings-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('tenants').insert({
    tenant: otherTenantId,
    client_name: 'Prepaid Alert Other Tenant',
    email: `prepaid-settings-other-${otherTenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('clients').insert([
    {
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Prepaid Settings Co',
      is_inactive: false,
      default_currency_code: 'EUR',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: otherTenantId,
      client_id: otherTenantClientId,
      client_name: 'Other Tenant Co',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);
});

beforeEach(async () => {
  await deleteFixtureBillingSettings();
  (hasPermission as Mock).mockReset().mockResolvedValue(true);
});

afterAll(async () => {
  await deleteFixtureBillingSettings();
  await db('clients').where({ tenant: tenantId }).orWhere({ tenant: otherTenantId }).del();
  await db('tenants').where({ tenant: tenantId }).orWhere({ tenant: otherTenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('prepaid balance alert settings actions (DB-backed)', () => {
  it('read rejects without billing settings permission', async () => {
    (hasPermission as Mock).mockResolvedValueOnce(false);
    const denied = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(denied).toMatchObject({ permissionError: expect.any(String) });
  });

  it('update rejects without billing settings permission and leaves policy unchanged', async () => {
    (hasPermission as Mock).mockResolvedValueOnce(false);
    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
    });
    expect(result).toMatchObject({ permissionError: expect.any(String) });

    const row = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(row).toBeUndefined();
  });

  it('read returns nulls plus the client default currency when no policy exists', async () => {
    const result = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(result).toMatchObject({
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      defaultCurrencyCode: 'EUR',
    });
  });

  it('partial upsert changes only the four prepaid-alert columns', async () => {
    await seedBillingSettings({
      zero_dollar_invoice_handling: 'finalized',
      suppress_zero_dollar_invoices: true,
      enable_credit_expiration: true,
      credit_expiration_days: 90,
    });

    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
    });
    expect(result).toEqual({ success: true });

    const row = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(Number(row.prepaid_credit_alert_threshold)).toBe(5000);
    expect(row.prepaid_credit_alert_currency_code).toBe('USD');
    expect(Number(row.bucket_usage_alert_percent)).toBe(80);
    expect(row.notify_client_on_prepaid_alert).toBe(true);
    // Unrelated settings untouched (no broad null-delete).
    expect(row.zero_dollar_invoice_handling).toBe('finalized');
    expect(row.suppress_zero_dollar_invoices).toBe(true);
    expect(row.enable_credit_expiration).toBe(true);
    expect(Number(row.credit_expiration_days)).toBe(90);

    const read = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(read).toMatchObject({
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
    });
  });

  it('rejects invalid pairs, nonpositive amounts, out-of-range percents, and lowercase currency', async () => {
    await seedBillingSettings({
      prepaid_credit_alert_threshold: 5000,
      prepaid_credit_alert_currency_code: 'USD',
      bucket_usage_alert_percent: 80,
      notify_client_on_prepaid_alert: false,
    });

    const base = {
      clientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    };

    // Unpaired: amount without currency (schema pairing refinement is
    // authoritative; the DB constraint would also reject, but validation must
    // fire first).
    const unpaired = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      prepaidCreditAlertCurrencyCode: null,
    });
    expect(unpaired).toMatchObject({ actionError: expect.any(String) });

    // Nonpositive amount.
    const nonpositive = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      prepaidCreditAlertThreshold: 0,
    });
    expect(nonpositive).toMatchObject({ actionError: expect.any(String) });

    // Out-of-range percent.
    const badPercent = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      bucketUsageAlertPercent: 101,
    });
    expect(badPercent).toMatchObject({ actionError: expect.any(String) });

    // Lowercase / non-ISO currency.
    const lowercase = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      prepaidCreditAlertCurrencyCode: 'usd',
    });
    expect(lowercase).toMatchObject({ actionError: expect.any(String) });

    // The pre-existing policy is untouched by all of the above.
    const row = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(Number(row.prepaid_credit_alert_threshold)).toBe(5000);
    expect(row.prepaid_credit_alert_currency_code).toBe('USD');
    expect(Number(row.bucket_usage_alert_percent)).toBe(80);
  });

  it('forces client opt-in off when both alert types are disabled', async () => {
    await seedBillingSettings({
      prepaid_credit_alert_threshold: 5000,
      prepaid_credit_alert_currency_code: 'USD',
      bucket_usage_alert_percent: 80,
      notify_client_on_prepaid_alert: true,
    });

    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId,
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: true,
    });
    expect(result).toEqual({ success: true });

    const row = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(row.notify_client_on_prepaid_alert).toBe(false);
    expect(row.prepaid_credit_alert_threshold).toBeNull();
    expect(row.bucket_usage_alert_percent).toBeNull();
  });

  it('rejects updates for clients outside the session tenant', async () => {
    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId: otherTenantClientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    });
    expect(result).toMatchObject({ actionError: expect.any(String) });
  });

  it('rejects reads for cross-tenant and nonexistent client IDs', async () => {
    const crossTenant = await (getPrepaidBalanceAlertSettings as any)(
      user,
      { tenant: tenantId },
      otherTenantClientId
    );
    expect(crossTenant).toMatchObject({ actionError: expect.any(String) });

    const nonexistent = await (getPrepaidBalanceAlertSettings as any)(
      user,
      { tenant: tenantId },
      uuidv4()
    );
    expect(nonexistent).toMatchObject({ actionError: expect.any(String) });
  });

  it('input schema rejects a mismatched credit amount/currency pair by validation', () => {
    const valid = prepaidBalanceAlertSettingsInputSchema.safeParse({
      clientId: 'c1',
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    });
    expect(valid.success).toBe(true);

    const unpairedAmount = prepaidBalanceAlertSettingsInputSchema.safeParse({
      clientId: 'c1',
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    });
    expect(unpairedAmount.success).toBe(false);

    const unpairedCurrency = prepaidBalanceAlertSettingsInputSchema.safeParse({
      clientId: 'c1',
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    });
    expect(unpairedCurrency.success).toBe(false);

    const bothDisabled = prepaidBalanceAlertSettingsInputSchema.safeParse({
      clientId: 'c1',
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: true,
    });
    expect(bothDisabled.success).toBe(true);
  });
});
