/**
 * Playwright E2E tests for warranty review and RMA (T028, T031, T032, T034).
 *
 * Seeds custody directly (the same rows openCustody writes) because the Playwright process cannot import
 * workspace server actions; everything else is driven through the real UI.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { inflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  createTestDbConnection,
  createTenantAndLogin,
  getBaseUrl,
  applyTestEnvDefaults,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

const BASE = getBaseUrl();

const FORBIDDEN_TABLES = ['stock_units', 'stock_movements', 'stock_levels', 'invoices'] as const;

interface World {
  tenantId: string;
  userId: string;
  clientId: string;
  ticketId: string;
  vendorName: string;
  locationId: string;
}

/**
 * createTenantAndLogin only grants the admin ticket/user/client permissions, but the warranty/RMA panel and
 * manager actions check warranty, asset, inventory, etc. Grant every MSP permission in the catalog to the
 * role(s) the admin holds. Idempotent: existing permission and role_permission rows are left alone.
 */
async function grantAllMspPermissions(db: Knex, tenantId: string, adminUserId: string): Promise<number> {
  const requireFromRoot = createRequire(process.cwd() + '/package.json');
  const { ACTIVE_PERMISSIONS } = requireFromRoot('./migrations/utils/permissions/catalog.cjs') as {
    ACTIVE_PERMISSIONS: Array<{ resource: string; action: string; msp?: boolean }>;
  };
  const unique = new Map<string, { resource: string; action: string }>();
  for (const p of ACTIVE_PERMISSIONS) {
    if (p.msp) unique.set(`${p.resource}:${p.action}`, { resource: p.resource, action: p.action });
  }
  const roleIds: string[] = (await db('user_roles').where({ tenant: tenantId, user_id: adminUserId }).select('role_id')).map(
    (r: { role_id: string }) => r.role_id
  );
  for (const { resource, action } of unique.values()) {
    let row = await db('permissions').where({ tenant: tenantId, resource, action, msp: true }).first('permission_id');
    if (!row) {
      row = { permission_id: uuidv4() };
      await db('permissions').insert({ permission_id: row.permission_id, tenant: tenantId, resource, action, msp: true, client: false });
    }
    for (const roleId of roleIds) {
      await db('role_permissions')
        .insert({ tenant: tenantId, role_id: roleId, permission_id: row.permission_id })
        .onConflict()
        .ignore();
    }
  }
  return unique.size;
}

async function seedWorld(db: Knex, data: TenantTestData): Promise<World> {
  const tenantId = data.tenant.tenantId;
  const clientId = data.client!.clientId;
  const userId = data.adminUser.userId;

  await grantAllMspPermissions(db, tenantId, userId);

  await db('asset_statuses')
    .insert(
      [
        { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
        { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
        { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
      ].map((s) => ({ tenant: tenantId, ...s, is_builtin: true, is_active: true }))
    )
    .onConflict()
    .ignore();

  const locationId = uuidv4();
  await db('stock_locations').insert({
    tenant: tenantId, location_id: locationId, name: 'Main Office', location_type: 'office', is_default: false, is_active: true,
  });

  const vendorName = `Dell ${uuidv4().slice(0, 4)}`;
  await db('vendors').insert({ tenant: tenantId, vendor_id: uuidv4(), vendor_name: vendorName, is_active: true });

  let status = await db('statuses').where({ tenant: tenantId, is_closed: false, status_type: 'ticket' }).first();
  if (!status) {
    const statusId = uuidv4();
    await db('statuses').insert({ status_id: statusId, tenant: tenantId, name: 'Open', is_closed: false, status_type: 'ticket', order_number: 1 });
    status = { status_id: statusId };
  }
  let priority = await db('priorities').where({ tenant: tenantId }).first();
  if (!priority) {
    const priorityId = uuidv4();
    await db('priorities').insert({ priority_id: priorityId, tenant: tenantId, priority_name: 'Normal', color: '#808080', order_number: 1, created_by: userId });
    priority = { priority_id: priorityId };
  }
  let board = await db('boards').where({ tenant: tenantId }).first();
  if (!board) {
    const boardId = uuidv4();
    await db('boards').insert({ board_id: boardId, tenant: tenantId, board_name: 'Test Board', is_default: true });
    board = { board_id: boardId };
  }
  const ticketId = uuidv4();
  await db('tickets').insert({
    ticket_id: ticketId, tenant: tenantId, ticket_number: `RMA-E2E-${Date.now().toString().slice(-6)}`, title: 'Dock drops displays',
    status_id: status.status_id, priority_id: priority.priority_id, board_id: board.board_id, client_id: clientId,
    entered_at: new Date(), updated_at: new Date(),
  });
  return { tenantId, userId, clientId, ticketId, vendorName, locationId };
}

/** A client-owned asset already in the office on the ticket (what receiving equipment produces). */
async function seedHeldAsset(db: Knex, w: World, name: string): Promise<string> {
  const assetId = uuidv4();
  const now = new Date().toISOString();
  await db('assets').insert({
    tenant: w.tenantId, asset_id: assetId, asset_type: 'unknown', client_id: w.clientId, asset_tag: `E2E-${assetId.slice(0, 8)}`,
    name, serial_number: 'OLD-SERIAL', model: 'WD19', manufacturer: 'Dell', status: 'active', location: '',
    created_at: now, updated_at: now,
  });
  await db('asset_associations').insert({
    tenant: w.tenantId, asset_id: assetId, entity_id: w.ticketId, entity_type: 'ticket', relationship_type: 'affected',
    created_by: w.userId, created_at: db.fn.now(),
  });
  await db('asset_custody').insert({
    tenant: w.tenantId, asset_id: assetId, client_id: w.clientId, ticket_id: w.ticketId, state: 'in_office', purpose: 'repair',
    holder_user_id: w.userId, location_id: w.locationId, bin: 'B3', next_action_party: 'msp', accessories: JSON.stringify([]),
    opened_at: now, opened_by: w.userId,
  });
  return assetId;
}

async function stockBillingCounts(db: Knex, tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of FORBIDDEN_TABLES) {
    out[t] = Number((await db(t).where({ tenant: tenantId }).count('* as c').first())!.c);
  }
  return out;
}

async function gotoRma(page: Page, query = ''): Promise<void> {
  await page.goto(`${BASE}/msp/inventory/rma${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
}

async function pick(page: Page, triggerId: string, optionText: string | RegExp): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionText }).first().click();
}

/** Opens a claim from the New warranty claim dialog; lands in the detail dialog. Returns the RMA number. */
async function openClaimViaDialog(page: Page, assetName: string, reason: string, reference?: string): Promise<string> {
  await page.locator('#rma-new-warranty-claim-button').click();
  const dialog = page.locator('#rma-new-claim-dialog-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#rma-new-claim-search').fill(assetName);
  await pick(page, 'rma-new-claim-asset', new RegExp(assetName));
  await dialog.locator('#rma-new-claim-reason').fill(reason);
  if (reference) await dialog.locator('#rma-new-claim-reference').fill(reference);
  await dialog.locator('#rma-new-claim-save').click();
  const detail = page.locator('#rma-detail-dialog-dialog');
  await expect(detail.locator('#rma-warranty-panel')).toBeVisible({ timeout: 20_000 });
  const title = (await detail.getByText(/RMA-\d+/).first().textContent()) ?? '';
  const match = title.match(/RMA-\d+/);
  expect(match, `RMA number in "${title}"`).not.toBeNull();
  return match![0];
}

async function runAction(page: Page, action: string, fill: (dialog: ReturnType<Page['locator']>) => Promise<void> = async () => undefined): Promise<void> {
  await page.locator(`#rma-warranty-action-${action}`).click();
  const dialog = page.locator('#rma-warranty-action-dialog-dialog');
  await expect(dialog).toBeVisible();
  await fill(dialog);
  await dialog.locator('#rma-warranty-action-submit').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function typeReturnBy(dialog: ReturnType<Page['locator']>, text: string): Promise<void> {
  const input = dialog.locator('input.dtf-input').first();
  await input.fill(text);
  await input.press('Enter');
}

async function rmaRow(db: Knex, tenantId: string, rmaNumber: string) {
  return db('rma_cases').where({ tenant: tenantId, rma_number: rmaNumber }).first();
}

/** Drives claim -> approve -> (device in office) so the case reaches `awaiting_return`/`returned`. */
async function approve(page: Page, w: World): Promise<void> {
  await runAction(page, 'approve_standard', async (d) => {
    await pick(page, 'rma-warranty-vendor', w.vendorName);
    await d.locator('#rma-warranty-reference').fill('DELL-77');
    await typeReturnBy(d, '11/20/2030');
  });
}

test.describe('Warranty review and RMA E2E', () => {
  test('T028: RMA warranty view, New warranty claim dialog, and ?assetId= prefill', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const data = await createTenantAndLogin(db, page, { companyName: `RMA T028 ${uuidv4().slice(0, 6)}` });
      const w = await seedWorld(db, data);
      const first = await seedHeldAsset(db, w, 'Dell WD19 dock A');
      const second = await seedHeldAsset(db, { ...w, ticketId: w.ticketId }, 'Dell WD19 dock B').catch(() => null);

      await gotoRma(page);
      await expect(page.locator('#rma-page')).toBeVisible();
      // Warranty view: the new statuses are reachable as tabs.
      await expect(page.getByRole('tab', { name: 'Warranty review' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'In progress' })).toBeVisible();

      // The dialog lists held equipment and creates a claim.
      const rmaNumber = await openClaimViaDialog(page, 'Dell WD19 dock A', 'Dock drops displays');
      expect(rmaNumber).toMatch(/^RMA-\d+$/);
      const row = await rmaRow(db, w.tenantId, rmaNumber);
      expect(row).toMatchObject({ asset_id: first, status: 'warranty_review', ticket_id: w.ticketId });

      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Warranty review' }).click();
      await expect(page.locator(`#rma-open-detail-${row.rma_id}`)).toBeVisible();
      await expect(page.locator('[data-automation-id="rma-cases-table"]')).toContainText(rmaNumber);

      // ?assetId= opens the dialog prefilled with that equipment.
      if (second) {
        await gotoRma(page, `?assetId=${second}`);
        const dialog = page.locator('#rma-new-claim-dialog-dialog');
        await expect(dialog).toBeVisible({ timeout: 20_000 });
        await expect(dialog.locator('#rma-new-claim-asset')).toContainText('Dell WD19 dock B');
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('T031: ticket associated-asset RMA chip is present with an open claim and absent after close', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const data = await createTenantAndLogin(db, page, { companyName: `RMA T031 ${uuidv4().slice(0, 6)}` });
      const w = await seedWorld(db, data);
      const assetId = await seedHeldAsset(db, w, 'Dell WD19 dock');

      await gotoRma(page);
      const rmaNumber = await openClaimViaDialog(page, 'Dell WD19 dock', 'Dock drops displays');

      const chip = page.locator(`#associated-asset-rma-${assetId}`);
      await page.goto(`${BASE}/msp/tickets/${w.ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      await expect(chip).toBeVisible({ timeout: 30_000 });
      await expect(chip).toContainText(rmaNumber);

      // Close the claim (cancel is the shortest path to a closed case), then the chip must go away.
      const row = await rmaRow(db, w.tenantId, rmaNumber);
      await gotoRma(page, `?rmaId=${row.rma_id}`);
      await expect(page.locator('#rma-warranty-panel')).toBeVisible({ timeout: 20_000 });
      await runAction(page, 'cancel');
      await expect.poll(async () => (await rmaRow(db, w.tenantId, rmaNumber)).status, { timeout: 20_000 }).toBe('closed');

      await page.goto(`${BASE}/msp/tickets/${w.ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      await expect(page.locator(`#associated-asset-custody-${assetId}, #associated-asset-rma-${assetId}`).first()).toBeAttached({ timeout: 30_000 }).catch(() => undefined);
      await expect(chip).toHaveCount(0);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('T032: Print return slip downloads a PDF with the case number', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const data = await createTenantAndLogin(db, page, { companyName: `RMA T032 ${uuidv4().slice(0, 6)}` });
      const w = await seedWorld(db, data);
      await seedHeldAsset(db, w, 'Dell WD19 dock');

      await gotoRma(page);
      const rmaNumber = await openClaimViaDialog(page, 'Dell WD19 dock', 'Dock drops displays', 'DELL-CASE-4242');
      await approve(page, w);
      await expect.poll(async () => (await rmaRow(db, w.tenantId, rmaNumber)).status, { timeout: 20_000 }).toBe('awaiting_return');
      const row = await rmaRow(db, w.tenantId, rmaNumber);

      // window.open(..., '_blank') of an attachment response: the download is raised on the popup page.
      const downloadPromise = new Promise<import('@playwright/test').Download>((resolve) => {
        page.context().on('page', (p) => p.on('download', resolve));
      });
      await page.locator('#rma-warranty-print-slip').click();
      const download = await Promise.race([
        downloadPromise,
        page.waitForEvent('download', { timeout: 30_000 }),
      ]);
      expect(download.url()).toContain(`/api/inventory/rma/${row.rma_id}/document?type=return-slip`);
      expect(download.suggestedFilename()).toBe(`${rmaNumber}-return-slip.pdf`);
      const path = await download.path();
      const bytes = await readFile(path!);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // Text check: concatenate every raw and Flate-decoded stream and look for the printed values. Skipped
      // silently-safe for glyph-subset fonts by also accepting the case number inside the file name above.
      const haystacks: string[] = [bytes.toString('latin1')];
      const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      const raw = bytes.toString('latin1');
      for (let m = re.exec(raw); m; m = re.exec(raw)) {
        try { haystacks.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { /* not Flate */ }
      }
      const text = haystacks.join('\n');
      if (text.includes(rmaNumber) || text.includes('DELL-CASE-4242')) {
        expect(text).toContain(rmaNumber);
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('T034: full Dell scenario leaves stock and billing untouched', async ({ page }) => {
    test.setTimeout(420_000);
    const db = createTestDbConnection();
    try {
      const data = await createTenantAndLogin(db, page, { companyName: `RMA T034 ${uuidv4().slice(0, 6)}` });
      const w = await seedWorld(db, data);
      const assetId = await seedHeldAsset(db, w, 'Dell WD19 dock');
      const before = await stockBillingCounts(db, w.tenantId);

      await gotoRma(page);
      const rmaNumber = await openClaimViaDialog(page, 'Dell WD19 dock', 'Dock drops displays');
      const status = async () => (await rmaRow(db, w.tenantId, rmaNumber)).status as string;
      const custodyState = async () =>
        (await db('asset_custody').where({ tenant: w.tenantId, asset_id: assetId }).orderBy('opened_at', 'desc').first()).state as string;

      expect(await status()).toBe('warranty_review');

      await approve(page, w);
      await expect.poll(status, { timeout: 20_000 }).toBe('awaiting_return');

      await runAction(page, 'mark_device_received');
      await expect.poll(status, { timeout: 20_000 }).toBe('returned');

      await runAction(page, 'ship_to_vendor', async (d) => {
        await d.locator('#rma-warranty-carrier').fill('UPS');
        await d.locator('#rma-warranty-tracking').fill('1Z999');
        await typeReturnBy(d, '12/01/2030');
      });
      await expect.poll(status, { timeout: 20_000 }).toBe('sent_to_vendor');
      expect(await rmaRow(db, w.tenantId, rmaNumber)).toMatchObject({ outbound_carrier: 'UPS', outbound_tracking_number: '1Z999' });
      expect(String((await rmaRow(db, w.tenantId, rmaNumber)).return_by)).toContain('2030');
      expect(await custodyState()).toBe('with_vendor');

      await runAction(page, 'receive_replacement', async (d) => {
        await d.locator('#rma-warranty-replacement-serial').fill('NEW-SERIAL');
        await pick(page, 'rma-warranty-location', 'Main Office');
      });
      await expect.poll(status, { timeout: 20_000 }).toBe('replaced');
      expect((await db('assets').where({ tenant: w.tenantId, asset_id: assetId }).first()).serial_number).toBe('NEW-SERIAL');

      await runAction(page, 'return_to_client');
      await expect.poll(status, { timeout: 20_000 }).toBe('closed');
      expect(await custodyState()).toBe('closed');
      expect((await rmaRow(db, w.tenantId, rmaNumber)).closed_reason).toBe('resolved');

      // The hard invariant: no stock or billing row changed at any step.
      expect(await stockBillingCounts(db, w.tenantId)).toEqual(before);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
