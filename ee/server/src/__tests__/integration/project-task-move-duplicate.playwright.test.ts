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

test.describe('Project Task Move and Duplicate with Full Path Display', () => {
  let context: E2ETestContext;

  test.beforeAll(async () => {
    context = new E2ETestContext({
      baseUrl: TEST_CONFIG.baseUrl,
      browserOptions: process.env.CI ? {
        headless: true,
      } : {
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

    // Seed permissions table for the tenant
    console.log('[Test Setup] Seeding permissions for test tenant...');
    await seedPermissionsForTenant(
      context.db,
      context.tenantData.tenant.tenantId
    );

    // Grant ALL MSP permissions to Admin role
    console.log('[Test Setup] Granting all permissions to Admin role...');
    await grantAllPermissionsToRole(
      context.db,
      context.tenantData.tenant.tenantId,
      'Admin'
    );
    console.log('[Test Setup] Permissions granted successfully');
  });

  test('displays full path in move task dialog when selecting status', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create a test project with custom statuses
    const projectId = uuidv4();
    const companyId = tenantData.client!.clientId;

    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: companyId,
      project_name: 'Test Project - Move Task',
      wbs_code: 'TP-MOVE',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create two phases
    const phase1Id = uuidv4();
    const phase2Id = uuidv4();

    await context.db('project_phases').insert([
      {
        phase_id: phase1Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase Alpha',
        wbs_code: 'ALPHA',
        order_number: 1,
        entered_at: new Date(),
      },
      {
        phase_id: phase2Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase Beta',
        wbs_code: 'BETA',
        order_number: 2,
        entered_at: new Date(),
      },
    ]);

    // Create custom statuses for each phase
    const statusMapping1 = uuidv4();
    const statusMapping2 = uuidv4();
    const statusMapping3 = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: statusMapping1,
        tenant: tenantId,
        phase_id: phase1Id,
        project_id: projectId,
        custom_name: 'In Progress',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusMapping2,
        tenant: tenantId,
        phase_id: phase2Id,
        project_id: projectId,
        custom_name: 'Ready for Review',
        standard_status_id: 2,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusMapping3,
        tenant: tenantId,
        phase_id: phase2Id,
        project_id: projectId,
        custom_name: 'Completed',
        standard_status_id: 3,
        is_visible: true,
        display_order: 2,
      },
    ]);

    // Create a task in Phase Alpha
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phase1Id,
      project_status_mapping_id: statusMapping1,
      task_name: 'Test Task for Moving',
      wbs_code: 'TASK-001',
      entered_at: new Date(),
    });

    // Navigate to project page
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.log('[Move Task Test] Network idle timeout, continuing...');
    });

    // Wait for task to appear
    await page.waitForTimeout(2000);

    // Find and click the task card to open menu
    const taskCard = page.locator(`text=Test Task for Moving`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    // Look for the three-dot menu button associated with this task
    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();

    // Wait for dropdown menu and click "Move Task"
    await page.waitForTimeout(500);
    const moveButton = page.locator('text=Move Task').first();
    await moveButton.click();

    // Wait for Move Task dialog to appear
    await page.waitForTimeout(1000);
    const dialogTitle = page.locator('text=Move Task');
    await expect(dialogTitle).toBeVisible({ timeout: 10_000 });

    // Click on TreeSelect to open dropdown
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    // Expand the project
    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    // Expand Phase Beta
    const phaseBetaItem = page.locator('text=Phase Beta').first();
    await phaseBetaItem.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    // Click on "Ready for Review" status
    const readyForReviewStatus = page.locator('text=Ready for Review').first();
    await readyForReviewStatus.click();
    await page.waitForTimeout(500);

    // Verify the input displays full path: "Project Name > Phase Name > Status Name"
    const inputValue = await treeSelect.textContent();
    expect(inputValue).toContain('Test Project - Move Task');
    expect(inputValue).toContain('Phase Beta');
    expect(inputValue).toContain('Ready for Review');

    // Verify the path separator
    expect(inputValue).toMatch(/Test Project - Move Task\s*>\s*Phase Beta\s*>\s*Ready for Review/);
  });

  test('displays full path in duplicate task dialog', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create a test project
    const projectId = uuidv4();
    const companyId = tenantData.client!.clientId;

    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: companyId,
      project_name: 'Test Project - Duplicate',
      wbs_code: 'TP-DUP',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create phase
    const phaseId = uuidv4();
    await context.db('project_phases').insert({
      phase_id: phaseId,
      tenant: tenantId,
      project_id: projectId,
      phase_name: 'Implementation Phase',
      wbs_code: 'IMPL',
      order_number: 1,
      entered_at: new Date(),
    });

    // Create statuses
    const statusMapping1 = uuidv4();
    const statusMapping2 = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: statusMapping1,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'Backlog',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusMapping2,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'In Development',
        standard_status_id: 2,
        is_visible: true,
        display_order: 2,
      },
    ]);

    // Create a task with checklist and assignees
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phaseId,
      project_status_mapping_id: statusMapping1,
      task_name: 'Task with Checklist',
      wbs_code: 'TASK-002',
      assigned_to: tenantData.adminUser.userId,
      entered_at: new Date(),
    });

    // Add checklist items
    const checklistItem1 = uuidv4();
    await context.db('task_checklist_items').insert({
      item_id: checklistItem1,
      tenant: tenantId,
      task_id: taskId,
      item_name: 'Checklist Item 1',
      sequence_number: 1,
      is_completed: false,
    });

    // Navigate to project page
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open task menu and click Duplicate
    const taskCard = page.locator(`text=Task with Checklist`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const duplicateButton = page.locator('text=Duplicate Task').first();
    await duplicateButton.click();

    // Wait for Duplicate Task dialog
    await page.waitForTimeout(1000);
    const dialogTitle = page.locator('text=Duplicate Task');
    await expect(dialogTitle).toBeVisible({ timeout: 10_000 });

    // Open TreeSelect
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    // Expand project
    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    // Expand phase
    const phaseItem = page.locator('text=Implementation Phase').first();
    await phaseItem.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    // Select "In Development" status
    const inDevStatus = page.locator('text=In Development').first();
    await inDevStatus.click();
    await page.waitForTimeout(500);

    // Verify full path displays
    const inputValue = await treeSelect.textContent();
    expect(inputValue).toContain('Test Project - Duplicate');
    expect(inputValue).toContain('Implementation Phase');
    expect(inputValue).toContain('In Development');
    expect(inputValue).toMatch(/Test Project - Duplicate\s*>\s*Implementation Phase\s*>\s*In Development/);
  });

  test('moves task to different status in same phase', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create project
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: tenantData.client!.clientId,
      project_name: 'Kanban Test Project',
      wbs_code: 'KANBAN',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create phase
    const phaseId = uuidv4();
    await context.db('project_phases').insert({
      phase_id: phaseId,
      tenant: tenantId,
      project_id: projectId,
      phase_name: 'Development',
      wbs_code: 'DEV',
      order_number: 1,
      entered_at: new Date(),
    });

    // Create two statuses: Status A and Status B
    const statusA = uuidv4();
    const statusB = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: statusA,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'Status A',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusB,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'Status B',
        standard_status_id: 2,
        is_visible: true,
        display_order: 2,
      },
    ]);

    // Create task in Status A
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phaseId,
      project_status_mapping_id: statusA,
      task_name: 'Move Between Statuses',
      wbs_code: 'TASK-003',
      entered_at: new Date(),
    });

    // Navigate to project
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open Move Task dialog
    const taskCard = page.locator(`text=Move Between Statuses`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const moveButton = page.locator('text=Move Task').first();
    await moveButton.click();
    await page.waitForTimeout(1000);

    // Select Status B
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    const phaseItem = page.locator('text=Development').first();
    await phaseItem.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    const statusBItem = page.locator('text=Status B').first();
    await statusBItem.click();
    await page.waitForTimeout(500);

    // Confirm move
    const confirmButton = page.locator('#confirm-move-button');
    await confirmButton.click();
    await page.waitForTimeout(2000);

    // Verify task moved in database
    const movedTask = await context.db('project_tasks')
      .where({ task_id: taskId, tenant: tenantId })
      .first();

    expect(movedTask.project_status_mapping_id).toBe(statusB);
    expect(movedTask.phase_id).toBe(phaseId);

    // Verify task appears in Status B column in UI
    await page.waitForTimeout(1000);
    const statusBColumn = page.locator('text=Status B').first();
    await expect(statusBColumn).toBeVisible();

    // Task should be visible on the page after move
    const taskAfterMove = page.locator('text=Move Between Statuses');
    await expect(taskAfterMove).toBeVisible({ timeout: 10_000 });
  });

  test('moves task to different phase and status', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create project
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: tenantData.client!.clientId,
      project_name: 'Cross Phase Move',
      wbs_code: 'CROSS',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create two phases
    const phase1Id = uuidv4();
    const phase2Id = uuidv4();

    await context.db('project_phases').insert([
      {
        phase_id: phase1Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase 1',
        wbs_code: 'P1',
        order_number: 1,
        entered_at: new Date(),
      },
      {
        phase_id: phase2Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase 2',
        wbs_code: 'P2',
        order_number: 2,
        entered_at: new Date(),
      },
    ]);

    // Create statuses
    const statusPhase1 = uuidv4();
    const statusPhase2 = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: statusPhase1,
        tenant: tenantId,
        phase_id: phase1Id,
        project_id: projectId,
        custom_name: 'Status A',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusPhase2,
        tenant: tenantId,
        phase_id: phase2Id,
        project_id: projectId,
        custom_name: 'Status B',
        standard_status_id: 2,
        is_visible: true,
        display_order: 1,
      },
    ]);

    // Create task in Phase 1
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phase1Id,
      project_status_mapping_id: statusPhase1,
      task_name: 'Cross Phase Task',
      wbs_code: 'TASK-004',
      entered_at: new Date(),
    });

    // Navigate to project
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open Move Task dialog
    const taskCard = page.locator(`text=Cross Phase Task`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const moveButton = page.locator('text=Move Task').first();
    await moveButton.click();
    await page.waitForTimeout(1000);

    // Select Phase 2, Status B
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    const phase2Item = page.locator('text=Phase 2').first();
    await phase2Item.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    const statusBItem = page.locator('text=Status B').first();
    await statusBItem.click();
    await page.waitForTimeout(500);

    // Confirm move
    const confirmButton = page.locator('#confirm-move-button');
    await confirmButton.click();
    await page.waitForTimeout(2000);

    // Verify task moved to Phase 2 and Status B
    const movedTask = await context.db('project_tasks')
      .where({ task_id: taskId, tenant: tenantId })
      .first();

    expect(movedTask.phase_id).toBe(phase2Id);
    expect(movedTask.project_status_mapping_id).toBe(statusPhase2);
  });

  test('duplicates task with status selection and preserves options', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create project
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: tenantData.client!.clientId,
      project_name: 'Duplicate Status Test',
      wbs_code: 'DUP-STATUS',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create phase
    const phaseId = uuidv4();
    await context.db('project_phases').insert({
      phase_id: phaseId,
      tenant: tenantId,
      project_id: projectId,
      phase_name: 'Testing Phase',
      wbs_code: 'TEST',
      order_number: 1,
      entered_at: new Date(),
    });

    // Create statuses
    const statusA = uuidv4();
    const statusB = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: statusA,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'Status A',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: statusB,
        tenant: tenantId,
        phase_id: phaseId,
        project_id: projectId,
        custom_name: 'Status B',
        standard_status_id: 2,
        is_visible: true,
        display_order: 2,
      },
    ]);

    // Create task with checklist and assignee
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phaseId,
      project_status_mapping_id: statusA,
      task_name: 'Duplicate Me',
      wbs_code: 'TASK-005',
      assigned_to: tenantData.adminUser.userId,
      entered_at: new Date(),
    });

    // Add checklist
    const checklistId = uuidv4();
    await context.db('task_checklist_items').insert({
      item_id: checklistId,
      tenant: tenantId,
      task_id: taskId,
      item_name: 'Checklist Item',
      sequence_number: 1,
      is_completed: false,
    });

    // Navigate to project
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open Duplicate Task dialog
    const taskCard = page.locator(`text=Duplicate Me`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const duplicateButton = page.locator('text=Duplicate Task').first();
    await duplicateButton.click();
    await page.waitForTimeout(1000);

    // Select Status B
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    const phaseItem = page.locator('text=Testing Phase').first();
    await phaseItem.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    const statusBItem = page.locator('text=Status B').first();
    await statusBItem.click();
    await page.waitForTimeout(500);

    // Verify duplicate switches are visible and enabled
    const checklistSwitch = page.locator('#duplicateChecklist');
    await expect(checklistSwitch).toBeVisible();

    const assigneeSwitch = page.locator('#duplicatePrimaryAssignee');
    await expect(assigneeSwitch).toBeVisible();

    // Confirm duplicate
    const confirmButton = page.locator('#confirm-duplicate-button');
    await confirmButton.click();
    await page.waitForTimeout(2000);

    // Verify original task still exists in Status A
    const originalTask = await context.db('project_tasks')
      .where({ task_id: taskId, tenant: tenantId })
      .first();

    expect(originalTask.project_status_mapping_id).toBe(statusA);

    // Verify duplicated task exists in Status B
    const duplicatedTasks = await context.db('project_tasks')
      .where({
        tenant: tenantId,
        project_id: projectId,
        phase_id: phaseId,
        project_status_mapping_id: statusB,
      })
      .whereNot({ task_id: taskId });

    expect(duplicatedTasks.length).toBeGreaterThan(0);

    const duplicatedTask = duplicatedTasks[0];
    expect(duplicatedTask.task_name).toContain('Duplicate Me');

    // Verify checklist was duplicated
    const duplicatedChecklist = await context.db('task_checklist_items')
      .where({
        tenant: tenantId,
        task_id: duplicatedTask.task_id,
      });

    expect(duplicatedChecklist.length).toBe(1);
  });

  test('validates cannot move to same phase and status', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create project
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: tenantData.client!.clientId,
      project_name: 'Validation Test',
      wbs_code: 'VAL',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create phase
    const phaseId = uuidv4();
    await context.db('project_phases').insert({
      phase_id: phaseId,
      tenant: tenantId,
      project_id: projectId,
      phase_name: 'Validation Phase',
      wbs_code: 'VAL',
      order_number: 1,
      entered_at: new Date(),
    });

    // Create status
    const statusId = uuidv4();
    await context.db('project_status_mappings').insert({
      project_status_mapping_id: statusId,
      tenant: tenantId,
      phase_id: phaseId,
      project_id: projectId,
      custom_name: 'Current Status',
      standard_status_id: 1,
      is_visible: true,
      display_order: 1,
    });

    // Create task
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phaseId,
      project_status_mapping_id: statusId,
      task_name: 'Validation Task',
      wbs_code: 'TASK-006',
      entered_at: new Date(),
    });

    // Navigate to project
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open Move Task dialog
    const taskCard = page.locator(`text=Validation Task`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const moveButton = page.locator('text=Move Task').first();
    await moveButton.click();
    await page.waitForTimeout(1000);

    // Try to select the same status
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    const projectChevron = page.locator('[data-type="project"]').first().locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    const phaseItem = page.locator('text=Validation Phase').first();
    await phaseItem.locator('..').locator('svg').first().click();
    await page.waitForTimeout(300);

    const currentStatusItem = page.locator('text=Current Status').first();
    await currentStatusItem.click();
    await page.waitForTimeout(500);

    // Verify button is disabled
    const confirmButton = page.locator('#confirm-move-button');
    await expect(confirmButton).toBeDisabled();

    // Try to click anyway and verify error message
    await confirmButton.click({ force: true });
    await page.waitForTimeout(500);

    // Verify error toast appears (look for the error message)
    const errorMessage = page.locator('text=Please select a different phase or status to move the task');
    const isErrorVisible = await errorMessage.isVisible({ timeout: 3000 }).catch(() => false);

    // Either the button is disabled OR error message shows
    if (!isErrorVisible) {
      await expect(confirmButton).toBeDisabled();
    }
  });

  test('tree select shows proper collapse/expand behavior', async () => {
    test.setTimeout(120000);

    const { page, tenantData } = context;
    const tenantId = tenantData.tenant.tenantId;

    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Create project with multiple phases and statuses
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: tenantId,
      company_id: tenantData.client!.clientId,
      project_name: 'Tree Expand Test',
      wbs_code: 'TREE',
      is_inactive: false,
      entered_at: new Date(),
    });

    // Create phases
    const phase1Id = uuidv4();
    const phase2Id = uuidv4();

    await context.db('project_phases').insert([
      {
        phase_id: phase1Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase One',
        wbs_code: 'P1',
        order_number: 1,
        entered_at: new Date(),
      },
      {
        phase_id: phase2Id,
        tenant: tenantId,
        project_id: projectId,
        phase_name: 'Phase Two',
        wbs_code: 'P2',
        order_number: 2,
        entered_at: new Date(),
      },
    ]);

    // Create statuses for both phases
    const status1 = uuidv4();
    const status2 = uuidv4();
    const status3 = uuidv4();

    await context.db('project_status_mappings').insert([
      {
        project_status_mapping_id: status1,
        tenant: tenantId,
        phase_id: phase1Id,
        project_id: projectId,
        custom_name: 'Status One',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: status2,
        tenant: tenantId,
        phase_id: phase2Id,
        project_id: projectId,
        custom_name: 'Status Two',
        standard_status_id: 1,
        is_visible: true,
        display_order: 1,
      },
      {
        project_status_mapping_id: status3,
        tenant: tenantId,
        phase_id: phase2Id,
        project_id: projectId,
        custom_name: 'Status Three',
        standard_status_id: 2,
        is_visible: true,
        display_order: 2,
      },
    ]);

    // Create task
    const taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: tenantId,
      project_id: projectId,
      phase_id: phase1Id,
      project_status_mapping_id: status1,
      task_name: 'Tree Test Task',
      wbs_code: 'TASK-007',
      entered_at: new Date(),
    });

    // Navigate to project
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Open Move Task dialog
    const taskCard = page.locator(`text=Tree Test Task`).first();
    await taskCard.waitFor({ state: 'visible', timeout: 15_000 });

    const menuButton = page.locator('[id$="-menu-button"]').first();
    await menuButton.click();
    await page.waitForTimeout(500);

    const moveButton = page.locator('text=Move Task').first();
    await moveButton.click();
    await page.waitForTimeout(1000);

    // Open tree select
    const treeSelect = page.locator('[role="combobox"]').first();
    await treeSelect.click();
    await page.waitForTimeout(500);

    // Verify project is initially collapsed (chevron points right)
    const projectItem = page.locator('[data-type="project"]').first();
    await expect(projectItem).toBeVisible();

    // Verify phases are NOT visible before expanding
    const phase1BeforeExpand = page.locator('text=Phase One').first();
    const isPhase1Visible = await phase1BeforeExpand.isVisible({ timeout: 1000 }).catch(() => false);
    expect(isPhase1Visible).toBe(false);

    // Expand project
    const projectChevron = projectItem.locator('svg').first();
    await projectChevron.click();
    await page.waitForTimeout(300);

    // Verify phases appear after expanding
    const phase1AfterExpand = page.locator('text=Phase One').first();
    await expect(phase1AfterExpand).toBeVisible();

    const phase2AfterExpand = page.locator('text=Phase Two').first();
    await expect(phase2AfterExpand).toBeVisible();

    // Verify statuses are NOT visible before expanding phase
    const status2BeforeExpand = page.locator('text=Status Two').first();
    const isStatus2Visible = await status2BeforeExpand.isVisible({ timeout: 1000 }).catch(() => false);
    expect(isStatus2Visible).toBe(false);

    // Expand Phase Two
    const phase2Chevron = phase2AfterExpand.locator('..').locator('svg').first();
    await phase2Chevron.click();
    await page.waitForTimeout(300);

    // Verify statuses appear after expanding phase
    const status2AfterExpand = page.locator('text=Status Two').first();
    await expect(status2AfterExpand).toBeVisible();

    const status3AfterExpand = page.locator('text=Status Three').first();
    await expect(status3AfterExpand).toBeVisible();

    // Click on Status Three
    await status3AfterExpand.click();
    await page.waitForTimeout(500);

    // Verify full path displays correctly
    const inputValue = await treeSelect.textContent();
    expect(inputValue).toContain('Tree Expand Test');
    expect(inputValue).toContain('Phase Two');
    expect(inputValue).toContain('Status Three');
    expect(inputValue).toMatch(/Tree Expand Test\s*>\s*Phase Two\s*>\s*Status Three/);
  });
});
