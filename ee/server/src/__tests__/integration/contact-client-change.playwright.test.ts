import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

/**
 * alga0002338: a contact on the inbound-triage client could not be moved to
 * another client, because the client page's Contacts tab fed the edit form a
 * client list containing only the client being viewed. Each case below moves
 * the contact to "Life Landscaping" from a different surface and checks
 * contacts.client_id in the database.
 */

const CONTACT_NAME = 'Brian Linscott';

type Seeded = {
  tenantId: string;
  triageClientId: string;
  lifeClientId: string;
  contactId: string;
};

async function seedTriageContact(db: Knex, page: Page): Promise<Seeded> {
  const tenantData = await createTenantAndLogin(db, page, {
    completeOnboarding: true,
    sessionOptions: { baseUrl: BASE_URL },
    permissions: [
      {
        roleName: 'Admin',
        permissions: [
          { resource: 'client', action: 'read' },
          { resource: 'client', action: 'update' },
          { resource: 'contact', action: 'read' },
          { resource: 'contact', action: 'update' },
        ],
      },
    ],
  });
  const tenantId = tenantData.tenant.tenantId;

  const triageClientId = uuidv4();
  const lifeClientId = uuidv4();
  for (const [clientId, clientName] of [
    [triageClientId, 'Unmatched Email'],
    [lifeClientId, 'Life Landscaping'],
  ]) {
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: clientName,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  // "Unmatched Email" is the inbound triage client: the default client of the
  // tenant's inbound ticket defaults. It is an ordinary clients row.
  await db('inbound_ticket_defaults').insert({
    id: uuidv4(),
    tenant: tenantId,
    short_name: `pw-triage-${uuidv4().slice(0, 8)}`,
    display_name: 'Playwright Triage Defaults',
    client_id: triageClientId,
    is_active: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // Same row the ticket's Quick Add Contact would create for a ticket on the triage client.
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: CONTACT_NAME,
    email: `brian-${uuidv4().slice(0, 6)}@example.com`,
    client_id: triageClientId,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { tenantId, triageClientId, lifeClientId, contactId };
}

/** Pick Life Landscaping in the open edit form (whose id prefix is `formId`), save, and wait for the drawer to finish. */
async function moveToLifeLandscapingAndSave(page: Page, formId: string, lifeClientId: string) {
  const trigger = page.locator(`#${formId}-client-picker-trigger`);
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText('Unmatched Email');
  await trigger.click();

  const option = page.locator(`#${formId}-client-picker-option-${lifeClientId}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(trigger).toContainText('Life Landscaping');

  await page.locator(`#${formId}-save-button`).click();
  await expect(page.locator(`#${formId}-save-button`)).toBeHidden();
}

async function expectContactClient(db: Knex, seeded: Seeded, expectedClientId: string) {
  await expect
    .poll(async () => {
      const row = await db('contacts')
        .select('client_id')
        .where({ tenant: seeded.tenantId, contact_name_id: seeded.contactId })
        .first<{ client_id: string | null }>();
      return row?.client_id ?? null;
    })
    .toBe(expectedClientId);
}

test.describe('Contact client change', () => {
  test('(a) Contacts tab row menu → Edit lists every client and moves the contact', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();

    try {
      const seeded = await seedTriageContact(db, page);

      await page.goto(`${BASE_URL}/msp/clients/${seeded.triageClientId}?tab=contacts`, { waitUntil: 'networkidle' });
      const list = page.locator('#client-contacts-list');
      await expect(list.getByText(CONTACT_NAME, { exact: true })).toBeVisible();

      await list.locator('#client-contacts-actions-menu').first().click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();

      await moveToLifeLandscapingAndSave(page, 'client-contact-edit', seeded.lifeClientId);

      await expectContactClient(db, seeded, seeded.lifeClientId);
      // The Contacts tab re-queries after the save, so the moved contact drops out of this client's list.
      await expect(list.getByText(CONTACT_NAME, { exact: true })).toHaveCount(0);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('(b) Contacts tab quick view → Edit contact lists every client and moves the contact', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();

    try {
      const seeded = await seedTriageContact(db, page);

      await page.goto(`${BASE_URL}/msp/clients/${seeded.triageClientId}?tab=contacts`, { waitUntil: 'networkidle' });
      const list = page.locator('#client-contacts-list');
      await list.getByText(CONTACT_NAME, { exact: true }).click();

      await page.locator('#contact-quick-view-edit-contact').click();

      await moveToLifeLandscapingAndSave(page, 'contact-quick-view-edit', seeded.lifeClientId);

      await expectContactClient(db, seeded, seeded.lifeClientId);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('(c) contact page → Edit contact lists every client and moves the contact', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();

    try {
      const seeded = await seedTriageContact(db, page);

      await page.goto(`${BASE_URL}/msp/contacts/${seeded.contactId}`, { waitUntil: 'networkidle' });
      await page.locator('#contact-bento-edit-contact').click();

      await moveToLifeLandscapingAndSave(page, 'contact-bento-edit', seeded.lifeClientId);

      await expectContactClient(db, seeded, seeded.lifeClientId);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
