import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Tenant default tax rate assignment (card alga-2026-0002527).
 *
 * DB-backed coverage for the shared resolver, the consolidated client
 * initializer, the catalog create contract, the settings round-trip, and the
 * explicit catalog backfill. Runs against a freshly-migrated disposable
 * database so the composite FK and eligibility rules are real.
 */

const mockState = vi.hoisted(() => ({
  db: null as unknown as Knex,
  tenantId: '',
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: mockState.db, tenant: mockState.tenantId }),
  };
});

function authModuleMock() {
  return {
    withAuth: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action(
        { user_id: '00000000-0000-0000-0000-0000000000aa', tenant: mockState.tenantId },
        { tenant: mockState.tenantId },
        ...args,
      ),
    withOptionalAuth: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action(
        { user_id: '00000000-0000-0000-0000-0000000000aa', tenant: mockState.tenantId },
        { tenant: mockState.tenantId },
        ...args,
      ),
    withAuthCheck: (action: (...a: any[]) => any) => async (...args: any[]) =>
      action({ user_id: '00000000-0000-0000-0000-0000000000aa', tenant: mockState.tenantId }, ...args),
    getCurrentUser: async () => ({
      user_id: '00000000-0000-0000-0000-0000000000aa',
      tenant: mockState.tenantId,
    }),
  };
}

const permissionState = vi.hoisted(() => ({ allowed: true }));

vi.mock('@alga-psa/auth', () => authModuleMock());
vi.mock('@alga-psa/auth/withAuth', () => authModuleMock());
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => permissionState.allowed,
}));
vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null },
}));

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  ensureDefaultBillingProfile,
  createBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import {
  InvalidDefaultTaxRateError,
  InvalidTaxRateSelectionError,
  NoActiveTaxRateError,
  initializeClientDefaultTax,
  resolveCatalogTaxRateIdForCreate,
  resolveClientDefaultTaxRate,
  resolveConfiguredDefaultTaxRate,
} from '@alga-psa/shared/billingClients/defaultTaxRate';
import {
  applyCatalogTaxRateBackfill,
  getTenantTaxSettings,
  previewCatalogTaxRateBackfill,
  updateDefaultTaxRateSetting,
} from '@alga-psa/billing/actions/taxSettingsActions';

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantA: string;
let tenantB: string;
let tenantEmpty: string;

function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}

async function createTenant(tenant: string, label: string): Promise<void> {
  await tenantDb(db, tenant)
    .unscoped('tenants', 'default tax rate integration fixture')
    .insert({
      tenant,
      client_name: label,
      email: `${label}-${tenant.slice(0, 8)}@tax.test`,
    });
}

async function createRegion(tenant: string, regionCode: string, isActive = true): Promise<void> {
  await table(tenant, 'tax_regions')
    .insert({ tenant, region_code: regionCode, region_name: regionCode, is_active: isActive })
    .onConflict(['tenant', 'region_code'])
    .ignore();
}

async function createRate(options: {
  tenant: string;
  regionCode: string;
  percentage: number;
  isActive?: boolean;
  startDate?: string;
  endDate?: string | null;
  createdAt?: string;
}): Promise<string> {
  const taxRateId = uuidv4();
  const row: Record<string, unknown> = {
    tax_rate_id: taxRateId,
    tenant: options.tenant,
    region_code: options.regionCode,
    tax_percentage: options.percentage,
    description: `${options.regionCode} ${options.percentage}%`,
    start_date: options.startDate ?? '2025-01-01',
    end_date: options.endDate ?? null,
    is_active: options.isActive ?? true,
  };
  if (options.createdAt) row.created_at = options.createdAt;
  await table(options.tenant, 'tax_rates').insert(row);
  return taxRateId;
}

async function createClient(tenant: string, name: string): Promise<string> {
  const clientId = uuidv4();
  await table(tenant, 'clients').insert({
    tenant,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function createServiceType(tenant: string, name: string): Promise<string> {
  const id = uuidv4();
  await table(tenant, 'service_types').insert({ id, tenant, name, is_active: true });
  return id;
}

async function createCatalogItem(options: {
  tenant: string;
  serviceTypeId: string;
  kind: 'service' | 'product';
  name: string;
  taxRateId: string | null;
}): Promise<string> {
  const serviceId = uuidv4();
  await table(options.tenant, 'service_catalog').insert({
    tenant: options.tenant,
    service_id: serviceId,
    service_name: options.name,
    item_kind: options.kind,
    billing_method: options.kind === 'product' ? 'usage' : 'fixed',
    custom_service_type_id: options.serviceTypeId,
    default_rate: 10000,
    unit_of_measure: 'each',
    is_active: true,
    is_license: false,
    tax_rate_id: options.taxRateId,
  });
  return serviceId;
}

async function setConfiguredDefault(tenant: string, taxRateId: string | null): Promise<void> {
  await table(tenant, 'tenant_settings')
    .insert({ tenant, default_tax_rate_id: taxRateId })
    .onConflict('tenant')
    .merge({ default_tax_rate_id: taxRateId });
}

describe('tenant default tax rate assignment', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_default_tax_rate' });

    tenantA = uuidv4();
    tenantB = uuidv4();
    tenantEmpty = uuidv4();
    await createTenant(tenantA, 'Default Tax Tenant A');
    await createTenant(tenantB, 'Default Tax Tenant B');
    await createTenant(tenantEmpty, 'Default Tax Tenant Empty');
    mockState.db = db;
    mockState.tenantId = tenantA;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await table(tenantA, 'tenant_settings').update({ default_tax_rate_id: null });
    await table(tenantB, 'tenant_settings').update({ default_tax_rate_id: null });
    mockState.tenantId = tenantA;
  }, HOOK_TIMEOUT);

  describe('resolver eligibility', () => {
    it('prefers the configured rate over an older active rate and reports the source', async () => {
      await createRegion(tenantA, 'AU-GST');
      const older = await createRate({
        tenant: tenantA,
        regionCode: 'AU-GST',
        percentage: 5,
        createdAt: '2025-01-01T00:00:00.000Z',
      });
      const configured = await createRate({
        tenant: tenantA,
        regionCode: 'AU-GST',
        percentage: 10,
        createdAt: '2025-06-01T00:00:00.000Z',
      });
      await setConfiguredDefault(tenantA, configured);

      const resolved = await resolveConfiguredDefaultTaxRate(db, tenantA);
      expect(resolved?.tax_rate_id).toBe(configured);
      expect(resolved?.tax_rate_id).not.toBe(older);
      expect(Number(resolved?.tax_percentage)).toBe(10);

      const clientResolved = await resolveClientDefaultTaxRate(db, tenantA);
      expect(clientResolved.source).toBe('configured');
      expect(clientResolved.taxRateId).toBe(configured);
    });

    it('rejects a configured default that is inactive, expired, or belongs to another tenant', async () => {
      await createRegion(tenantA, 'AU-BAD');
      const inactive = await createRate({
        tenant: tenantA,
        regionCode: 'AU-BAD',
        percentage: 10,
        isActive: false,
      });
      await setConfiguredDefault(tenantA, inactive);
      await expect(resolveConfiguredDefaultTaxRate(db, tenantA)).rejects.toBeInstanceOf(
        InvalidDefaultTaxRateError,
      );

      const expired = await createRate({
        tenant: tenantA,
        regionCode: 'AU-BAD',
        percentage: 10,
        endDate: '2025-02-01',
      });
      await setConfiguredDefault(tenantA, expired);
      await expect(resolveConfiguredDefaultTaxRate(db, tenantA)).rejects.toBeInstanceOf(
        InvalidDefaultTaxRateError,
      );

      // A foreign rate can never even be written as this tenant's default: the
      // composite FK rejects it before the resolver sees it.
      await createRegion(tenantB, 'AU-BAD');
      const foreign = await createRate({ tenant: tenantB, regionCode: 'AU-BAD', percentage: 10 });
      await expect(setConfiguredDefault(tenantA, foreign)).rejects.toMatchObject({ code: '23503' });
    });

    it('rejects a configured default whose region is inactive', async () => {
      await createRegion(tenantA, 'AU-OFF', false);
      const rate = await createRate({ tenant: tenantA, regionCode: 'AU-OFF', percentage: 10 });
      await setConfiguredDefault(tenantA, rate);
      await expect(resolveConfiguredDefaultTaxRate(db, tenantA)).rejects.toBeInstanceOf(
        InvalidDefaultTaxRateError,
      );
    });

    it('falls back to the oldest eligible active rate for clients when unset, and errors with no active rate', async () => {
      await createRegion(tenantA, 'AU-LEGACY');
      const oldest = await createRate({
        tenant: tenantA,
        regionCode: 'AU-LEGACY',
        percentage: 7,
        createdAt: '2020-01-01T00:00:00.000Z',
      });
      await createRate({
        tenant: tenantA,
        regionCode: 'AU-LEGACY',
        percentage: 9,
        createdAt: '2020-06-01T00:00:00.000Z',
      });

      const resolved = await resolveClientDefaultTaxRate(db, tenantA);
      expect(resolved.source).toBe('legacy-oldest-active');
      expect(resolved.taxRateId).toBe(oldest);

      await expect(resolveClientDefaultTaxRate(db, tenantEmpty)).rejects.toBeInstanceOf(
        NoActiveTaxRateError,
      );
    });
  });

  describe('catalog create contract', () => {
    it('inherits the configured default when omitted, preserves null, and accepts a tenant rate id', async () => {
      await createRegion(tenantA, 'AU-CATALOG');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-CATALOG', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);

      await expect(resolveCatalogTaxRateIdForCreate(db, tenantA, undefined)).resolves.toBe(configured);
      await expect(resolveCatalogTaxRateIdForCreate(db, tenantA, null)).resolves.toBeNull();
      await expect(resolveCatalogTaxRateIdForCreate(db, tenantA, configured)).resolves.toBe(configured);
      await expect(resolveCatalogTaxRateIdForCreate(db, tenantA, '')).rejects.toBeInstanceOf(
        InvalidTaxRateSelectionError,
      );
      await expect(resolveCatalogTaxRateIdForCreate(db, tenantA, uuidv4())).rejects.toBeInstanceOf(
        InvalidTaxRateSelectionError,
      );
    });

    it('returns null for omitted catalog input when no default is configured', async () => {
      await expect(resolveCatalogTaxRateIdForCreate(db, tenantEmpty, undefined)).resolves.toBeNull();
    });
  });

  describe('client initialization', () => {
    it('creates one client-wide default and profile settings, is idempotent, and never fabricates components', async () => {
      await createRegion(tenantA, 'AU-CLIENT');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-CLIENT', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);
      const clientId = await createClient(tenantA, 'Initialized Client');

      await initializeClientDefaultTax(db, tenantA, clientId);
      await initializeClientDefaultTax(db, tenantA, clientId);

      const settings = await table(tenantA, 'client_tax_settings').where({ client_id: clientId });
      expect(settings).toHaveLength(1);
      expect(settings[0].is_reverse_charge_applicable).toBe(false);

      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true })
        .whereNull('location_id');
      expect(defaults).toHaveLength(1);
      expect(defaults[0].tax_rate_id).toBe(configured);

      const components = await table(tenantA, 'tax_components').where({ tax_rate_id: configured });
      expect(components).toHaveLength(0);
    });

    it('preserves an existing explicit default across a settings change', async () => {
      await createRegion(tenantA, 'AU-PRESERVE');
      const first = await createRate({ tenant: tenantA, regionCode: 'AU-PRESERVE', percentage: 10 });
      const second = await createRate({ tenant: tenantA, regionCode: 'AU-PRESERVE', percentage: 12 });
      await setConfiguredDefault(tenantA, first);
      const clientId = await createClient(tenantA, 'Preserve Default Client');
      await initializeClientDefaultTax(db, tenantA, clientId);

      await setConfiguredDefault(tenantA, second);
      await initializeClientDefaultTax(db, tenantA, clientId);

      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true })
        .whereNull('location_id');
      expect(defaults).toHaveLength(1);
      expect(defaults[0].tax_rate_id).toBe(first);
    });

    it('does not create a second default when provisioning a second billing profile', async () => {
      await createRegion(tenantA, 'AU-PROFILE');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-PROFILE', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);
      const clientId = await createClient(tenantA, 'Second Profile Client');

      const defaultProfileId = await ensureDefaultBillingProfile(
        { db, tenantId: tenantA },
        clientId,
        { name: 'Second Profile Client' },
      );
      const secondProfileId = await createBillingProfile(
        { db, tenantId: tenantA },
        clientId,
        'Second Entity',
      );

      await initializeClientDefaultTax(db, tenantA, clientId);
      await initializeClientDefaultTax(db, tenantA, clientId, {
        billingProfileId: secondProfileId,
      });

      const settings = await table(tenantA, 'client_tax_settings').where({ client_id: clientId });
      expect(settings).toHaveLength(2);
      expect(settings.map((row) => row.billing_profile_id).sort()).toEqual(
        [defaultProfileId, secondProfileId].sort(),
      );

      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true });
      expect(defaults).toHaveLength(1);
    });

    it('errors and rolls back when a location-specific association conflicts with the resolved rate', async () => {
      await createRegion(tenantA, 'AU-CONFLICT');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-CONFLICT', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);
      const clientId = await createClient(tenantA, 'Conflict Client');
      await table(tenantA, 'client_tax_rates').insert({
        tenant: tenantA,
        client_id: clientId,
        tax_rate_id: configured,
        is_default: false,
        location_id: uuidv4(),
      });

      await expect(
        db.transaction((trx) => initializeClientDefaultTax(trx, tenantA, clientId)),
      ).rejects.toBeInstanceOf(InvalidDefaultTaxRateError);

      // The failed transaction must leave no partial client-wide default.
      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true });
      expect(defaults).toHaveLength(0);
    });
  });

  describe('settings and backfill actions', () => {
    it('round-trips the saved default and preserves unrelated settings', async () => {
      await createRegion(tenantA, 'AU-SETTINGS');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-SETTINGS', percentage: 10 });
      await table(tenantA, 'tenant_settings')
        .insert({ tenant: tenantA, default_tax_source: 'external' })
        .onConflict('tenant')
        .merge({ default_tax_source: 'external' });

      const summary = await updateDefaultTaxRateSetting(configured);
      expect(summary && 'tax_rate_id' in summary ? summary.tax_rate_id : null).toBe(configured);

      const state = await getTenantTaxSettings();
      expect(state && 'default_tax_rate_id' in state ? state.default_tax_rate_id : undefined).toBe(
        configured,
      );

      const row = await table(tenantA, 'tenant_settings').first();
      expect(row.default_tax_source).toBe('external');

      await updateDefaultTaxRateSetting(null);
      const cleared = await getTenantTaxSettings();
      expect(cleared && 'default_tax_rate_id' in cleared ? cleared.default_tax_rate_id : 'x').toBeNull();
    });

    it('previews and applies only selected still-NULL tenant rows, counting skips, and is idempotent', async () => {
      await createRegion(tenantA, 'AU-BACKFILL');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-BACKFILL', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);
      const serviceTypeId = await createServiceType(tenantA, 'Default Tax Service Type');

      const nullService = await createCatalogItem({
        tenant: tenantA,
        serviceTypeId,
        kind: 'service',
        name: 'Backfill Service',
        taxRateId: null,
      });
      const nullProduct = await createCatalogItem({
        tenant: tenantA,
        serviceTypeId,
        kind: 'product',
        name: 'Backfill Product',
        taxRateId: null,
      });
      const assigned = await createCatalogItem({
        tenant: tenantA,
        serviceTypeId,
        kind: 'service',
        name: 'Already Taxed Service',
        taxRateId: configured,
      });
      const foreign = await createCatalogItem({
        tenant: tenantB,
        serviceTypeId: await createServiceType(tenantB, 'Default Tax Service Type B'),
        kind: 'service',
        name: 'Foreign Service',
        taxRateId: null,
      });

      const preview = await previewCatalogTaxRateBackfill();
      expect(preview && 'items' in preview ? preview.default_tax_rate_id : null).toBe(configured);
      const previewIds = preview && 'items' in preview ? preview.items.map((i) => i.service_id) : [];
      expect(previewIds).toEqual(expect.arrayContaining([nullService, nullProduct]));
      expect(previewIds).not.toContain(assigned);
      expect(previewIds).not.toContain(foreign);

      const first = await applyCatalogTaxRateBackfill([nullService, foreign, assigned], configured);
      expect(first).toMatchObject({ changed: 1, skipped: 2 });

      const rows = await table(tenantA, 'service_catalog')
        .whereIn('service_id', [nullService, nullProduct, assigned])
        .select('service_id', 'tax_rate_id');
      const byId = new Map(rows.map((r) => [r.service_id, r.tax_rate_id]));
      expect(byId.get(nullService)).toBe(configured);
      expect(byId.get(nullProduct)).toBeNull();
      expect(byId.get(assigned)).toBe(configured);

      // Retrying the same selection changes nothing further.
      const second = await applyCatalogTaxRateBackfill([nullService], configured);
      expect(second).toMatchObject({ changed: 0, skipped: 1 });

      // The foreign row must never have been touched by tenant A.
      const foreignRow = await table(tenantB, 'service_catalog')
        .where({ service_id: foreign })
        .first();
      expect(foreignRow.tax_rate_id).toBeNull();
    });

    it('rejects applying a stale preview target', async () => {
      await createRegion(tenantA, 'AU-STALE');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-STALE', percentage: 10 });
      const other = await createRate({ tenant: tenantA, regionCode: 'AU-STALE', percentage: 12 });
      await setConfiguredDefault(tenantA, other);

      const result = await applyCatalogTaxRateBackfill([uuidv4()], configured);
      expect(result).toMatchObject({
        actionError: expect.stringContaining('changed since this preview'),
      });
    });

    it('requires the previewed default id and does not apply when it is omitted', async () => {
      await createRegion(tenantA, 'AU-MANDATORY');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-MANDATORY', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);

      const result = await (applyCatalogTaxRateBackfill as unknown as (
        ids: string[],
        expected?: string,
      ) => Promise<unknown>)([uuidv4()]);
      expect(result).toMatchObject({
        actionError: expect.stringContaining('previewed default tax rate is required'),
      });
    });

    it('refuses to preview or apply without a configured default', async () => {
      mockState.tenantId = tenantEmpty;
      await expect(previewCatalogTaxRateBackfill()).rejects.toBeTruthy();
    });

    it('denies preview and apply when the caller lacks permission', async () => {
      permissionState.allowed = false;
      try {
        const preview = await previewCatalogTaxRateBackfill();
        expect(preview).toMatchObject({ permissionError: expect.any(String) });

        const apply = await applyCatalogTaxRateBackfill([uuidv4()], uuidv4());
        expect(apply).toMatchObject({ permissionError: expect.any(String) });
      } finally {
        permissionState.allowed = true;
      }
    });
  });

  describe('initializer association lookup and explicit defaults', () => {
    it('returns early when the client already has a valid explicit default, even with an invalid tenant default', async () => {
      await createRegion(tenantA, 'AU-EXPLICIT');
      const valid = await createRate({ tenant: tenantA, regionCode: 'AU-EXPLICIT', percentage: 10 });
      const expired = await createRate({
        tenant: tenantA,
        regionCode: 'AU-EXPLICIT',
        percentage: 5,
        endDate: '2025-02-01',
      });
      await setConfiguredDefault(tenantA, expired);

      const clientId = await createClient(tenantA, 'Explicit Default Client');
      await table(tenantA, 'client_tax_rates').insert({
        tenant: tenantA,
        client_id: clientId,
        tax_rate_id: valid,
        is_default: true,
        location_id: null,
      });

      await expect(initializeClientDefaultTax(db, tenantA, clientId)).resolves.toBeTruthy();

      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true })
        .whereNull('location_id');
      expect(defaults).toHaveLength(1);
      expect(defaults[0].tax_rate_id).toBe(valid);
    });

    it('promotes an existing association for the resolved rate instead of inserting a duplicate', async () => {
      await createRegion(tenantA, 'AU-MATCH');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-MATCH', percentage: 10 });
      const older = await createRate({ tenant: tenantA, regionCode: 'AU-MATCH', percentage: 5 });
      await setConfiguredDefault(tenantA, configured);

      const clientId = await createClient(tenantA, 'Matching Association Client');
      await table(tenantA, 'client_tax_rates').insert([
        {
          tenant: tenantA,
          client_id: clientId,
          tax_rate_id: older,
          is_default: false,
          location_id: null,
          created_at: '2020-01-01T00:00:00.000Z',
        },
        {
          tenant: tenantA,
          client_id: clientId,
          tax_rate_id: configured,
          is_default: false,
          location_id: null,
          created_at: '2021-01-01T00:00:00.000Z',
        },
      ]);

      await initializeClientDefaultTax(db, tenantA, clientId);

      const rows = await table(tenantA, 'client_tax_rates').where({ client_id: clientId });
      expect(rows.filter((row) => row.tax_rate_id === configured)).toHaveLength(1);
      expect(rows.filter((row) => row.is_default)).toHaveLength(1);
      expect(rows.find((row) => row.is_default)?.tax_rate_id).toBe(configured);
      expect(rows.find((row) => row.tax_rate_id === older)?.is_default).toBe(false);
    });
  });

  describe('lock coordination (concurrency)', () => {
    it('serializes a default save behind a region lock and refuses once the region is deactivated', async () => {
      await createRegion(tenantA, 'AU-RACE-REGION');
      const rate = await createRate({ tenant: tenantA, regionCode: 'AU-RACE-REGION', percentage: 10 });

      const holder = await db.transaction();
      try {
        await holder('tax_regions')
          .where({ tenant: tenantA, region_code: 'AU-RACE-REGION' })
          .forUpdate()
          .select('region_code');

        const savePromise = updateDefaultTaxRateSetting(rate);
        const outcome = await Promise.race([
          savePromise.then(() => 'settled').catch(() => 'settled'),
          new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
        ]);
        expect(outcome).toBe('pending');

        await holder('tax_regions')
          .where({ tenant: tenantA, region_code: 'AU-RACE-REGION' })
          .update({ is_active: false });
        await holder.commit();

        const result = await savePromise;
        expect(result).toMatchObject({
          actionError: expect.stringContaining('cannot be used as the tenant default'),
        });
      } finally {
        await holder.rollback().catch(() => undefined);
      }
    });

    it('re-validates a client default under the rate lock instead of trusting pre-lock validation', async () => {
      await createRegion(tenantA, 'AU-RACE-RATE');
      const configured = await createRate({ tenant: tenantA, regionCode: 'AU-RACE-RATE', percentage: 10 });
      await setConfiguredDefault(tenantA, configured);
      const clientId = await createClient(tenantA, 'Race Rate Client');

      const holder = await db.transaction();
      try {
        await holder('tax_rates')
          .where({ tenant: tenantA, tax_rate_id: configured })
          .forUpdate()
          .select('tax_rate_id');
        await holder('tax_rates')
          .where({ tenant: tenantA, tax_rate_id: configured })
          .update({ is_active: false });

        const initPromise = db.transaction((trx) =>
          initializeClientDefaultTax(trx, tenantA, clientId),
        );
        const outcome = await Promise.race([
          initPromise.then(() => 'settled').catch(() => 'settled'),
          new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
        ]);
        expect(outcome).toBe('pending');

        await holder.commit();
        await expect(initPromise).rejects.toBeInstanceOf(InvalidDefaultTaxRateError);
      } finally {
        await holder.rollback().catch(() => undefined);
      }

      const defaults = await table(tenantA, 'client_tax_rates')
        .where({ client_id: clientId, is_default: true });
      expect(defaults).toHaveLength(0);
    });
  });

  describe('migration integrity', () => {
    it('rejects a cross-tenant default via the composite FK', async () => {
      await createRegion(tenantA, 'AU-FK');
      const rateA = await createRate({ tenant: tenantA, regionCode: 'AU-FK', percentage: 10 });

      await expect(
        tenantDb(db, tenantB)
          .unscoped('tenant_settings', 'cross-tenant FK assertion')
          .insert({ tenant: tenantB, default_tax_rate_id: rateA }),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('refuses to delete a tax rate that is the configured default (ON DELETE RESTRICT)', async () => {
      await createRegion(tenantA, 'AU-RESTRICT');
      const configured = await createRate({
        tenant: tenantA,
        regionCode: 'AU-RESTRICT',
        percentage: 10,
      });
      await setConfiguredDefault(tenantA, configured);

      await expect(
        table(tenantA, 'tax_rates').where({ tax_rate_id: configured }).del(),
      ).rejects.toMatchObject({ code: '23503' });

      const stillThere = await table(tenantA, 'tax_rates')
        .where({ tax_rate_id: configured })
        .first();
      expect(stillThere).toBeTruthy();
    });
  });
});
