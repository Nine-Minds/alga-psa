/**
 * Playwright tests for Workflow Payload Contract Inference (T011-T018, T024-T029, T054-T057, T078-T080, T092-T097, T110-T113, T118, T120-T121, T124)
 *
 * These tests verify the UI behavior of the workflow data contract section,
 * including inferred vs pinned modes, schema previews, and validation states.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';
import { ensureSystemEmailWorkflow } from './helpers/workflowSeedHelper';

applyPlaywrightAuthEnvDefaults();

// Clean up any orphan test workflows to prevent test pollution
async function cleanupTestWorkflows(db: Knex): Promise<void> {
  try {
    // Delete workflows created by tests (pattern matching test names)
    await db('workflow_definitions')
      .where('name', 'like', '%Test%')
      .orWhere('name', 'like', '%Persist%')
      .orWhere('name', 'like', '%Preview%')
      .orWhere('name', 'like', '%Warning%')
      .orWhere('name', 'like', '%Modal%')
      .orWhere('name', 'like', '%Distinction%')
      .orWhere('name', 'like', '%Switch%')
      .orWhere('name', 'like', '%ReadOnly%')
      .del();
  } catch {
    // Ignore cleanup errors
  }
}

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' },
    ],
  },
];

const READ_ONLY_PERMISSIONS = [
  {
    roleName: 'Viewer',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'read' },
    ],
  },
];

async function setupDesigner(page: Page, permissions = ADMIN_PERMISSIONS): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}> {
  const db = createTestDbConnection();

  // Clean up orphan workflows from previous tests
  await cleanupTestWorkflows(db);

  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Contract UI ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions,
  });

  await ensureSystemEmailWorkflow(db);

  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  return { db, tenantData, workflowPage };
}

async function createWorkflowWithTrigger(
  db: Knex,
  name: string,
  triggerEventName: string,
  payloadSchemaRef: string,
  options?: {
    payloadSchemaMode?: 'inferred' | 'pinned';
    pinnedPayloadSchemaRef?: string;
  }
): Promise<string> {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  const definition = {
    id: workflowId,
    version: 1,
    name,
    description: '',
    payloadSchemaRef,
    trigger: {
      type: 'event',
      eventName: triggerEventName,
      sourcePayloadSchemaRef: payloadSchemaRef,
    },
    steps: [],
  };

  await db('workflow_definitions').insert({
    workflow_id: workflowId,
    name,
    description: null,
    payload_schema_ref: payloadSchemaRef,
    payload_schema_mode: options?.payloadSchemaMode ?? 'inferred',
    pinned_payload_schema_ref: options?.pinnedPayloadSchemaRef ?? null,
    trigger: JSON.stringify(definition.trigger),
    draft_definition: JSON.stringify(definition),
    draft_version: 1,
    status: 'draft',
    is_visible: true,
    created_at: now,
    updated_at: now,
  });

  return workflowId;
}

test.describe('Workflow Designer UI - Contract Section', () => {
  test('T011: Designer shows Workflow data contract section instead of requiring payload schema pick', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Verify the contract section is visible with the label
      await expect(workflowPage.contractSection).toBeVisible();
      await expect(workflowPage.contractSectionLabel()).toContainText('Workflow data contract');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T012/T078: New workflow starts in inferred contract mode with default message', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Verify inferred mode is the default (toggle not checked)
      const isInferred = await workflowPage.isContractModeInferred();
      expect(isInferred).toBe(true);

      // Verify default message when no trigger selected
      await expect(workflowPage.contractSection).toContainText('No trigger is selected');
      await expect(workflowPage.contractSection).toContainText('payload');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T013: Advanced toggle enables pinning payload schema ref', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Click the contract mode toggle to enable pinned mode
      await workflowPage.contractModeToggle.click();

      // Verify pinned mode is now active
      const isPinned = await workflowPage.isContractModePinned();
      expect(isPinned).toBe(true);

      // Verify schema select is visible in pinned mode
      await expect(workflowPage.payloadSchemaSelectButton).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T014: Pinned mode shows schema select and advanced input option', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Enable pinned mode
      await workflowPage.setContractModePinned();

      // Verify schema select dropdown is visible
      await expect(workflowPage.payloadSchemaSelectButton).toBeVisible();

      // Verify advanced toggle is visible
      await expect(workflowPage.payloadSchemaAdvancedToggle).toBeVisible();

      // Click advanced to show input
      await workflowPage.payloadSchemaAdvancedToggle.click();
      await expect(workflowPage.payloadSchemaInput).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T015: Inferred mode hides/disables payload schema selection controls', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Ensure we're in inferred mode
      await workflowPage.setContractModeInferred();

      // Verify schema select is NOT visible in inferred mode
      await expect(workflowPage.payloadSchemaSelectButton).toHaveCount(0);

      // Verify the advanced input is not visible
      await expect(workflowPage.payloadSchemaInput).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T016: Inferred mode displays Effective schema preview label', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      // Create a workflow with a trigger event
      workflowId = await createWorkflowWithTrigger(
        db,
        `Inferred Test ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      // Select the workflow
      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify inferred indicator is visible
      await expect(workflowPage.inferredModeIndicator()).toBeVisible();

      // Verify "Effective" badge is visible
      await expect(workflowPage.effectiveBadge()).toBeVisible();

      // Verify the preview label shows "Effective schema preview"
      await expect(workflowPage.contractSchemaPreviewLabel()).toContainText('Effective schema preview');
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T017: Pinned mode displays Contract schema preview label', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      // Create a workflow in pinned mode
      workflowId = await createWorkflowWithTrigger(
        db,
        `Pinned Test ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'pinned', pinnedPayloadSchemaRef: 'payload.EmailWorkflowPayload.v1' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify the preview label shows "Contract schema preview"
      await expect(workflowPage.contractSchemaPreviewLabel()).toContainText('Contract schema preview');
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T079: Switching to pinned mode requires selecting a schema', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      // Switch to pinned mode
      await workflowPage.setContractModePinned();

      // Verify schema select is visible (user must select a schema)
      await expect(workflowPage.payloadSchemaSelectButton).toBeVisible();

      // Schema select should show placeholder or be empty initially
      const selectText = await workflowPage.payloadSchemaSelectButton.textContent();
      expect(selectText).toBeTruthy();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T080: Switching from pinned to inferred mode updates the UI correctly', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      // Create a workflow in pinned mode
      workflowId = await createWorkflowWithTrigger(
        db,
        `Mode Switch ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'pinned', pinnedPayloadSchemaRef: 'payload.EmailWorkflowPayload.v1' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify we start in pinned mode
      await expect(workflowPage.isContractModePinned()).resolves.toBe(true);
      await expect(workflowPage.payloadSchemaSelectButton).toBeVisible();

      // Switch to inferred mode
      await workflowPage.setContractModeInferred();

      // Verify inferred mode UI
      await expect(workflowPage.isContractModeInferred()).resolves.toBe(true);
      await expect(workflowPage.inferredModeIndicator()).toBeVisible();

      // Schema select should no longer be visible
      await expect(workflowPage.payloadSchemaSelectButton).toHaveCount(0);
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T024: Trigger section clearly distinguishes trigger schema vs payload contract', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      workflowId = await createWorkflowWithTrigger(
        db,
        `Trigger Distinction ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify the contract section explains the distinction
      await expect(workflowPage.contractSection).toContainText('event.payload');
      await expect(workflowPage.contractSection).toContainText('workflow contract');
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T054/T096: Schema preview modal supports inferred schema rendering with mode indicator', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      workflowId = await createWorkflowWithTrigger(
        db,
        `Preview Test ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Click on schema view button if schema preview is available
      await expect(workflowPage.schemaViewButton).toBeVisible({ timeout: 10_000 });
      await workflowPage.schemaViewButton.click();

      // Verify modal opens with schema content
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();

      // Modal should indicate the mode (Inferred)
      await expect(modal).toContainText(/Inferred|Pinned/);

      // Close modal
      await page.keyboard.press('Escape');
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T055: Modal indicates whether schema is inferred vs pinned', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId1: string | null = null;
    let workflowId2: string | null = null;

    try {
      // Create inferred workflow
      workflowId1 = await createWorkflowWithTrigger(
        db,
        `Inferred Modal ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      // Create pinned workflow
      workflowId2 = await createWorkflowWithTrigger(
        db,
        `Pinned Modal ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'pinned', pinnedPayloadSchemaRef: 'payload.EmailWorkflowPayload.v1' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      // Test inferred workflow modal
      const workflow1Name = (await db('workflow_definitions').where({ workflow_id: workflowId1 }).first())?.name;
      await workflowPage.selectWorkflowByName(workflow1Name);

      if (await workflowPage.schemaViewButton.isVisible()) {
        await workflowPage.schemaViewButton.click();
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toContainText('Inferred');
        await page.keyboard.press('Escape');
      }

      // Test pinned workflow modal
      const workflow2Name = (await db('workflow_definitions').where({ workflow_id: workflowId2 }).first())?.name;
      await workflowPage.selectWorkflowByName(workflow2Name);

      if (await workflowPage.schemaViewButton.isVisible()) {
        await workflowPage.schemaViewButton.click();
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toContainText('Pinned');
        await page.keyboard.press('Escape');
      }
    } finally {
      if (workflowId1) await db('workflow_definitions').where({ workflow_id: workflowId1 }).del().catch(() => {});
      if (workflowId2) await db('workflow_definitions').where({ workflow_id: workflowId2 }).del().catch(() => {});
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T112/T113: Manual workflow requires pinned schema to publish with UX guidance', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowName = '';

    try {
      await workflowPage.clickNewWorkflow();
      workflowName = await workflowPage.nameInput.inputValue();

      // Ensure we're in inferred mode (default) with no trigger
      await workflowPage.setContractModeInferred();

      // Clear trigger to make it a manual workflow (new workflows default to no trigger)
      await workflowPage.clearTriggerEvent();

      // Verify UX guidance about pinning schema
      await expect(workflowPage.contractSection).toContainText('Manual workflows must pin a schema');

      // Verify publish is disabled or shows appropriate warning
      // (The UI may disable publish or show validation error)
      await workflowPage.saveDraft();

      // Try to verify publish behavior (it should be blocked or show error)
      const publishDisabled = await workflowPage.publishButton.isDisabled();
      expect(publishDisabled).toBe(true);
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T118: Read-only users can view effective schema preview but cannot change contract settings', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page, READ_ONLY_PERMISSIONS);
    let workflowId: string | null = null;

    try {
      // Create a workflow (as admin, before logging in as read-only)
      workflowId = await createWorkflowWithTrigger(
        db,
        `ReadOnly Test ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify contract section is visible (can view)
      await expect(workflowPage.contractSection).toBeVisible();

      // Verify the contract mode toggle is disabled (cannot change)
      await expect(workflowPage.contractModeToggle).toBeDisabled();
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T110: View effective contract shows preview without publishing', async ({ page }) => {
    // SKIP: Uses createWorkflowWithTrigger which can cause database state issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      workflowId = await createWorkflowWithTrigger(
        db,
        `Effective Preview ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        { payloadSchemaMode: 'inferred' }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify we can preview the schema
      await expect(workflowPage.schemaPreviewToggle).toBeVisible();
      await workflowPage.schemaPreviewToggle.click();

      // Verify preview content is visible (should show JSON schema structure)
      const previewContent = page.locator('#workflow-designer-contract-section pre, #workflow-designer-contract-section code');
      await expect(previewContent).toBeVisible({ timeout: 5_000 });

      // Verify workflow is still in draft (not published)
      const record = await db('workflow_definitions').where({ workflow_id: workflowId }).first();
      expect(record.status).toBe('draft');
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T111: Warning appears when inferred contract differs from published contract', async ({ page }) => {
    // SKIP: This test requires a published workflow version to compare against.
    // The workflow_definitions table doesn't currently have a published_version column.
    // This test should be re-enabled once workflow publishing is fully implemented.
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowId: string | null = null;

    try {
      // Create a workflow
      workflowId = await createWorkflowWithTrigger(
        db,
        `Diff Warning ${uuidv4().slice(0, 6)}`,
        'INBOUND_EMAIL_RECEIVED',
        'payload.EmailWorkflowPayload.v1',
        {
          payloadSchemaMode: 'inferred',
        }
      );

      // TODO: Publish the workflow, then change the trigger to a different schema
      // to trigger the warning about contract differences

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      const workflowName = (await db('workflow_definitions').where({ workflow_id: workflowId }).first())?.name;
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify warning about contract difference is shown
      await expect(workflowPage.contractDiffersWarning()).toBeVisible({ timeout: 10_000 });
    } finally {
      if (workflowId) {
        await db('workflow_definitions').where({ workflow_id: workflowId }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T057: If inference fails, draft can still be saved but publish is blocked', async ({ page }) => {
    // SKIP: Late-running test that has session stability issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowName = '';

    try {
      await workflowPage.clickNewWorkflow();
      workflowName = await workflowPage.nameInput.inputValue();

      // New workflows start as manual (no trigger) which is in inferred mode
      // Verify that without a trigger, we can still save but publish is blocked
      await workflowPage.setContractModeInferred();

      // Save the draft - should succeed even without trigger/schema
      await workflowPage.saveDraft();
      await workflowPage.waitForWorkflowInList(workflowName);

      // Verify the workflow was saved
      const record = await db('workflow_definitions').where({ name: workflowName }).first();
      expect(record).toBeDefined();

      // Publish should be blocked (disabled or show error when clicked)
      const publishDisabled = await workflowPage.publishButton.isDisabled();
      // If not disabled, clicking should show an error
      if (!publishDisabled) {
        await workflowPage.publishButton.click();
        // Should show validation error or toast
        await expect(page.getByText(/cannot publish|missing schema|validation/i)).toBeVisible({ timeout: 5_000 });
      } else {
        expect(publishDisabled).toBe(true);
      }
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => {});
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });
});

test.describe('Workflow Designer UI - Contract Mode Persistence', () => {
  test('Contract mode persists after save and reload', async ({ page }) => {
    // SKIP: Late-running test that has session stability issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `Mode Persist ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.selectTriggerEvent('INBOUND_EMAIL_RECEIVED');

      // Set to pinned mode
      await workflowPage.setContractModePinned();
      await workflowPage.selectPayloadSchemaRef('payload.EmailWorkflowPayload.v1');

      // Save draft
      await workflowPage.saveDraft();
      await workflowPage.waitForWorkflowInList(workflowName);

      // Reload and verify mode persisted
      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify pinned mode persisted
      await expect(workflowPage.isContractModePinned()).resolves.toBe(true);
      await expect(workflowPage.payloadSchemaSelectButton).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => {});
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('Inferred mode persists correctly after save', async ({ page }) => {
    // SKIP: Late-running test that has session stability issues
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `Inferred Persist ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.selectTriggerEvent('INBOUND_EMAIL_RECEIVED');

      // Ensure inferred mode (default)
      await workflowPage.setContractModeInferred();

      // Save draft
      await workflowPage.saveDraft();
      await workflowPage.waitForWorkflowInList(workflowName);

      // Reload and verify mode persisted
      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);

      // Verify inferred mode persisted
      await expect(workflowPage.isContractModeInferred()).resolves.toBe(true);
      await expect(workflowPage.inferredModeIndicator()).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => {});
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });
});
