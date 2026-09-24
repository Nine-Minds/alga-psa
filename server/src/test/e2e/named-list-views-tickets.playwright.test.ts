/**
 * Real-router regression test for the named-ticket-view `?view=` stale-URL race.
 *
 * The unit harness in `packages/list-views` emulates Next's history patch with
 * jsdom and cannot reproduce the action-queue ordering, so it cannot catch this
 * defect. This test drives the actual Next router: apply view A, B, C in a loop,
 * and after each apply watch `location.search` for three seconds. A late
 * `HistoryUpdater` rewrite (Next re-canonicalising a stale URL after the
 * `fetchTickets` server action settles) shows up as a mismatch inside that
 * window. It then reloads to prove the applied view survives.
 *
 * The three views are seeded directly: this test is about the URL write, and
 * seeding avoids depending on the save dialog.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  applyTestEnvDefaults,
  createTestDbConnection,
  createTenantAndLogin,
  getBaseUrl,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

const BASE_URL = getBaseUrl();

const APPLY_CYCLES = 30;
const POST_APPLY_WATCH_MS = 3_000;
const POLL_INTERVAL_MS = 50;
const PICKER_ID = 'tickets-view-picker';

type SeededView = {
  viewId: string;
  name: string;
  /** Distinctive filter the URL must carry when the view is applied. */
  param: [string, string];
};

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function seedViews(db: Knex, tenantId: string, userId: string): Promise<SeededView[]> {
  const definitions = [
    { name: 'Race A', settings: { filters: { bundleView: 'individual' } }, param: ['bundleView', 'individual'] as [string, string] },
    { name: 'Race B', settings: { filters: { boardFilterState: 'all' } }, param: ['boardFilterState', 'all'] as [string, string] },
    { name: 'Race C', settings: { filters: { dueDateFilter: 'overdue' } }, param: ['dueDateFilter', 'overdue'] as [string, string] },
  ];

  const seeded: SeededView[] = [];
  for (const definition of definitions) {
    const viewId = uuidv4();
    await tenantTable(db, tenantId, 'list_views').insert({
      view_id: viewId,
      tenant: tenantId,
      list_key: 'tickets',
      name: `${definition.name} ${viewId.slice(0, 4)}`,
      owner_user_id: userId,
      visibility: 'private',
      settings: JSON.stringify(definition.settings),
      schema_version: 1,
    });
    seeded.push({
      viewId,
      name: `${definition.name} ${viewId.slice(0, 4)}`,
      param: definition.param,
    });
  }
  return seeded;
}

async function readViewParam(page: Page): Promise<string | null> {
  return page.evaluate(() => new URLSearchParams(window.location.search).get('view'));
}

async function applyAndWatch(
  page: Page,
  view: SeededView,
  triggerText: string,
): Promise<void> {
  await page.locator(`#${PICKER_ID}-trigger`).click();
  const applyButton = page.locator(
    `#${PICKER_ID}-apply-mine-view-button[data-view-id="${view.viewId}"]`,
  );
  await expect(applyButton).toBeVisible({ timeout: 15_000 });
  await applyButton.click();

  // The write can trail the click by a beat; wait for it to name the view first.
  await page.waitForFunction(
    (viewId) => new URLSearchParams(window.location.search).get('view') === viewId,
    view.viewId,
    { timeout: 10_000 },
  );

  // Now hold still: the defect rewrites the URL 100–450 ms after the apply.
  const deadline = Date.now() + POST_APPLY_WATCH_MS;
  while (Date.now() < deadline) {
    const search = await page.evaluate(() => window.location.search);
    const params = new URLSearchParams(search);
    expect(params.get('view'), `view param after ${POST_APPLY_WATCH_MS}ms watch`).toBe(view.viewId);
    expect(params.get(view.param[0]), `${view.param[0]} while ${view.name} applied`).toBe(view.param[1]);
    expect(await readViewParam(page)).toBe(view.viewId);
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  // The picker must agree with the URL.
  await expect(page.locator(`#${PICKER_ID}-trigger`)).toContainText(triggerText);
}

test.describe('named list views on tickets under the real router', () => {
  test('T-URL: 30 view applies never let a stale URL rewrite the applied view', async ({ page }) => {
    test.setTimeout(300_000);

    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        companyName: `Named Views URL ${uuidv4().slice(0, 6)}`,
      });
      const tenantId = tenantData.tenant.tenantId;
      const userId = tenantData.adminUser.userId;
      const views = await seedViews(db, tenantId, userId);

      await page.goto(`${BASE_URL}/msp/tickets`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const trigger = page.locator(`#${PICKER_ID}-trigger`);
      await expect(trigger).toBeVisible({ timeout: 30_000 });
      await expect(trigger).toContainText('Default view');

      for (let cycle = 0; cycle < APPLY_CYCLES; cycle += 1) {
        const view = views[cycle % views.length];
        await applyAndWatch(page, view, view.name);
      }

      // A shared link / reload must reopen the view the picker shows.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`#${PICKER_ID}-trigger`)).toContainText(views[(APPLY_CYCLES - 1) % views.length].name, {
        timeout: 30_000,
      });
      expect(await readViewParam(page)).toBe(views[(APPLY_CYCLES - 1) % views.length].viewId);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
