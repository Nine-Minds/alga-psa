import { expect, test, type Page } from '@playwright/test';
import { encode } from '@auth/core/jwt';
import { knex as createKnex, type Knex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';
import { applyPlaywrightAuthEnvDefaults } from './helpers/playwrightAuthSessionHelper';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

function adminDb(): Knex {
  return createKnex({
    client: 'pg',
    connection: {
      host: PLAYWRIGHT_DB_CONFIG.host,
      port: PLAYWRIGHT_DB_CONFIG.port,
      database: PLAYWRIGHT_DB_CONFIG.database,
      user: PLAYWRIGHT_DB_CONFIG.adminUser,
      password: PLAYWRIGHT_DB_CONFIG.adminPassword,
    },
    pool: { min: 0, max: 5 },
  });
}

async function getInternalUser(db: Knex, email?: string) {
  if (email) {
    const row = await db('users')
      .where({ email: email.toLowerCase(), user_type: 'internal' })
      .first();
    if (row) return row;
  }
  const internal = await db('users').where({ user_type: 'internal' }).first();
  if (!internal) throw new Error('No internal users found in Playwright database.');
  return internal;
}

async function setInternalSessionCookie(
  page: Page,
  user: any,
  baseUrl: string
): Promise<{ warmupRequired: boolean; cookieName: string }> {
  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET must be defined to mint session cookie.');
  }

  const token = await encode({
    token: {
      sub: user.user_id,
      id: user.user_id,
      email: user.email,
      tenant: user.tenant,
      user_type: 'internal',
    },
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 60 * 60,
    salt: 'authjs.session-token',
  });

  const cookieName = process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const base = new URL(baseUrl);

  try {
    await page.context().addCookies([
      {
        name: cookieName,
        value: token,
        url: base.origin
      }
    ]);
    return { warmupRequired: false, cookieName };
  } catch (error) {
    console.warn('[Playwright] Failed to set auth cookie via context, falling back to client script.', error);
    const cookieValue = `${cookieName}=${token}; path=/; SameSite=Lax`;
    await page.addInitScript((value: string) => {
      document.cookie = value;
    }, cookieValue);
    return { warmupRequired: true, cookieName };
  }
}

test.describe('Accounting Settings – QuickBooks Mapping CRUD', () => {
  test('manages item mappings on the real settings screen with mocked server actions', async ({ page }) => {
    test.setTimeout(120_000);
    const db = adminDb();
    let internalUser: any;

    try {
      await db.raw('SELECT 1');
      internalUser = await getInternalUser(db, process.env.PLAYWRIGHT_INTERNAL_TEST_EMAIL);
    } catch (error) {
      await db.destroy().catch(() => undefined);
      test.skip(true, 'Playwright database not reachable or missing seeded internal user.');
      return;
    }

    const bypassAuth = process.env.E2E_AUTH_BYPASS === 'true';
    let tenantQuery: string | undefined;
    if (bypassAuth) {
      tenantQuery = internalUser?.tenant ? `tenantId=${internalUser.tenant}` : undefined;
    } else {
      const { warmupRequired, cookieName } = await setInternalSessionCookie(page, internalUser, BASE_URL);
      if (warmupRequired) {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          (name) => document.cookie.includes(`${name}=`),
          cookieName,
          { timeout: 5000 }
        );
      }
    }

    try {
      await page.addInitScript(({ mocks, tenantId }) => {
        const qbStore = {
          status: mocks.qboStatus,
          services: mocks.qboServices,
          items: mocks.qboItems,
          taxRegions: mocks.qboTaxRegions,
          taxCodes: mocks.qboTaxCodes,
          terms: mocks.qboTerms,
          mappings: (mocks.qboInitialMappings || []).map((mapping) => ({
            ...mapping,
            created_at: mapping.created_at ?? new Date().toISOString(),
            updated_at: mapping.updated_at ?? new Date().toISOString(),
          })),
          taxMappings: [],
          termMappings: [],
          nextSequence: 1,
        };

        const buildDisplayMapping = (entry) => ({
          ...entry,
          algaEntityName:
            qbStore.services.find((svc) => svc.service_id === entry.alga_entity_id)?.service_name ?? entry.alga_entity_id,
          externalEntityName:
            qbStore.items.find((item) => item.id === entry.external_entity_id)?.name ?? entry.external_entity_id,
        });

        const qbOverrides = {
          loadData: async () => ({
            mappings: qbStore.mappings.map((mapping) => ({ ...mapping })),
            algaEntities: qbStore.services.map((svc) => ({ id: svc.service_id, name: svc.service_name })),
            externalEntities: qbStore.items.map((item) => ({ id: item.id, name: item.name })),
          }),
          createMapping: async (_context: unknown, data: any) => {
            const timestamp = new Date().toISOString();
            const mapping = buildDisplayMapping({
              ...data,
              id: `mapping-${String(qbStore.nextSequence++).padStart(3, '0')}`,
              created_at: timestamp,
              updated_at: timestamp,
            });
            qbStore.mappings.push(mapping);
            return mapping;
          },
          updateMapping: async (_context: unknown, mappingId: string, updates: any) => {
            const index = qbStore.mappings.findIndex((mapping) => mapping.id === mappingId);
            if (index === -1) {
              return null;
            }
            const next = buildDisplayMapping({
              ...qbStore.mappings[index],
              ...updates,
              updated_at: new Date().toISOString(),
            });
            qbStore.mappings[index] = next;
            return next;
          },
          deleteMapping: async (_context: unknown, mappingId: string) => {
            qbStore.mappings = qbStore.mappings.filter((mapping) => mapping.id !== mappingId);
          },
        };

        const qbTaxOverrides = {
          loadData: async () => ({
            mappings: qbStore.taxMappings.map((mapping) => ({ ...mapping })),
            algaEntities: qbStore.taxRegions.map((region) => ({
              id: region.region_code,
              name: region.region_name,
            })),
            externalEntities: qbStore.taxCodes.map((tax) => ({ id: tax.id, name: tax.name })),
          }),
          createMapping: async (_context: unknown, data: any) => {
            const timestamp = new Date().toISOString();
            const mapping = {
              ...data,
              id: `qb-tax-${String(qbStore.taxMappings.length + 1).padStart(3, '0')}`,
              created_at: timestamp,
              updated_at: timestamp,
            };
            qbStore.taxMappings.push(mapping);
            return mapping;
          },
          updateMapping: async (_context: unknown, mappingId: string, updates: any) => {
            const index = qbStore.taxMappings.findIndex((mapping) => mapping.id === mappingId);
            if (index === -1) return null;
            const next = {
              ...qbStore.taxMappings[index],
              ...updates,
              updated_at: new Date().toISOString(),
            };
            qbStore.taxMappings[index] = next;
            return next;
          },
          deleteMapping: async (_context: unknown, mappingId: string) => {
            qbStore.taxMappings = qbStore.taxMappings.filter((mapping) => mapping.id !== mappingId);
          },
        };

        const qbTermOverrides = {
          loadData: async () => ({
            mappings: qbStore.termMappings.map((mapping) => ({ ...mapping })),
            algaEntities: qbStore.terms.map((term) => ({ id: term.id, name: term.name })),
            externalEntities: qbStore.terms.map((term) => ({ id: `${term.id}-external`, name: `${term.name} (QBO)` })),
          }),
          createMapping: async (_context: unknown, data: any) => {
            const timestamp = new Date().toISOString();
            const mapping = {
              ...data,
              id: `qb-term-${String(qbStore.termMappings.length + 1).padStart(3, '0')}`,
              created_at: timestamp,
              updated_at: timestamp,
            };
            qbStore.termMappings.push(mapping);
            return mapping;
          },
          updateMapping: async (_context: unknown, mappingId: string, updates: any) => {
            const index = qbStore.termMappings.findIndex((mapping) => mapping.id === mappingId);
            if (index === -1) return null;
            const next = {
              ...qbStore.termMappings[index],
              ...updates,
              updated_at: new Date().toISOString(),
            };
            qbStore.termMappings[index] = next;
            return next;
          },
          deleteMapping: async (_context: unknown, mappingId: string) => {
            qbStore.termMappings = qbStore.termMappings.filter((mapping) => mapping.id !== mappingId);
          },
        };

        const xeroStore = {
          services: mocks.xeroServices,
          items: mocks.xeroItems,
          taxRegions: mocks.xeroTaxRegions,
          taxRates: mocks.xeroTaxRates,
          mappings: [] as any[],
          taxMappings: [] as any[],
          nextSequence: 1,
        };

        const buildXeroDisplay = (entry) => ({
          ...entry,
          algaName:
            xeroStore.services.find((svc) => svc.service_id === entry.alga_entity_id)?.service_name ?? entry.alga_entity_id,
          externalName:
            xeroStore.items.find((item) => item.id === entry.external_entity_id)?.name ?? entry.external_entity_id,
        });

        const xeroServiceOverrides = {
          loadData: async () => ({
            mappings: xeroStore.mappings.map((mapping) => ({ ...mapping })),
            algaEntities: xeroStore.services.map((svc) => ({ id: svc.service_id, name: svc.service_name })),
            externalEntities: xeroStore.items.map((item) => ({ id: item.id, name: item.name })),
          }),
          createMapping: async (_context: unknown, data: any) => {
            const timestamp = new Date().toISOString();
            const mapping = buildXeroDisplay({
              ...data,
              id: `xero-map-${String(xeroStore.nextSequence++).padStart(3, '0')}`,
              created_at: timestamp,
              updated_at: timestamp,
            });
            xeroStore.mappings.push(mapping);
            return mapping;
          },
          updateMapping: async (_context: unknown, mappingId: string, updates: any) => {
            const index = xeroStore.mappings.findIndex((mapping) => mapping.id === mappingId);
            if (index === -1) return null;
            const next = buildXeroDisplay({
              ...xeroStore.mappings[index],
              ...updates,
              updated_at: new Date().toISOString(),
            });
            xeroStore.mappings[index] = next;
            return next;
          },
          deleteMapping: async (_context: unknown, mappingId: string) => {
            xeroStore.mappings = xeroStore.mappings.filter((mapping) => mapping.id !== mappingId);
          },
        };

        const xeroTaxOverrides = {
          loadData: async () => ({
            mappings: xeroStore.taxMappings.map((mapping) => ({ ...mapping })),
            algaEntities: xeroStore.taxRegions.map((region) => ({ id: region.region_code, name: region.region_name })),
            externalEntities: xeroStore.taxRates.map((rate) => ({ id: rate.id, name: rate.name })),
          }),
          createMapping: async (_context: unknown, data: any) => {
            const timestamp = new Date().toISOString();
            const mapping = {
              ...data,
              id: `xero-tax-${String(xeroStore.taxMappings.length + 1).padStart(3, '0')}`,
              created_at: timestamp,
              updated_at: timestamp,
            };
            xeroStore.taxMappings.push(mapping);
            return mapping;
          },
          updateMapping: async (_context: unknown, mappingId: string, updates: any) => {
            const index = xeroStore.taxMappings.findIndex((mapping) => mapping.id === mappingId);
            if (index === -1) return null;
            const next = {
              ...xeroStore.taxMappings[index],
              ...updates,
              updated_at: new Date().toISOString(),
            };
            xeroStore.taxMappings[index] = next;
            return next;
          },
          deleteMapping: async (_context: unknown, mappingId: string) => {
            xeroStore.taxMappings = xeroStore.taxMappings.filter((mapping) => mapping.id !== mappingId);
          },
        };

        const globalAny = window as typeof window & {
          __ALGA_PLAYWRIGHT_ACCOUNTING__?: any;
          __ALGA_PLAYWRIGHT_QBO__?: any;
        };

        globalAny.__ALGA_PLAYWRIGHT_ACCOUNTING__ = {
          quickbooks_online: {
            'qbo-service-mappings': qbOverrides,
            'qbo-tax-code-mappings': qbTaxOverrides,
            'qbo-term-mappings': qbTermOverrides,
          },
          xero: {
            'xero-service-mappings': xeroServiceOverrides,
            'xero-tax-rate-mappings': xeroTaxOverrides,
          },
          status: {
            xero: mocks.xeroStatus,
          },
          tenantId: tenantId ?? null
        };

        globalAny.__ALGA_PLAYWRIGHT_QBO__ = {
          connectionStatus: qbStore.status,
          itemMappingOverrides: qbOverrides,
        };
      },
      {
        mocks: {
          qboStatus: {
            connected: true,
            status: 'Connected',
            clientName: 'Acme MSP',
            realmId: 'realm-playwright',
          },
          qboServices: [
            {
              service_id: 'svc-001',
              service_name: 'Managed Services',
              custom_service_type_id: 'srv-type-1',
              billing_method: 'fixed',
              default_rate: 1500,
              category_id: null,
              unit_of_measure: 'month',
              tax_rate_id: null,
              description: 'Recurring managed services subscription',
              service_type_name: 'Managed',
              tenant: 'tenant-playwright',
            },
            {
              service_id: 'svc-002',
              service_name: 'Project Support',
              custom_service_type_id: 'srv-type-2',
              billing_method: 'hourly',
              default_rate: 225,
              category_id: null,
              unit_of_measure: 'hour',
              tax_rate_id: null,
              description: 'Project-based support hours',
              service_type_name: 'Project',
              tenant: 'tenant-playwright',
            },
          ],
          qboItems: [
            { id: 'qbo-item-consulting', name: 'Consulting' },
            { id: 'qbo-item-consulting-premium', name: 'Consulting - Premium' },
            { id: 'qbo-item-managed-services', name: 'Managed Services Bundle' },
          ],
          qboTaxRegions: [
            { region_code: 'NA', region_name: 'North America' },
            { region_code: 'EU', region_name: 'Europe' },
          ],
          qboTaxCodes: [
            { id: 'tax-code-standard', name: 'Standard Tax' },
            { id: 'tax-code-zero', name: 'Zero Tax' },
          ],
          qboTerms: [
            { id: 'net_15', name: 'Net 15' },
            { id: 'net_30', name: 'Net 30' },
          ],
          qboInitialMappings: [],
          xeroServices: [
            {
              service_id: 'svc-003',
              service_name: 'Xero Managed Support',
            },
          ],
          xeroItems: [
            { id: 'xero-item-support', name: 'Support Plan (Xero)' },
            { id: 'xero-item-remote', name: 'Remote Services (Xero)' },
          ],
          xeroTaxRegions: [
            { region_code: 'AU-NSW', region_name: 'Australia NSW' },
          ],
          xeroTaxRates: [
            { id: 'XERO-GST', name: 'GST on Income' },
          ],
          xeroStatus: {
            connections: [
              { connectionId: 'xero-conn-1', xeroTenantId: 'XERO-TENANT-123', status: 'connected' },
            ],
            connected: true,
            defaultConnectionId: 'xero-conn-1',
          },
        },
        tenantId: bypassAuth ? internalUser?.tenant ?? null : null,
      });

      const searchParamSegments = [tenantQuery, bypassAuth ? 'authBypass=true' : undefined]
        .filter((segment): segment is string => Boolean(segment));
      const settingsUrl =
        searchParamSegments.length > 0
          ? `${BASE_URL}/msp/settings?${searchParamSegments.join('&')}`
          : `${BASE_URL}/msp/settings`;

      await page.goto(settingsUrl, {
        waitUntil: 'networkidle',
      });

      const integrationsTab = page.getByRole('tab', { name: /Integrations/i });
      await integrationsTab.click();
      await expect(integrationsTab).toHaveAttribute('aria-selected', 'true');

      await expect(page.locator('#qbo-mapping-card')).toBeVisible();

      await page.click('#add-qbo-item-mapping-button');
      const serviceSelect = page.locator('button[aria-label="Select Alga Service..."]');
      await serviceSelect.click();
      await page.getByRole('option', { name: 'Managed Services' }).click();

      const itemSelect = page.locator('button[aria-label="Select QuickBooks Item..."]');
      await itemSelect.click();
      await page.getByRole('option', { name: 'Consulting', exact: true }).click();

      await page.click('#qbo-item-mapping-dialog-save-button');

      const table = page.locator('#qbo-item-mappings-table');
      await expect(table).toContainText('Managed Services');
      await expect(table).toContainText('Consulting');

      await page.click('#qbo-service-mappings-actions-mapping-001');
      await page.click('#edit-qbo-item-mapping-menu-item-mapping-001');

      const editItemSelect = page.locator('button[aria-label="Select QuickBooks Item..."]');
      await editItemSelect.click();
      await page.getByRole('option', { name: 'Consulting - Premium', exact: true }).click();
      await page.click('#qbo-item-mapping-dialog-save-button');

      await expect(table).toContainText('Consulting - Premium');

      await page.click('#qbo-service-mappings-actions-mapping-001');
      await page.click('#delete-qbo-item-mapping-menu-item-mapping-001');
      const confirmButton = page.locator('#confirm-delete-qbo-item-mapping-dialog-mapping-001-confirm');
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      await expect(table).toContainText('No mappings found.');

      const xeroCard = page.locator('#xero-mapping-card');
      await expect(xeroCard).toBeVisible();
      await expect(xeroCard.locator('#xero-connection-select')).toHaveValue('xero-conn-1');
      const xeroItemTable = xeroCard.locator('#xero-item-mappings-table');
      await expect(xeroItemTable).toBeVisible();
      await expect(xeroItemTable).toContainText('No mappings found.');

      const xeroItemAddButton = xeroCard.locator('#add-xero-item-mapping-button');
      await xeroItemAddButton.waitFor({ state: 'visible' });
      await xeroItemAddButton.scrollIntoViewIfNeeded();
      await xeroItemAddButton.click();
      const xeroItemDialog = page.locator('[data-automation-id="xero-item-mapping-dialog-dialog"]');
      await expect(xeroItemDialog).toBeVisible();
      await page.locator('button[aria-label="Select Alga Service..."]').last().click();
      await page.getByRole('option', { name: 'Xero Managed Support', exact: true }).click();
      await page.locator('button[aria-label="Select Xero Item..."]').last().click();
      await page.getByRole('option', { name: 'Support Plan (Xero)', exact: true }).click();
      await page.click('#xero-item-mapping-dialog-save-button');

      await expect(xeroItemTable).toContainText('Xero Managed Support');
      await expect(xeroItemTable).toContainText('Support Plan (Xero)');

      await page.click('#xero-service-mappings-actions-xero-map-001');
      await page.click('#edit-xero-item-mapping-menu-item-xero-map-001');
      const xeroItemEditDialog = page.locator('[data-automation-id="xero-item-mapping-dialog-dialog"]');
      await expect(xeroItemEditDialog).toBeVisible();
      await page.locator('button[aria-label="Select Xero Item..."]').last().click();
      await page.getByRole('option', { name: 'Remote Services (Xero)', exact: true }).click();
      await page.click('#xero-item-mapping-dialog-save-button');

      await expect(xeroItemTable).toContainText('Remote Services (Xero)');

      await page.click('#xero-service-mappings-actions-xero-map-001');
      await page.click('#delete-xero-item-mapping-menu-item-xero-map-001');
      await page.click('#confirm-delete-xero-item-mapping-dialog-xero-map-001-confirm');
      await expect(xeroItemTable).toContainText('No mappings found.');

      await xeroCard.getByRole('tab', { name: 'Tax Rates' }).click();
      const xeroTaxTable = xeroCard.locator('#xero-taxrate-mappings-table');
      await expect(xeroTaxTable).toBeVisible();
      await expect(xeroTaxTable).toContainText('No mappings found.');

      const xeroTaxAddButton = xeroCard.locator('#add-xero-taxrate-mapping-button');
      await xeroTaxAddButton.waitFor({ state: 'visible' });
      await xeroTaxAddButton.scrollIntoViewIfNeeded();
      await xeroTaxAddButton.click();
      const xeroTaxDialog = page.locator('[data-automation-id="xero-taxrate-mapping-dialog-dialog"]');
      await expect(xeroTaxDialog).toBeVisible();
      await page.locator('button[aria-label="Select Alga Tax Region..."]').last().click();
      await page.getByRole('option', { name: 'Australia NSW', exact: true }).click();
      await page.locator('button[aria-label="Select Xero Tax Rate..."]').last().click();
      await page.getByRole('option', { name: 'GST on Income', exact: true }).click();
      await page.click('#xero-taxrate-mapping-dialog-save-button');

      await expect(xeroTaxTable).toContainText('GST on Income');

      await page.click('#xero-tax-rate-mappings-actions-xero-tax-001');
      await page.click('#delete-xero-taxrate-mapping-menu-item-xero-tax-001');
      await page.click('#confirm-delete-xero-taxrate-mapping-dialog-xero-tax-001-confirm');

      await expect(xeroTaxTable).toContainText('No mappings found.');
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
