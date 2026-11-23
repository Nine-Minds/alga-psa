import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, prepareTenantForPlaywright } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

// T017 (S1, alga0002339): /msp/schedule?entryId= opens the schedule on the entry's date with the entry open.
// Signs in through the real login form: the app requires a tracked session row behind every session JWT,
// so a cookie minted by the test (createTenantAndLogin) is rejected.
test.describe('Schedule entry deep link', () => {
  test('?entryId= opens the entry on a date far from today, and a missing entry still loads the page', async ({ page }) => {
    test.setTimeout(180_000);

    const db = createTestDbConnection();
    let tenantId: string | undefined;

    try {
      const tenantData = await createTestTenant(db, { companyName: `Deep link ${uuidv4().slice(0, 6)}` });
      tenantId = tenantData.tenant.tenantId;
      await prepareTenantForPlaywright(db, tenantId, {
        completeOnboarding: true,
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'user_schedule', action: 'read' },
              { resource: 'user_schedule', action: 'update' },
            ],
          },
        ],
      });
      const userId = tenantData.adminUser.userId;

      await page.goto(`${BASE_URL}/auth/msp/signin`);
      await page.fill('#msp-email-field', tenantData.adminUser.email);
      await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);
      await Promise.all([
        page.waitForURL((url) => url.pathname.startsWith('/msp/'), { timeout: 60_000 }),
        page.click('#msp-sign-in-button'),
      ]);

      // A date well away from "today" proves the calendar moved: the default view would not contain it.
      const start = new Date('2031-03-10T15:00:00.000Z');
      const end = new Date('2031-03-10T16:00:00.000Z');
      const entryId = uuidv4();
      const title = `Deep link entry ${uuidv4().slice(0, 6)}`;

      await db('schedule_entries').insert({
        tenant: tenantId,
        entry_id: entryId,
        title,
        notes: '',
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        work_item_id: null,
        scheduled_start: start,
        scheduled_end: end,
        is_private: false,
        is_recurring: false,
      });
      await db('schedule_entry_assignees').insert({ tenant: tenantId, entry_id: entryId, user_id: userId });

      await page.goto(`${BASE_URL}/msp/schedule?entryId=${entryId}`, { waitUntil: 'networkidle' });

      // The entry dialog (EntryPopup) opens with the entry loaded.
      await expect(page.locator('#title')).toHaveValue(title);
      await expect(page.locator('#scheduled_start')).toBeVisible();

      // Close it; the calendar underneath is on the entry's week, not today's.
      await page.locator('#cancel-entry-btn').click();
      await expect(page.locator('#title')).toHaveCount(0);
      await expect(page.getByText(title).first()).toBeVisible();

      // A deleted/unknown entry: the page still loads normally and nothing is left open.
      await page.goto(`${BASE_URL}/msp/schedule?entryId=${uuidv4()}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
      // The user is told why, the calendar finishes loading, and no entry dialog opens.
      await expect(page.getByText('That schedule entry could not be opened.', { exact: false })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Loading schedule...')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator('#title')).toHaveCount(0);
    } finally {
      if (tenantId) {
        await db('schedule_entry_assignees').where({ tenant: tenantId }).del().catch(() => undefined);
        await db('schedule_entries').where({ tenant: tenantId }).del().catch(() => undefined);
        // The real sign-in tracks a session row that rollbackTenant does not know about.
        await db('sessions').where({ tenant: tenantId }).del().catch(() => undefined);
        await db('user_preferences').where({ tenant: tenantId }).del().catch(() => undefined);
        // Best effort: rollbackTenant does not know every table a signed-in user touches (e.g. user_preferences).
        await rollbackTenant(db, tenantId).catch((error: Error) =>
          console.warn(`[T017] tenant ${tenantId} cleanup incomplete: ${error.message}`),
        );
      }
      await db.destroy().catch(() => undefined);
    }
  });
});
