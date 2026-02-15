import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

test.describe('Client Default Contact', () => {
  test('sets and persists client.properties.primary_contact_id via Client Details UI', async ({ page }) => {
    test.setTimeout(180_000);

    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'client', action: 'read' },
              { resource: 'client', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;

      const clientId = uuidv4();
      await db('clients').insert({
        tenant: tenantId,
        client_id: clientId,
        client_name: `Default Contact Client ${uuidv4().slice(0, 6)}`,
        is_inactive: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      const contactId = uuidv4();
      const contactEmail = `primary-${uuidv4().slice(0, 6)}@example.com`;
      await db('contacts').insert({
        tenant: tenantId,
        contact_name_id: contactId,
        full_name: 'Primary Contact',
        email: contactEmail,
        client_id: clientId,
        is_inactive: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      await page.goto(`${BASE_URL}/msp/clients/${clientId}`, { waitUntil: 'networkidle' });

      const defaultContactSelect = page.locator('#client-default-contact-select');
      await expect(defaultContactSelect).toBeVisible();

      // Open the select and choose the seeded contact.
      await defaultContactSelect.click();
      await page.getByText(`Primary Contact (${contactEmail})`, { exact: true }).click();

      // Persist to server.
      await page.locator('#save-client-changes-btn').click();
      await expect(page.getByText('Client details saved successfully.', { exact: true })).toBeVisible();

      // Reload to ensure persistence in the UI.
      await page.goto(`${BASE_URL}/msp/clients/${clientId}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#client-default-contact-select')).toContainText('Primary Contact');

      // Verify persistence in the database.
      const updatedClient = await db('clients')
        .select('properties')
        .where({ tenant: tenantId, client_id: clientId })
        .first<any>();
      expect(updatedClient).toBeDefined();
      expect(updatedClient.properties?.primary_contact_id).toBe(contactId);
      expect(updatedClient.properties?.primary_contact_name).toBe('Primary Contact');
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('clears client.properties.primary_contact_id via Client Details UI', async ({ page }) => {
    test.setTimeout(180_000);

    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'client', action: 'read' },
              { resource: 'client', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;

      const clientId = uuidv4();
      await db('clients').insert({
        tenant: tenantId,
        client_id: clientId,
        client_name: `Clear Default Contact Client ${uuidv4().slice(0, 6)}`,
        is_inactive: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      const contactId = uuidv4();
      const contactEmail = `primary-${uuidv4().slice(0, 6)}@example.com`;
      await db('contacts').insert({
        tenant: tenantId,
        contact_name_id: contactId,
        full_name: 'Primary Contact',
        email: contactEmail,
        client_id: clientId,
        is_inactive: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      await page.goto(`${BASE_URL}/msp/clients/${clientId}`, { waitUntil: 'networkidle' });

      const defaultContactSelect = page.locator('#client-default-contact-select');
      await expect(defaultContactSelect).toBeVisible();

      await defaultContactSelect.click();
      await page.getByText(`Primary Contact (${contactEmail})`, { exact: true }).click();

      await page.locator('#save-client-changes-btn').click();
      await expect(page.getByText('Client details saved successfully.', { exact: true })).toBeVisible();

      // Clear by selecting the explicit "None" option.
      await defaultContactSelect.click();
      await page.getByText('None', { exact: true }).click();

      await page.locator('#save-client-changes-btn').click();
      await expect(page.getByText('Client details saved successfully.', { exact: true })).toBeVisible();

      await page.goto(`${BASE_URL}/msp/clients/${clientId}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#client-default-contact-select')).toContainText('None');

      const updatedClient = await db('clients')
        .select('properties')
        .where({ tenant: tenantId, client_id: clientId })
        .first<any>();
      expect(updatedClient).toBeDefined();
      expect(updatedClient.properties?.primary_contact_id ?? null).toBe('');
      expect(updatedClient.properties?.primary_contact_name ?? null).toBe('');
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
