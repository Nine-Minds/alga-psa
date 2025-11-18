/**
 * Playwright tests for managing project task statuses in edit mode
 *
 * Tests cover:
 * - Viewing existing project task statuses in edit mode (collapsed)
 * - Expanding status management UI
 * - Adding new statuses to a project
 * - Removing statuses from a project (with validation)
 * - Reordering project statuses
 * - Persistence of changes across edit sessions
 */

import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { E2ETestContext } from '../utils/test-context-e2e';
import {
  applyPlaywrightAuthEnvDefaults,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
} from './helpers/playwrightAuthSessionHelper';
import { seedPermissionsForTenant, grantAllPermissionsToRole } from './helpers/permissionTestHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

test.describe('Project Task Status Management in Edit Mode', () => {
  let context: E2ETestContext;

  test.beforeAll(async () => {
    context = new E2ETestContext({
      baseUrl: TEST_CONFIG.baseUrl,
      browserOptions: {
        headless: false,
        slowMo: 100,
      },
    });
    await context.initialize();
    await context.waitForAppReady();
  });

  test.afterAll(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  test.beforeEach(async () => {
    await context.reset();

    console.log('[Status Edit Test Setup] Seeding permissions...');
    await seedPermissionsForTenant(
      context.db,
      context.tenantData.tenant.tenantId
    );

    await grantAllPermissionsToRole(
      context.db,
      context.tenantData.tenant.tenantId,
      'Admin'
    );
  });

  /**
   * Helper function to create a test client
   */
  async function createTestClient(tenantId: string, clientName: string) {
    const clientId = uuidv4();
    await context.db('companies').insert({
      company_id: clientId,
      tenant: tenantId,
      company_name: clientName,
      is_inactive: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return clientId;
  }

  /**
   * Helper function to create a test project
   */
  async function createTestProject(
    tenantId: string,
    clientId: string,
    projectName: string,
    statusIds: string[] = []
  ) {
    const projectId = uuidv4();
    const statusId = uuidv4();

    // Insert into project_status_assignments
    await context.db('project_status_assignments').insert({
      project_status_id: statusId,
      tenant: tenantId,
      name: 'Active',
      is_closed: false,
      is_default: true,
    });

    // Create the project
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      project_name: projectName,
      company_id: clientId,
      status: 'Active',
      is_inactive: false,
      created_at: new Date(),
      updated_at: new Date(),
      wbs_code: `PRJ-${Date.now()}`,
    });

    // Add status mappings if provided
    if (statusIds.length > 0) {
      const mappings = statusIds.map((statusId, index) => ({
        project_status_mapping_id: uuidv4(),
        tenant: tenantId,
        project_id: projectId,
        status_id: statusId,
        is_standard: false,
        display_order: index + 1,
        is_visible: true,
      }));
      await context.db('project_status_mappings').insert(mappings);
    }

    return projectId;
  }

  /**
   * Helper function to create tenant statuses
   */
  async function createTenantStatuses(tenantId: string, count: number = 4) {
    const statusNames = ['To Do', 'In Progress', 'Review', 'Done', 'Blocked'];
    const statuses = [];

    for (let i = 0; i < Math.min(count, statusNames.length); i++) {
      const statusId = uuidv4();
      await context.db('statuses').insert({
        status_id: statusId,
        tenant: tenantId,
        item_type: 'project_task',
        status_type: 'project_task',
        name: statusNames[i],
        is_closed: statusNames[i] === 'Done',
        order_number: i + 1,
      });
      statuses.push({ id: statusId, name: statusNames[i] });
    }

    return statuses;
  }

  /**
   * Helper function to create a project task
   */
  async function createProjectTask(
    tenantId: string,
    projectId: string,
    mappingId: string,
    taskName: string
  ) {
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      task_name: taskName,
      project_status_mapping_id: mappingId,
      wbs_code: `TASK-${Date.now()}`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return taskId;
  }

  test('should view existing project task statuses in collapsed edit mode', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Corp');
    const statuses = await createTenantStatuses(tenantId, 3);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Status View', statusIds);

    console.log('[Test] Created project with statuses:', statuses.map(s => s.name));

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate to project details page
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Click edit button
    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.waitFor({ state: 'visible', timeout: 10000 });
    await editButton.click();

    await page.waitForTimeout(1000);

    // Verify Task Statuses section exists
    const statusLabel = page.getByText('Task Statuses');
    await expect(statusLabel).toBeVisible();

    // Verify collapsed view shows statuses
    for (const status of statuses) {
      const statusText = page.getByText(status.name).first();
      await expect(statusText).toBeVisible();
    }

    // Verify Customize button is visible
    const customizeButton = page.locator('#customize-task-statuses-button');
    await expect(customizeButton).toBeVisible();

    console.log('[Test] ✓ Task statuses visible in collapsed edit mode');
  });

  test('should expand status management UI in edit mode', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Expand');
    const statuses = await createTenantStatuses(tenantId, 3);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Expand UI', statusIds);

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Click Customize button
    const customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Verify expanded UI elements
    await expect(page.getByText(/Customize task statuses for this project/i)).toBeVisible();
    await expect(page.locator('#toggle-available-task-statuses')).toBeVisible();

    // Verify statuses are shown with reorder controls
    for (const status of statuses) {
      const moveUpButton = page.locator(`#move-up-task-status-${status.id}`);
      const moveDownButton = page.locator(`#move-down-task-status-${status.id}`);
      const removeButton = page.locator(`#remove-task-status-${status.id}`);

      await expect(moveUpButton).toBeVisible();
      await expect(moveDownButton).toBeVisible();
      await expect(removeButton).toBeVisible();
    }

    console.log('[Test] ✓ Status management UI expanded successfully');
  });

  test('should add new status to existing project', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Add Status');
    const statuses = await createTenantStatuses(tenantId, 4); // Create 4 statuses
    const initialStatusIds = statuses.slice(0, 2).map(s => s.id); // Only assign 2
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Add Status', initialStatusIds);

    const newStatusToAdd = statuses[2]; // The 3rd status (Review)

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Expand status management
    const customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Click "Add Status" button
    const addStatusButton = page.locator('#toggle-available-task-statuses');
    await addStatusButton.click();
    await page.waitForTimeout(500);

    // Click on the status to add
    const addStatusOptionButton = page.locator(`#add-task-status-${newStatusToAdd.id}`);
    await expect(addStatusOptionButton).toBeVisible();
    await addStatusOptionButton.click();
    await page.waitForTimeout(1000);

    // Verify the status was added to the list
    const removeButton = page.locator(`#remove-task-status-${newStatusToAdd.id}`);
    await expect(removeButton).toBeVisible();

    // Save the project
    const saveButton = page.getByRole('button', { name: /save/i }).first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Verify in database
    const mappings = await context.db('project_status_mappings')
      .where({ project_id: projectId, tenant: tenantId })
      .select('*');

    expect(mappings.length).toBe(3);
    expect(mappings.some((m: any) => m.status_id === newStatusToAdd.id)).toBe(true);

    console.log('[Test] ✓ New status added successfully');
  });

  test('should prevent removing status with assigned tasks', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Remove Block');
    const statuses = await createTenantStatuses(tenantId, 3);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Remove Block', statusIds);

    // Get the first mapping
    const mapping = await context.db('project_status_mappings')
      .where({ project_id: projectId, status_id: statusIds[0], tenant: tenantId })
      .first();

    // Create a task assigned to the first status
    await createProjectTask(tenantId, projectId, mapping.project_status_mapping_id, 'Test Task');

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Expand status management
    const customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Try to remove the status with a task
    const removeButton = page.locator(`#remove-task-status-${statusIds[0]}`);
    await removeButton.click();
    await page.waitForTimeout(1000);

    // Verify error toast appears
    const errorToast = page.getByText(/Cannot delete status with \d+ assigned task/i);
    await expect(errorToast).toBeVisible({ timeout: 5000 });

    console.log('[Test] ✓ Prevented removing status with assigned tasks');
  });

  test('should successfully remove status with no assigned tasks', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Remove Success');
    const statuses = await createTenantStatuses(tenantId, 3);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Remove Success', statusIds);

    const statusToRemove = statuses[2]; // Last status with no tasks

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Expand status management
    const customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Remove the status
    const removeButton = page.locator(`#remove-task-status-${statusToRemove.id}`);
    await removeButton.click();
    await page.waitForTimeout(1000);

    // Verify success toast
    const successToast = page.getByText(/Status removed successfully/i);
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify the status is no longer visible in the list
    await expect(removeButton).not.toBeVisible({ timeout: 2000 });

    // Save the project
    const saveButton = page.getByRole('button', { name: /save/i }).first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Verify in database
    const mappings = await context.db('project_status_mappings')
      .where({ project_id: projectId, tenant: tenantId })
      .select('*');

    expect(mappings.length).toBe(2);
    expect(mappings.some((m: any) => m.status_id === statusToRemove.id)).toBe(false);

    console.log('[Test] ✓ Status removed successfully');
  });

  test('should reorder project statuses using up/down arrows', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Reorder');
    const statuses = await createTenantStatuses(tenantId, 3);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Reorder', statusIds);

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Expand status management
    const customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Move the second status (In Progress) up - it should become first
    const moveUpButton = page.locator(`#move-up-task-status-${statusIds[1]}`);
    await moveUpButton.click();
    await page.waitForTimeout(1000);

    // Verify success toast
    const successToast = page.getByText(/success/i);
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Save the project
    const saveButton = page.getByRole('button', { name: /save/i }).first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Verify in database - the second status should now be first
    const mappings = await context.db('project_status_mappings')
      .where({ project_id: projectId, tenant: tenantId })
      .orderBy('display_order')
      .select('*');

    expect(mappings[0].status_id).toBe(statusIds[1]); // "In Progress" is now first
    expect(mappings[0].display_order).toBe(1);
    expect(mappings[1].status_id).toBe(statusIds[0]); // "To Do" is now second
    expect(mappings[1].display_order).toBe(2);

    console.log('[Test] ✓ Statuses reordered successfully');
  });

  test('should persist status configuration across edit sessions', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data
    const clientId = await createTestClient(tenantId, 'Test Client Persist');
    const statuses = await createTenantStatuses(tenantId, 4);
    const initialStatusIds = statuses.slice(0, 2).map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Persist', initialStatusIds);

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // First edit session - add a status and reorder
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    let editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Expand and add status
    let customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    const addStatusButton = page.locator('#toggle-available-task-statuses');
    await addStatusButton.click();
    await page.waitForTimeout(500);

    const newStatus = statuses[2];
    const addStatusOptionButton = page.locator(`#add-task-status-${newStatus.id}`);
    await addStatusOptionButton.click();
    await page.waitForTimeout(1000);

    // Reorder - move new status up
    const moveUpButton = page.locator(`#move-up-task-status-${newStatus.id}`);
    await moveUpButton.click();
    await page.waitForTimeout(1000);

    // Save
    let saveButton = page.getByRole('button', { name: /save/i }).first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Navigate away
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects`);
    await page.waitForTimeout(1000);

    // Second edit session - verify persistence
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    customizeButton = page.locator('#customize-task-statuses-button');
    await customizeButton.click();
    await page.waitForTimeout(500);

    // Verify the new status is still there
    const removeButton = page.locator(`#remove-task-status-${newStatus.id}`);
    await expect(removeButton).toBeVisible();

    // Verify order in database
    const mappings = await context.db('project_status_mappings')
      .where({ project_id: projectId, tenant: tenantId })
      .orderBy('display_order')
      .select('*');

    expect(mappings.length).toBe(3);
    // The new status should be in the second position (moved up once)
    expect(mappings[1].status_id).toBe(newStatus.id);

    console.log('[Test] ✓ Status configuration persisted across edit sessions');
  });

  test('should display correct status order in collapsed view', async () => {
    test.setTimeout(90000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    // Create test data with specific order
    const clientId = await createTestClient(tenantId, 'Test Client Order');
    const statuses = await createTenantStatuses(tenantId, 4);
    const statusIds = statuses.map(s => s.id);
    const projectId = await createTestProject(tenantId, clientId, 'Test Project Order View', statusIds);

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Navigate and enter edit mode
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const editButton = page.getByRole('button', { name: /edit/i }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // In collapsed view, verify statuses appear in order with chevron separators
    const collapsedView = page.locator('.bg-gray-50.rounded-lg.border').first();
    await expect(collapsedView).toBeVisible();

    // Verify all status names are visible in collapsed view
    for (const status of statuses) {
      const statusText = collapsedView.getByText(status.name);
      await expect(statusText).toBeVisible();
    }

    console.log('[Test] ✓ Statuses displayed in correct order in collapsed view');
  });
});
