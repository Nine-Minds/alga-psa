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

async function setInternalSessionCookie(page: Page, user: any, baseUrl: string) {
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

  await page.context().addCookies([
    {
      name: process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token',
      value: token,
      url: baseUrl,
      httpOnly: true,
      secure: baseUrl.startsWith('https://'),
      sameSite: 'Lax',
    },
  ]);
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

    await setInternalSessionCookie(page, internalUser, BASE_URL);

    try {
      await page.addInitScript(({ mocks }) => {
        const store = {
          status: mocks.connectionStatus,
          services: mocks.services,
          items: mocks.items,
          mappings: (mocks.initialMappings || []).map((mapping) => {
            const base = {
              created_at: mapping.created_at ?? new Date().toISOString(),
              updated_at: mapping.updated_at ?? new Date().toISOString(),
              ...mapping,
            };
            return {
              ...base,
              algaEntityName:
                mocks.services.find((svc) => svc.service_id === base.alga_entity_id)?.service_name ?? base.alga_entity_id,
              externalEntityName:
                mocks.items.find((item) => item.id === base.external_entity_id)?.name ?? base.external_entity_id,
            };
          }),
          nextSequence: (mocks.initialMappings?.length || 0) + 1,
        };

        const buildDisplayMapping = (entry) => {
          const merged = {
            ...entry,
            algaEntityName:
              store.services.find((svc) => svc.service_id === entry.alga_entity_id)?.service_name ?? entry.alga_entity_id,
            externalEntityName:
              store.items.find((item) => item.id === entry.external_entity_id)?.name ?? entry.external_entity_id,
          };
          return merged;
        };

        window.__ALGA_PLAYWRIGHT_QBO__ = {
          connectionStatus: store.status,
          itemMappingOverrides: {
            loadData: async () => ({
              mappings: store.mappings.map((mapping) => ({ ...mapping })),
              services: [...store.services],
              items: [...store.items],
            }),
            createMapping: async (data) => {
              const timestamp = new Date().toISOString();
              const mapping = buildDisplayMapping({
                ...data,
                id: `mapping-${String(store.nextSequence++).padStart(3, '0')}`,
                created_at: timestamp,
                updated_at: timestamp,
              });
              store.mappings.push(mapping);
              return mapping;
            },
            updateMapping: async (mappingId, updates) => {
              const index = store.mappings.findIndex((mapping) => mapping.id === mappingId);
              if (index === -1) {
                return null;
              }
              const next = buildDisplayMapping({
                ...store.mappings[index],
                ...updates,
                updated_at: new Date().toISOString(),
              });
              store.mappings[index] = next;
              return next;
            },
            deleteMapping: async (mappingId) => {
              store.mappings = store.mappings.filter((mapping) => mapping.id !== mappingId);
            },
          },
        };
      },
      {
        mocks: {
          connectionStatus: {
            connected: true,
            status: 'Connected',
            clientName: 'Acme MSP',
            realmId: 'realm-playwright',
          },
          services: [
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
          items: [
            { id: 'qbo-item-consulting', name: 'Consulting' },
            { id: 'qbo-item-consulting-premium', name: 'Consulting - Premium' },
            { id: 'qbo-item-managed-services', name: 'Managed Services Bundle' },
          ],
          initialMappings: [],
        },
      });

      await page.goto(`${BASE_URL}/msp/settings`, {
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
      await expect(table.getByRole('row', { name: /Managed Services/ })).toContainText('Consulting');

      await page.click('#qbo-item-mapping-actions-menu-mapping-001');
      await page.click('#edit-qbo-item-mapping-menu-item-mapping-001');

      const editItemSelect = page.locator('button[aria-label="Select QuickBooks Item..."]');
      await editItemSelect.click();
      await page.getByRole('option', { name: 'Consulting - Premium', exact: true }).click();
      await page.click('#qbo-item-mapping-dialog-save-button');

      await expect(table.getByRole('row', { name: /Managed Services/ })).toContainText('Consulting - Premium');

      await page.click('#qbo-item-mapping-actions-menu-mapping-001');
      await page.click('#delete-qbo-item-mapping-menu-item-mapping-001');
      const confirmButton = page.locator('#confirm-delete-qbo-item-mapping-dialog-mapping-001-confirm');
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      await expect(table).toContainText('No item mappings found.');
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
