import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { v4 as uuidv4 } from 'uuid';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core')>();
  return { ...actual, isFeatureFlagEnabled: vi.fn(async () => true) };
});

import { hasPermission } from '@alga-psa/auth/rbac';
import { isFeatureFlagEnabled } from '@alga-psa/core';
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

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  
  db = knexLib({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_SERVER || 'app_user',
      password: process.env.DB_PASSWORD_SERVER || '',
    },
    pool: { min: 0, max: 5 },
  });

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

afterAll(async () => {
  await db('client_billing_settings').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).orWhere({ tenant: otherTenantId }).del();
  await db('tenants').where({ tenant: tenantId }).orWhere({ tenant: otherTenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('prepaid balance alert settings actions (DB-backed)', () => {
  it('read rejects when the feature flag is disabled or the checker is unavailable', async () => {
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(false);
    const result = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(result).toMatchObject({ actionError: expect.any(String) });

    (isFeatureFlagEnabled as Mock).mockRejectedValueOnce(new Error('flag infra down'));
    const thrown = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(thrown).toMatchObject({ actionError: expect.any(String) });

    (hasPermission as Mock).mockResolvedValueOnce(false);
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const denied = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(denied).toMatchObject({ permissionError: expect.any(String) });
  });

  it('update rejects when the feature flag is disabled and leaves policy unchanged', async () => {
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(false);
    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
    });
    expect(result).toMatchObject({ actionError: expect.any(String) });

    const row = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(row).toBeUndefined();
  });

  it('read returns nulls plus the client default currency when no policy exists', async () => {
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
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
    await db('client_billing_settings').insert({
      tenant: tenantId,
      client_id: clientId,
      zero_dollar_invoice_handling: 'finalized',
      suppress_zero_dollar_invoices: true,
      enable_credit_expiration: true,
      credit_expiration_days: 90,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
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

    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const read = await (getPrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, clientId);
    expect(read).toMatchObject({
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
    });
  });

  it('rejects invalid pairs, nonpositive amounts, out-of-range percents, and lowercase currency', async () => {
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
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const unpaired = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      prepaidCreditAlertCurrencyCode: null,
    });
    expect(unpaired).toMatchObject({ actionError: expect.any(String) });

    // Nonpositive amount.
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const nonpositive = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      prepaidCreditAlertThreshold: 0,
    });
    expect(nonpositive).toMatchObject({ actionError: expect.any(String) });

    // Out-of-range percent.
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const badPercent = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      ...base,
      bucketUsageAlertPercent: 101,
    });
    expect(badPercent).toMatchObject({ actionError: expect.any(String) });

    // Lowercase / non-ISO currency.
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
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
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
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
    (isFeatureFlagEnabled as Mock).mockResolvedValueOnce(true);
    const result = await (updatePrepaidBalanceAlertSettings as any)(user, { tenant: tenantId }, {
      clientId: otherTenantClientId,
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: false,
    });
    expect(result).toMatchObject({ actionError: expect.any(String) });
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
