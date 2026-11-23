import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

// T017 (S1, alga0002339): /msp/schedule?entryId= opens the schedule on the entry's date with the entry open.
// NOT YET RUN IN A BROWSER: written without a running app server; see the plan's tests.json (implemented stays false).
test.describe('Schedule entry deep link', () => {
  test('?entryId= opens the entry on a date far from today, and a missing entry still loads the page', async ({ page }) => {
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
              { resource: 'user_schedule', action: 'read' },
              { resource: 'user_schedule', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const userId = tenantData.adminUser.userId;

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
      await expect(page.locator('#title')).toHaveCount(0);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
