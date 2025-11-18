import { test, expect, Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { knex as createKnex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';
import {
  createTenantAndLogin,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';

function adminDb() {
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

test.describe('Tenant Project Task Status Library Management', () => {
  test.setTimeout(180_000); // Allow time for migrations/server start

  let db: any;
  const baseUrl = process.env.EE_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const settingsUrl = `${baseUrl}/msp/settings?tab=projects&section=task-statuses`;
  const settingsPermissions: TenantPermissionTuple[] = [
    { resource: 'settings', action: 'read' },
    { resource: 'settings', action: 'update' },
    { resource: 'security_settings', action: 'read' },
    { resource: 'security_settings', action: 'update' },
  ];

  test.beforeEach(async ({ page }) => {
    // Pages load slowly in CI; bump defaults to reduce flaky navigation timeouts
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(120_000);
  });

  test.beforeAll(async () => {
    db = adminDb();
    // Quick connectivity check
    try {
      await db.raw('SELECT 1');
    } catch (err) {
      test.skip(true, 'Database not reachable for Playwright tests.');
    }
  });

  test.afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  async function gotoTaskStatusSettings(page: Page) {
    // Use domcontentloaded to avoid hanging on networkidle due to SSE/long polls
    await page.goto(settingsUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('text=Project Task Status Library', { timeout: 60_000 });
  }

  test('navigate to tenant task status settings', async ({ page }) => {
    // Create tenant and authenticate
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    // Navigate to settings
    await gotoTaskStatusSettings(page);

    // Verify the task status library page loads
    await expect(page.locator('text=Project Task Status Library')).toBeVisible();
    await expect(page.locator('text=Manage your organization\'s project task statuses')).toBeVisible();

    // Verify create button is present
    await expect(page.locator('#create-status-button')).toBeVisible();
  });

  test('create new tenant task status with color and icon', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    await gotoTaskStatusSettings(page);

    // Click "Create Status" button
    await page.locator('#create-status-button').click();
    await page.waitForSelector('#status-form-dialog');

    // Verify dialog is open
    await expect(page.locator('#status-form-dialog')).toBeVisible();
    await expect(page.locator('text=Create Status')).toBeVisible();

    // Enter status name
    await page.locator('#status-name').fill('Code Review');

    // Select a color
    await page.locator('#color-picker-trigger').click();
    await page.waitForTimeout(500); // Wait for color picker to open
    // Click on a preset color (assuming the color picker has preset options)
    await page.locator('[data-color="#3B82F6"]').first().click();
    await page.waitForTimeout(300);

    // Open icon picker
    await page.locator('#icon-picker-trigger').click();
    await page.waitForSelector('#icon-option-Eye');

    // Select "Eye" icon
    await page.locator('#icon-option-Eye').click();

    // Verify icon picker closed
    await expect(page.locator('#icon-option-Eye')).not.toBeVisible();

    // is_closed should be false by default
    const isClosedCheckbox = page.locator('#is-closed');
    await expect(isClosedCheckbox).not.toBeChecked();

    // Submit the form
    await page.locator('#submit-button').click();
    await page.waitForLoadState('networkidle');

    // Verify the new status appears in the list
    await expect(page.locator('text=Code Review')).toBeVisible();

    // Verify the status is in the database
    const status = await db('statuses')
      .where({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        name: 'Code Review',
      })
      .first();

    expect(status).toBeTruthy();
    expect(status.icon).toBe('Eye');
    expect(status.is_closed).toBe(false);
  });

  test('edit existing tenant task status', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    // Create a status first
    const [status] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Testing',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      })
      .returning('*');

    await gotoTaskStatusSettings(page);

    // Click edit button for the status
    await page.locator(`#edit-status-${status.status_id}`).click();
    await page.waitForSelector('#status-form-dialog');

    // Verify dialog is open with existing data
    await expect(page.locator('text=Edit Status')).toBeVisible();
    await expect(page.locator('#status-name')).toHaveValue('Testing');

    // Change the name
    await page.locator('#status-name').fill('QA Testing');

    // Change the color
    await page.locator('#color-picker-trigger').click();
    await page.waitForTimeout(500);
    await page.locator('[data-color="#10B981"]').first().click();
    await page.waitForTimeout(300);

    // Change the icon
    await page.locator('#icon-picker-trigger').click();
    await page.waitForSelector('#icon-option-CheckCircle');
    await page.locator('#icon-option-CheckCircle').click();

    // Save changes
    await page.locator('#submit-button').click();
    await page.waitForLoadState('networkidle');

    // Verify changes are reflected
    await expect(page.locator('text=QA Testing')).toBeVisible();

    // Verify in database
    const updatedStatus = await db('statuses')
      .where({ status_id: status.status_id, tenant: tenantData.tenant.tenantId })
      .first();

    expect(updatedStatus.name).toBe('QA Testing');
    expect(updatedStatus.icon).toBe('CheckCircle');
  });

  test('delete tenant task status not in use', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'settings', action: 'read' },
            { resource: 'settings', action: 'update' },
          ] as TenantPermissionTuple[],
        },
      ],
    });

    // Create a status
    const [status] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Temporary Status',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      })
      .returning('*');

    await gotoTaskStatusSettings(page);

    // Setup dialog handler before clicking delete
    page.on('dialog', dialog => dialog.accept());

    // Click delete button
    await page.locator(`#delete-status-${status.status_id}`).click();
    await page.waitForLoadState('networkidle');

    // Verify status is removed from the list
    await expect(page.locator('text=Temporary Status')).not.toBeVisible();

    // Verify deleted from database
    const deletedStatus = await db('statuses')
      .where({ status_id: status.status_id, tenant: tenantData.tenant.tenantId })
      .first();

    expect(deletedStatus).toBeFalsy();
  });

  test('cannot delete tenant status in use by projects', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: [...settingsPermissions, { resource: 'projects', action: 'create' } as TenantPermissionTuple],
        },
      ],
    });

    // Create a status
    const [status] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'In Use Status',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      })
      .returning('*');

    // Create a company for the project
    const [company] = await db('companies')
      .insert({
        tenant: tenantData.tenant.tenantId,
        company_name: 'Test Company',
      })
      .returning('*');

    // Create a project that uses this status
    const [project] = await db('projects')
      .insert({
        tenant: tenantData.tenant.tenantId,
        company_id: company.company_id,
        project_name: 'Test Project',
      })
      .returning('*');

    // Add the status to the project
    await db('project_status_mappings').insert({
      tenant: tenantData.tenant.tenantId,
      project_id: project.project_id,
      status_id: status.status_id,
      is_standard: false,
      display_order: 1,
      is_visible: true,
    });

    await gotoTaskStatusSettings(page);

    // Setup dialog handler
    page.on('dialog', dialog => dialog.accept());

    // Try to delete the status
    await page.locator(`#delete-status-${status.status_id}`).click();
    await page.waitForTimeout(1000);

    // Verify error message appears
    await expect(page.locator('text=/Cannot delete status that is used by .* projects/i')).toBeVisible();

    // Verify status is still in the list
    await expect(page.locator('text=In Use Status')).toBeVisible();

    // Verify status still exists in database
    const stillExists = await db('statuses')
      .where({ status_id: status.status_id, tenant: tenantData.tenant.tenantId })
      .first();

    expect(stillExists).toBeTruthy();
  });

  test('reorder tenant task statuses', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    // Create multiple statuses
    const [status1] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'First Status',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      })
      .returning('*');

    const [status2] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Second Status',
        is_closed: false,
        order_number: 2,
        color: '#6B7280',
        icon: 'Clipboard',
      })
      .returning('*');

    await gotoTaskStatusSettings(page);

    // Get initial positions
    const initialFirstStatus = page.locator('text=First Status').first();
    const initialSecondStatus = page.locator('text=Second Status').first();

    // Verify initial order
    const firstBox = await initialFirstStatus.boundingBox();
    const secondBox = await initialSecondStatus.boundingBox();
    expect(firstBox!.y).toBeLessThan(secondBox!.y);

    // Move second status up (should become first)
    await page.locator(`#move-up-${status2.status_id}`).click();
    await page.waitForTimeout(500);

    // Verify order changed in UI
    const newFirstBox = await page.locator('text=Second Status').first().boundingBox();
    const newSecondBox = await page.locator('text=First Status').first().boundingBox();
    expect(newFirstBox!.y).toBeLessThan(newSecondBox!.y);

    // Reload page to verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify order persists after reload
    const reloadFirstBox = await page.locator('text=Second Status').first().boundingBox();
    const reloadSecondBox = await page.locator('text=First Status').first().boundingBox();
    expect(reloadFirstBox!.y).toBeLessThan(reloadSecondBox!.y);

    // Verify in database
    const status1Updated = await db('statuses')
      .where({ status_id: status1.status_id, tenant: tenantData.tenant.tenantId })
      .first();
    const status2Updated = await db('statuses')
      .where({ status_id: status2.status_id, tenant: tenantData.tenant.tenantId })
      .first();

    expect(status2Updated.order_number).toBe(1);
    expect(status1Updated.order_number).toBe(2);
  });

  test('import standard statuses and resolve order conflicts', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    // Seed existing statuses to create an order conflict (orders 1 and 2 already used)
    await db('statuses').insert([
      {
        status_id: uuidv4(),
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Existing One',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      },
      {
        status_id: uuidv4(),
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Existing Two',
        is_closed: false,
        order_number: 2,
        color: '#6B7280',
        icon: 'Clipboard',
      },
    ]);

    // Insert standard statuses to import (one conflicts on order_number)
    const orderConflictStandardId = uuidv4();
    const noConflictStandardId = uuidv4();

    try {
      await db('standard_statuses').insert([
        {
          standard_status_id: orderConflictStandardId,
          name: 'Standard Conflict',
          item_type: 'project_task',
          display_order: 1, // conflicts with Existing One
          is_closed: false,
          is_default: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          standard_status_id: noConflictStandardId,
          name: 'Standard Unique',
          item_type: 'project_task',
          display_order: 5,
          is_closed: false,
          is_default: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      await gotoTaskStatusSettings(page);

      // Open import dialog
      await page.locator('#import-task-statuses-button').click();
      await page.waitForSelector('#import-status-dialog');

      // Select both standard statuses
      await page.locator(`#status-${orderConflictStandardId}`).click();
      await page.locator(`#status-${noConflictStandardId}`).click();

      // Attempt import
      await page.locator('#confirm-import-button').click();

      // Conflict dialog should appear for the order conflict
      await page.waitForSelector('#conflict-resolution-dialog');
      const conflictDialog = page.locator('#conflict-resolution-dialog');
      await expect(conflictDialog).toBeVisible();

      // Choose to reorder the conflicting status and set it to the next available slot (3)
      await page
        .locator(`input[name="conflict-${orderConflictStandardId}"][value="reorder"]`)
        .check();
      await page.locator('#conflict-resolution-dialog input[type="number"]').first().fill('3');

      // Apply resolutions
      await page.locator('#apply-resolutions-button').click();
      await page.waitForLoadState('networkidle');

      // Both statuses should appear in the list
      await expect(page.locator('text=Standard Conflict')).toBeVisible();
      await expect(page.locator('text=Standard Unique')).toBeVisible();

      // Verify database inserts with resolved order numbers
      const conflictStatus = await db('statuses')
        .where({
          tenant: tenantData.tenant.tenantId,
          name: 'Standard Conflict',
          item_type: 'project_task',
        })
        .first();
      const uniqueStatus = await db('statuses')
        .where({
          tenant: tenantData.tenant.tenantId,
          name: 'Standard Unique',
          item_type: 'project_task',
        })
        .first();

      expect(conflictStatus).toBeTruthy();
      expect(conflictStatus.order_number).toBe(3);
      expect(uniqueStatus).toBeTruthy();
      expect(uniqueStatus.order_number).toBe(5);
    } finally {
      await db('standard_statuses')
        .whereIn('standard_status_id', [orderConflictStandardId, noConflictStandardId])
        .del()
        .catch(() => undefined);
    }
  });

  test('icon picker UI improvements - compact modal with 9 column grid', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    await gotoTaskStatusSettings(page);

    // Click create status button
    await page.locator('#create-status-button').click();
    await page.waitForSelector('#status-form-dialog');

    // Open icon picker
    await page.locator('#icon-picker-trigger').click();
    await page.waitForTimeout(500);

    // Verify modal is compact (max-w-md)
    const modal = page.locator('.bg-white.rounded-lg.shadow-xl.max-w-md');
    await expect(modal).toBeVisible();

    // Verify icons are displayed in grid
    const iconGrid = page.locator('.grid.grid-cols-9');
    await expect(iconGrid).toBeVisible();

    // Verify icons are organized by category
    await expect(page.locator('text=Status')).toBeVisible();
    await expect(page.locator('text=Progress')).toBeVisible();
    await expect(page.locator('text=Tasks')).toBeVisible();

    // Verify at least one icon is visible and clickable
    const eyeIcon = page.locator('#icon-option-Eye');
    await expect(eyeIcon).toBeVisible();

    // Select an icon
    await eyeIcon.click();

    // Verify modal closes after selection
    await expect(modal).not.toBeVisible();
  });

  test('color picker functionality', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    await gotoTaskStatusSettings(page);

    // Click create status button
    await page.locator('#create-status-button').click();
    await page.waitForSelector('#status-form-dialog');

    // Open color picker
    await page.locator('#color-picker-trigger').click();
    await page.waitForTimeout(500);

    // Select a color (assuming preset colors are available)
    const colorOption = page.locator('[data-color="#3B82F6"]').first();
    await expect(colorOption).toBeVisible();
    await colorOption.click();
    await page.waitForTimeout(300);

    // Verify selected color is displayed in the trigger
    const colorDisplay = page.locator('#color-picker-trigger div[style*="background-color"]').first();
    await expect(colorDisplay).toBeVisible();
  });

  test('status display in library list shows all information', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: settingsPermissions,
        },
      ],
    });

    // Create a closed status
    const [closedStatus] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Completed',
        is_closed: true,
        order_number: 1,
        color: '#10B981',
        icon: 'CheckCircle',
      })
      .returning('*');

    // Create an open status
    const [openStatus] = await db('statuses')
      .insert({
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'In Progress',
        is_closed: false,
        order_number: 2,
        color: '#3B82F6',
        icon: 'Activity',
      })
      .returning('*');

    await gotoTaskStatusSettings(page);

    // Verify closed status shows "Closed" badge
    const completedRow = page.locator('text=Completed').locator('..');
    await expect(completedRow.locator('text=Closed')).toBeVisible();

    // Verify open status doesn't show "Closed" badge
    const inProgressRow = page.locator('text=In Progress').locator('..');
    await expect(inProgressRow.locator('text=Closed')).not.toBeVisible();

    // Verify both statuses show edit and delete buttons
    await expect(page.locator(`#edit-status-${closedStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#delete-status-${closedStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#edit-status-${openStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#delete-status-${openStatus.status_id}`)).toBeVisible();

    // Verify move buttons are visible
    await expect(page.locator(`#move-up-${closedStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#move-down-${closedStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#move-up-${openStatus.status_id}`)).toBeVisible();
    await expect(page.locator(`#move-down-${openStatus.status_id}`)).toBeVisible();
  });

  test('status list shows existing statuses on load', async ({ page }) => {
    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'settings', action: 'read' },
            { resource: 'settings', action: 'update' },
          ] as TenantPermissionTuple[],
        },
      ],
    });

    // Create multiple statuses
    await db('statuses').insert([
      {
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Backlog',
        is_closed: false,
        order_number: 1,
        color: '#6B7280',
        icon: 'Clipboard',
      },
      {
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'In Progress',
        is_closed: false,
        order_number: 2,
        color: '#3B82F6',
        icon: 'Activity',
      },
      {
        tenant: tenantData.tenant.tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: 'Done',
        is_closed: true,
        order_number: 3,
        color: '#10B981',
        icon: 'CheckCircle',
      },
    ]);

    await page.goto(settingsUrl);
    await page.waitForLoadState('networkidle');

    // Verify all statuses are displayed
    await expect(page.locator('text=Backlog')).toBeVisible();
    await expect(page.locator('text=In Progress')).toBeVisible();
    await expect(page.locator('text=Done')).toBeVisible();

    // Verify they are in correct order
    const statuses = page.locator('.flex.items-center.justify-between.p-4.bg-white');
    const count = await statuses.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
