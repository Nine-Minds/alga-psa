import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';
import {
  extractCurrentPath,
  filterSuggestions,
  type AutocompleteSuggestion
} from '../../components/workflow-designer/mapping/expressionAutocompleteUtils';

applyPlaywrightAuthEnvDefaults();

type WorkflowPlaywrightOverrides = {
  registryNodes?: Array<Record<string, any>>;
  registryActions?: Array<Record<string, any>>;
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

/**
 * Set up the workflow designer with authenticated tenant
 */
async function applyWorkflowOverrides(page: Page, overrides: WorkflowPlaywrightOverrides): Promise<void> {
  await page.addInitScript((config) => {
    (window as typeof window & { __ALGA_PLAYWRIGHT_WORKFLOW__?: WorkflowPlaywrightOverrides })
      .__ALGA_PLAYWRIGHT_WORKFLOW__ = config;
  }, overrides);
}

async function setupDesigner(
  page: Page,
  baseURL: string,
  overrides?: WorkflowPlaywrightOverrides
): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}> {
  if (overrides) {
    await applyWorkflowOverrides(page, overrides);
  }
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Autocomplete Test ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: ADMIN_PERMISSIONS,
  });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(baseURL);
  return { db, tenantData, workflowPage };
}

/**
 * Create a control.if step for expression editing
 */
async function createControlIfStep(page: Page, workflowPage: WorkflowDesignerPage): Promise<string> {
  await workflowPage.clickNewWorkflow();
  await workflowPage.addButtonFor('control.if').click();

  const stepId = await workflowPage.getFirstStepId();
  await workflowPage.stepSelectButton(stepId).click();
  return stepId;
}

/**
 * Add a non-control node step to an existing workflow (optionally set saveAs)
 */
async function addNodeStep(
  page: Page,
  workflowPage: WorkflowDesignerPage,
  stepType: string,
  options?: { saveAs?: string }
): Promise<string | null> {
  const existingStepIds = await getStepIds(page);

  await workflowPage.addButtonFor(stepType).click();
  await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(
    existingStepIds.length + 1,
    { timeout: 5000 }
  );

  const updatedStepIds = await getStepIds(page);
  const newStepId = updatedStepIds.find((id) => !existingStepIds.includes(id)) ?? null;
  if (!newStepId) return null;

  await workflowPage.stepSelectButton(newStepId).click();

  if (options?.saveAs) {
    const saveAsInput = page.locator(`#workflow-step-saveAs-${newStepId}`);
    if (await saveAsInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveAsInput.fill(options.saveAs);
      await saveAsInput.press('Tab');
    }
  }

  return newStepId;
}

/**
 * Add a control.if step to an existing workflow
 */
async function addControlIfStep(
  page: Page,
  workflowPage: WorkflowDesignerPage
): Promise<string | null> {
  const existingStepIds = await getStepIds(page);

  await workflowPage.addButtonFor('control.if').click();
  await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(
    existingStepIds.length + 1,
    { timeout: 5000 }
  );

  const updatedStepIds = await getStepIds(page);
  const newStepId = updatedStepIds.find((id) => !existingStepIds.includes(id)) ?? null;
  if (!newStepId) return null;

  await workflowPage.stepSelectButton(newStepId).click();
  return newStepId;
}

/**
 * Find an expression textarea within the step config panel
 */
function getExpressionTextarea(page: Page, stepId: string): ReturnType<Page['locator']> {
  // Look for expression textareas in the mapping editor or condition fields
  return page.locator(`textarea[id*="${stepId}"][id*="expr"]`).first()
    .or(page.locator(`#if-condition-${stepId}-expr`))
    .or(page.locator(`textarea.font-mono`).first());
}

/**
 * Get the autocomplete dropdown
 */
function getAutocompleteDropdown(page: Page): ReturnType<Page['locator']> {
  return page.locator('[role="listbox"][aria-label="Expression autocomplete suggestions"]');
}

/**
 * Assert dropdown is truly rendered onscreen (visible, not clipped, and on top)
 */
async function assertDropdownVisibleOnScreen(
  page: Page,
  dropdown: ReturnType<Page['locator']>
): Promise<void> {
  await expect(dropdown).toBeVisible({ timeout: 5000 });

  const metrics = await dropdown.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const isOnTop = Boolean(topElement && (topElement === element || element.contains(topElement)));

    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      isOnTop
    };
  });

  expect(metrics.display).not.toBe('none');
  expect(metrics.visibility).toBe('visible');
  expect(Number.parseFloat(metrics.opacity)).toBeGreaterThan(0);
  expect(metrics.pointerEvents).not.toBe('none');
  expect(metrics.rect.width).toBeGreaterThan(0);
  expect(metrics.rect.height).toBeGreaterThan(0);
  expect(metrics.isOnTop).toBe(true);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect.left + metrics.rect.width).toBeLessThanOrEqual(viewport!.width + 5);
  expect(metrics.rect.top + metrics.rect.height).toBeLessThanOrEqual(viewport!.height + 5);
}

/**
 * Wait for autocomplete to appear or confirm it's hidden
 */
async function waitForAutocomplete(page: Page, shouldBeVisible: boolean, timeout = 5000): Promise<boolean> {
  const dropdown = getAutocompleteDropdown(page);
  try {
    if (shouldBeVisible) {
      await dropdown.waitFor({ state: 'visible', timeout });
      return true;
    } else {
      await dropdown.waitFor({ state: 'hidden', timeout });
      return false;
    }
  } catch {
    return !shouldBeVisible;
  }
}

/**
 * Comprehensive dropdown position and DOM structure validation
 */
async function validateDropdownPosition(
  page: Page,
  dropdown: ReturnType<Page['locator']>,
  inputField: ReturnType<Page['locator']>,
  options?: { expectOptions?: boolean; minOptions?: number }
): Promise<void> {
  const { expectOptions = true, minOptions = 1 } = options ?? {};

  await assertDropdownVisibleOnScreen(page, dropdown);

  // Get viewport dimensions
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const viewportWidth = viewport!.width;
  const viewportHeight = viewport!.height;

  // Get dropdown bounding box
  const dropdownBox = await dropdown.boundingBox();
  expect(dropdownBox).not.toBeNull();

  // Get input field bounding box for relative positioning check
  const inputBox = await inputField.boundingBox();
  expect(inputBox).not.toBeNull();

  // === POSITION CHECKS ===

  // 1. Dropdown should be fully within viewport (with small margin for edge cases)
  const MARGIN = 5;
  expect(dropdownBox!.x).toBeGreaterThanOrEqual(-MARGIN);
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(-MARGIN);
  expect(dropdownBox!.x + dropdownBox!.width).toBeLessThanOrEqual(viewportWidth + MARGIN);
  expect(dropdownBox!.y + dropdownBox!.height).toBeLessThanOrEqual(viewportHeight + MARGIN);

  // 2. Dropdown should have reasonable dimensions
  expect(dropdownBox!.width).toBeGreaterThanOrEqual(100); // Min width for readability
  expect(dropdownBox!.width).toBeLessThanOrEqual(600);    // Max width - shouldn't span entire screen
  expect(dropdownBox!.height).toBeGreaterThanOrEqual(30); // At least one option height
  expect(dropdownBox!.height).toBeLessThanOrEqual(400);   // Max height - should be scrollable if too many

  // 3. Dropdown should be positioned near the input field
  const isBelow = dropdownBox!.y >= inputBox!.y;
  const isAbove = dropdownBox!.y + dropdownBox!.height <= inputBox!.y + inputBox!.height;

  // Dropdown should be either directly below input OR flipped above if near bottom of viewport
  expect(isBelow || isAbove).toBe(true);

  // Should be close to the input (not floating randomly)
  if (isBelow) {
    // If below, top of dropdown should be near bottom of input
    expect(dropdownBox!.y).toBeLessThanOrEqual(inputBox!.y + inputBox!.height + 50);
  }

  // 4. Dropdown should horizontally overlap with input field (not floating to the side)
  const horizontalOverlap =
    dropdownBox!.x < inputBox!.x + inputBox!.width &&
    dropdownBox!.x + dropdownBox!.width > inputBox!.x;
  expect(horizontalOverlap).toBe(true);

  // === DOM STRUCTURE CHECKS ===

  // 5. Verify proper ARIA role
  await expect(dropdown).toHaveRole('listbox');

  // 6. Verify dropdown has accessible label
  await expect(dropdown).toHaveAttribute('aria-label', 'Expression autocomplete suggestions');

  // 7. Check for option elements
  const optionElements = dropdown.locator('[role="option"]');
  const optionCount = await optionElements.count();

  if (expectOptions) {
    expect(optionCount).toBeGreaterThanOrEqual(minOptions);

    // 8. Each option should have proper structure
    for (let i = 0; i < Math.min(optionCount, 5); i++) {
      const option = optionElements.nth(i);

      // Options should be visible
      await expect(option).toBeVisible();

      // Options should have some text content
      const textContent = await option.textContent();
      expect(textContent?.trim().length).toBeGreaterThan(0);

      // Options should have reasonable height (clickable)
      const optionBox = await option.boundingBox();
      expect(optionBox).not.toBeNull();
      expect(optionBox!.height).toBeGreaterThanOrEqual(20);
    }
  }

  // 9. Dropdown should have proper z-index (be on top) - check it's not hidden behind other elements
  const isInteractable = await dropdown.isEnabled();
  expect(isInteractable).toBe(true);
}

/**
 * Quick position sanity check for dropdowns that may or may not have options
 */
async function validateDropdownBasicPosition(
  page: Page,
  dropdown: ReturnType<Page['locator']>
): Promise<void> {
  await assertDropdownVisibleOnScreen(page, dropdown);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const dropdownBox = await dropdown.boundingBox();
  expect(dropdownBox).not.toBeNull();

  // Basic viewport bounds check
  expect(dropdownBox!.x).toBeGreaterThanOrEqual(0);
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(0);
  expect(dropdownBox!.x + dropdownBox!.width).toBeLessThanOrEqual(viewport!.width + 10);
  expect(dropdownBox!.y + dropdownBox!.height).toBeLessThanOrEqual(viewport!.height + 10);

  // Reasonable size
  expect(dropdownBox!.width).toBeGreaterThan(50);
  expect(dropdownBox!.height).toBeGreaterThan(20);
}

async function selectPipeOption(page: Page, optionMatcher: RegExp): Promise<void> {
  const pipeSelect = page.locator('button#workflow-designer-pipe-select')
    .or(page.getByRole('combobox', { name: /select pipe|insert into/i }));
  await pipeSelect.first().waitFor({ state: 'visible', timeout: 10_000 });
  await pipeSelect.first().click();

  const option = page.getByRole('option', { name: optionMatcher }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

async function getStepIds(page: Page): Promise<string[]> {
  const stepButtons = await page.locator('[id^="workflow-step-select-"]').all();
  const ids: string[] = [];
  for (const stepButton of stepButtons) {
    const id = await stepButton.getAttribute('id');
    if (id) {
      ids.push(id.replace('workflow-step-select-', ''));
    }
  }
  return ids;
}

async function setCursorPosition(
  field: ReturnType<Page['locator']>,
  position: number
): Promise<void> {
  await field.evaluate((element, pos) => {
    const el = element as HTMLTextAreaElement;
    el.focus();
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, position);
}

function buildAutocompleteRegistryOverrides(): WorkflowPlaywrightOverrides {
  const outputProperties: Record<string, any> = {
    details: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      }
    },
    items: { type: 'array', items: { type: 'string' } },
    total: { type: 'number' },
    is_active: { type: 'boolean' },
    name: { type: 'string' }
  };

  for (let i = 1; i <= 25; i += 1) {
    const key = `field${String(i).padStart(2, '0')}`;
    outputProperties[key] = { type: 'string' };
  }

  return {
    registryActions: [
      {
        id: 'autocomplete-test',
        version: 1,
        ui: {
          label: 'Autocomplete Test',
          description: 'Test action for autocomplete',
          category: 'Tests'
        },
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
          type: 'object',
          properties: outputProperties
        }
      }
    ]
  };
}

test.describe('Expression Autocomplete - Trigger Detection', () => {
  test('autocomplete triggers when typing "payload." at start of expression', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      // Ensure the field is visible and focusable
      await expect(exprField).toBeVisible({ timeout: 10000 });

      // Clear and type the trigger text
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 100 });

      // Wait for autocomplete to trigger
      await page.waitForTimeout(500);

      // Verify autocomplete dropdown appears
      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      // Comprehensive position and DOM structure validation
      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      // Verify payload-specific options are present
      const options = dropdown.locator('[role="option"]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(0);

      // Log option text for debugging
      const optionTexts: string[] = [];
      for (let i = 0; i < optionCount; i++) {
        const text = await options.nth(i).textContent();
        if (text) optionTexts.push(text.trim());
      }
      console.log('Payload autocomplete options:', optionTexts);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete does NOT trigger for "vars." when no variables are saved', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('vars.', { delay: 50 });

      // Autocomplete should NOT appear when there are no saved variables
      // (this is correct UX - don't show empty dropdown)
      const isVisible = await waitForAutocomplete(page, true, 2000);
      expect(isVisible).toBe(false);
      await expect(getAutocompleteDropdown(page)).toHaveCount(0);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete triggers when typing "meta." at start of expression', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('meta.', { delay: 100 });

      // Wait for autocomplete to trigger
      await page.waitForTimeout(500);

      // Verify autocomplete dropdown appears
      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      // Comprehensive position and DOM structure validation
      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      // Should show meta.state and/or meta.traceId
      await expect(dropdown).toContainText('state');

      // Verify meta-specific options
      const options = dropdown.locator('[role="option"]');
      const optionTexts: string[] = [];
      const optionCount = await options.count();
      for (let i = 0; i < optionCount; i++) {
        const text = await options.nth(i).textContent();
        if (text) optionTexts.push(text.trim());
      }
      console.log('Meta autocomplete options:', optionTexts);

      // Expect at least state or traceId
      const hasExpectedOptions = optionTexts.some(
        (t) => t.includes('state') || t.includes('traceId')
      );
      expect(hasExpectedOptions).toBe(true);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete triggers when typing "error." inside catch block context', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      await workflowPage.clickNewWorkflow();

      // Add a tryCatch block
      await workflowPage.addButtonFor('control.tryCatch').click();
      const stepIdsAfterTryCatch = await getStepIds(page);

      // Insert into the catch branch
      await selectPipeOption(page, /catch/i);
      await workflowPage.searchPalette('if');
      await workflowPage.addButtonFor('control.if').click();
      await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(
        stepIdsAfterTryCatch.length + 1,
        { timeout: 5000 }
      );

      const stepIdsAfterIf = await getStepIds(page);
      const catchStepId = stepIdsAfterIf.find((id) => !stepIdsAfterTryCatch.includes(id));
      expect(catchStepId).toBeDefined();

      await workflowPage.stepSelectButton(catchStepId!).click();
      const exprField = getExpressionTextarea(page, catchStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });

      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('error.', { delay: 100 });

      // Wait for autocomplete to trigger
      await page.waitForTimeout(500);

      // Verify autocomplete dropdown appears
      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      // Comprehensive position and DOM structure validation
      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      // Should show error.message
      await expect(dropdown).toContainText('message');

      // Verify error-specific options
      const options = dropdown.locator('[role="option"]');
      const optionTexts: string[] = [];
      const optionCount = await options.count();
      for (let i = 0; i < optionCount; i++) {
        const text = await options.nth(i).textContent();
        if (text) optionTexts.push(text.trim());
      }
      console.log('Error autocomplete options:', optionTexts);

      // Expect at least message option
      const hasMessageOption = optionTexts.some((t) => t.includes('message'));
      expect(hasMessageOption).toBe(true);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete triggers when typing "$item." inside forEach body', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      await workflowPage.clickNewWorkflow();

      // Add a forEach block
      await workflowPage.addButtonFor('control.forEach').click();
      const forEachStepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(forEachStepId).click();

      const itemVarInput = page.locator(`#foreach-itemvar-${forEachStepId}`);
      await expect(itemVarInput).toBeVisible({ timeout: 10_000 });
      await itemVarInput.fill('$item');

      const stepIdsAfterForEach = await getStepIds(page);
      await selectPipeOption(page, /body/i);
      await workflowPage.searchPalette('if');
      await workflowPage.addButtonFor('control.if').click();
      await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(
        stepIdsAfterForEach.length + 1,
        { timeout: 5000 }
      );

      const stepIdsAfterIf = await getStepIds(page);
      const bodyStepId = stepIdsAfterIf.find((id) => !stepIdsAfterForEach.includes(id));
      expect(bodyStepId).toBeDefined();

      await workflowPage.stepSelectButton(bodyStepId!).click();
      const exprField = getExpressionTextarea(page, bodyStepId!);
      await expect(exprField).toBeVisible({ timeout: 10_000 });

      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('$item.', { delay: 100 });

      // Wait for autocomplete to trigger
      await page.waitForTimeout(500);

      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      const options = dropdown.locator('[role="option"]');
      const optionTexts: string[] = [];
      const optionCount = await options.count();
      for (let i = 0; i < optionCount; i++) {
        const text = await options.nth(i).textContent();
        if (text) optionTexts.push(text.trim());
      }
      console.log('forEach autocomplete options:', optionTexts);

      const hasItemOption = optionTexts.some((t) => t.includes('$item') || t.includes('item'));
      expect(hasItemOption).toBe(true);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete triggers mid-expression after operator (e.g., "payload.id + vars.")', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      await workflowPage.clickNewWorkflow();

      const saveAsName = `result_${uuidv4().slice(0, 6)}`;
      const firstStepId = await addNodeStep(page, workflowPage, 'state.set', { saveAs: saveAsName });
      expect(firstStepId).toBeTruthy();

      const secondStepId = await addControlIfStep(page, workflowPage);
      expect(secondStepId).toBeTruthy();

      const exprField = getExpressionTextarea(page, secondStepId!);
      await expect(exprField).toBeVisible({ timeout: 10_000 });

      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially(`payload.id + vars.`, { delay: 80 });

      await page.waitForTimeout(500);

      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      // Should include saved var in suggestions
      await expect(dropdown).toContainText(saveAsName);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete does NOT trigger for arbitrary text that does not match root paths', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('randomText.notAPath', { delay: 50 });

      const isVisible = await waitForAutocomplete(page, true, 1500);
      expect(isVisible).toBe(false);
      await expect(getAutocompleteDropdown(page)).toHaveCount(0);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('autocomplete triggers after opening parenthesis (e.g., "coalesce(payload.")', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('coalesce(payload.', { delay: 80 });

      await page.waitForTimeout(500);

      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      await validateDropdownPosition(page, dropdown, exprField, {
        expectOptions: true,
        minOptions: 1,
      });

      const options = dropdown.locator('[role="option"]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(0);

    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Expression Autocomplete - Path Extraction', () => {
  test('extractCurrentPath returns correct path when cursor is at end of "payload.tick"', async () => {
    const expression = 'payload.tick';
    const cursorPosition = expression.length;
    expect(extractCurrentPath(expression, cursorPosition)).toBe('payload.tick');
  });

  test('extractCurrentPath returns correct path when cursor is mid-word', async () => {
    const expression = 'payload.ticket_id';
    const cursorPosition = 'payload.ti'.length;
    expect(extractCurrentPath(expression, cursorPosition)).toBe('payload.ti');
  });

  test('extractCurrentPath handles nested paths like "vars.createTicket.ticket_id"', async () => {
    const expression = 'vars.createTicket.ticket_id';
    const cursorPosition = expression.length;
    expect(extractCurrentPath(expression, cursorPosition)).toBe('vars.createTicket.ticket_id');
  });

  test('extractCurrentPath returns null for empty expression', async () => {
    expect(extractCurrentPath('', 0)).toBeNull();
  });

  test('extractCurrentPath handles paths after whitespace correctly', async () => {
    const expression = 'payload.id + vars.customer';
    const cursorPosition = expression.length;
    expect(extractCurrentPath(expression, cursorPosition)).toBe('vars.customer');
  });
});

test.describe('Expression Autocomplete - Filtering', () => {
  test('filterSuggestions returns all children when path ends with "."', async () => {
    const suggestions: AutocompleteSuggestion[] = [
      { path: 'payload', label: 'payload', hasChildren: true },
      { path: 'payload.id', label: 'id' },
      { path: 'payload.name', label: 'name' },
      { path: 'payload.meta', label: 'meta', hasChildren: true },
      { path: 'payload.meta.createdAt', label: 'createdAt' },
      { path: 'vars.result', label: 'result' }
    ];

    const results = filterSuggestions(suggestions, 'payload.');
    const resultPaths = results.map((r) => r.path).sort();
    expect(resultPaths).toEqual(['payload.id', 'payload.meta', 'payload.name'].sort());
  });

  test('filterSuggestions filters by prefix match on leaf name', async () => {
    const suggestions: AutocompleteSuggestion[] = [
      { path: 'payload.name', label: 'name' },
      { path: 'payload.note', label: 'note' },
      { path: 'payload.number', label: 'number' },
      { path: 'payload.meta', label: 'meta' },
      { path: 'meta.state', label: 'state' }
    ];

    const results = filterSuggestions(suggestions, 'payload.n');
    const resultPaths = results.map((r) => r.path);

    expect(resultPaths).toEqual(expect.arrayContaining([
      'payload.name',
      'payload.note',
      'payload.number'
    ]));
    expect(resultPaths).not.toContain('payload.meta');
    expect(resultPaths).not.toContain('meta.state');
  });

  test('filterSuggestions is case-insensitive', async () => {
    const suggestions: AutocompleteSuggestion[] = [
      { path: 'payload.Name', label: 'Name' },
      { path: 'payload.Number', label: 'Number' },
      { path: 'payload.Note', label: 'Note' }
    ];

    const results = filterSuggestions(suggestions, 'PAYLOAD.n');
    const resultPaths = results.map((r) => r.path);
    expect(resultPaths).toEqual(expect.arrayContaining([
      'payload.Name',
      'payload.Number',
      'payload.Note'
    ]));
  });

  test('filterSuggestions returns empty array when no matches found', async () => {
    const suggestions: AutocompleteSuggestion[] = [
      { path: 'payload.name', label: 'name' },
      { path: 'payload.note', label: 'note' }
    ];

    const results = filterSuggestions(suggestions, 'payload.zzz');
    expect(results).toHaveLength(0);
  });

  test('filterSuggestions limits results to reasonable count (max 20)', async () => {
    const suggestions: AutocompleteSuggestion[] = Array.from({ length: 40 }, (_, i) => ({
      path: `payload.field${i}`,
      label: `field${i}`
    }));

    const results = filterSuggestions(suggestions, 'payload.f');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  test('filterSuggestions prioritizes exact parent matches over fuzzy matches', async () => {
    const suggestions: AutocompleteSuggestion[] = [
      { path: 'payload.name', label: 'name' },
      { path: 'payload.note', label: 'note' },
      { path: 'payload.number', label: 'number' },
      { path: 'payload.meta.name', label: 'name' },
      { path: 'meta.name', label: 'name' }
    ];

    const results = filterSuggestions(suggestions, 'payload.n');
    const resultPaths = results.map((r) => r.path);

    expect(resultPaths).toEqual(expect.arrayContaining([
      'payload.name',
      'payload.note',
      'payload.number'
    ]));
    expect(resultPaths).not.toContain('payload.meta.name');
    expect(resultPaths).not.toContain('meta.name');
  });
});

test.describe('Expression Autocomplete - Keyboard Navigation', () => {
  test('Arrow Down moves selection to next suggestion', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await expect(dropdown).toBeVisible({ timeout: 5000 });

      const options = dropdown.locator('[role="option"]');
      await expect(options).toHaveCount(3, { timeout: 5000 });

      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('ArrowDown');

      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Arrow Up moves selection to previous suggestion', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      const options = dropdown.locator('[role="option"]');
      await expect(options).toHaveCount(3, { timeout: 5000 });
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('ArrowDown');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('ArrowUp');
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Arrow Down at last item stays at last item (no wrap)', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 3 });

      const options = dropdown.locator('[role="option"]');
      const count = await options.count();
      const lastIndex = count - 1;

      for (let i = 0; i < count; i += 1) {
        await exprField.press('ArrowDown');
      }

      await expect(options.nth(lastIndex)).toHaveAttribute('aria-selected', 'true');
      await exprField.press('ArrowDown');
      await expect(options.nth(lastIndex)).toHaveAttribute('aria-selected', 'true');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Arrow Up at first item stays at first item (no wrap)', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const options = dropdown.locator('[role="option"]');
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('ArrowUp');
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Enter key selects current suggestion and inserts path', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      const options = dropdown.locator('[role="option"]');
      await exprField.press('ArrowDown');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('Enter');

      await expect(dropdown).toBeHidden({ timeout: 5000 });
      await expect(exprField).toHaveValue(/payload\./);
      await expect(exprField).toHaveValue(/providerId|tenantId/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Tab key selects current suggestion and inserts path', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      const options = dropdown.locator('[role="option"]');
      await exprField.press('ArrowDown');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

      await exprField.press('Tab');

      await expect(dropdown).toBeHidden({ timeout: 5000 });
      await expect(exprField).toHaveValue(/payload\./);
      await expect(exprField).toHaveValue(/providerId|tenantId/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Escape key closes dropdown without selecting', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      await exprField.press('Escape');

      await expect(dropdown).toBeHidden({ timeout: 5000 });
      await expect(exprField).toHaveValue('payload.');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Expression Autocomplete - Selection Behavior', () => {
  test('Selecting a leaf field inserts full path and closes dropdown', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      const providerOption = dropdown.locator('[role="option"]').filter({ hasText: 'providerId' }).first();
      await providerOption.click();

      await expect(exprField).toHaveValue('payload.providerId');
      await expect(dropdown).toBeHidden({ timeout: 5000 });
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Selecting an object field inserts path with trailing dot and keeps dropdown open', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const objectOption = dropdown.locator('[role="option"]').filter({ hasText: 'emailData' }).first();
      await objectOption.click();

      await expect(exprField).toHaveValue('payload.emailData.');
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Selection replaces the partial path being typed, not the entire expression', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      const expression = 'payload.pr + 1';
      await exprField.fill(expression);
      const cursorIndex = expression.indexOf('payload.pr') + 'payload.pr'.length;
      await setCursorPosition(exprField, cursorIndex);
      await exprField.pressSequentially('o', { delay: 60 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const providerOption = dropdown.locator('[role="option"]').filter({ hasText: 'providerId' }).first();
      await providerOption.click();

      await expect(exprField).toHaveValue('payload.providerId + 1');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Cursor position is correctly set after path insertion', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('payload.pro');

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const providerOption = dropdown.locator('[role="option"]').filter({ hasText: 'providerId' }).first();
      await providerOption.click();

      await expect(exprField).toHaveValue('payload.providerId');

      const cursorPosition = await exprField.evaluate((element) => ({
        start: (element as HTMLTextAreaElement).selectionStart,
        end: (element as HTMLTextAreaElement).selectionEnd
      }));

      expect(cursorPosition.start).toBe('payload.providerId'.length);
      expect(cursorPosition.end).toBe('payload.providerId'.length);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Click on suggestion selects it', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      const tenantOption = dropdown.locator('[role="option"]').filter({ hasText: 'tenantId' }).first();
      await tenantOption.click();

      await expect(exprField).toHaveValue('payload.tenantId');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Expression Autocomplete - Data Context', () => {
  test('Suggestions include payload fields from workflow input schema', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 3 });

      const options = dropdown.locator('[role="option"]');
      await expect(options.filter({ hasText: 'emailData' }).first()).toBeVisible();
      await expect(options.filter({ hasText: 'providerId' }).first()).toBeVisible();
      await expect(options.filter({ hasText: 'tenantId' }).first()).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Suggestions include vars from previous steps with saveAs configured', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const overrides = buildAutocompleteRegistryOverrides();
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!, overrides);

    try {
      await workflowPage.clickNewWorkflow();
      const actionStepId = await addNodeStep(page, workflowPage, 'action:autocomplete-test', { saveAs: 'firstOutput' });
      expect(actionStepId).not.toBeNull();

      const controlStepId = await addControlIfStep(page, workflowPage);
      expect(controlStepId).not.toBeNull();

      const exprField = getExpressionTextarea(page, controlStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('vars.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const options = dropdown.locator('[role="option"]');
      await expect(options.filter({ hasText: 'firstOutput' }).first()).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Suggestions do NOT include vars from steps that come AFTER current step', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const overrides = buildAutocompleteRegistryOverrides();
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!, overrides);

    try {
      await workflowPage.clickNewWorkflow();
      const firstStepId = await addNodeStep(page, workflowPage, 'action:autocomplete-test', { saveAs: 'firstOutput' });
      expect(firstStepId).not.toBeNull();

      const controlStepId = await addControlIfStep(page, workflowPage);
      expect(controlStepId).not.toBeNull();

      const laterStepId = await addNodeStep(page, workflowPage, 'action:autocomplete-test', { saveAs: 'laterOutput' });
      expect(laterStepId).not.toBeNull();

      await workflowPage.stepSelectButton(controlStepId!).click();
      const exprField = getExpressionTextarea(page, controlStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('vars.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });

      const options = dropdown.locator('[role="option"]');
      await expect(options.filter({ hasText: 'firstOutput' }).first()).toBeVisible();
      await expect(options.filter({ hasText: 'laterOutput' })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Suggestions include meta fields (state, traceId, tags)', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('meta.', { delay: 80 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 3 });

      const options = dropdown.locator('[role="option"]');
      await expect(options.filter({ hasText: 'state' }).first()).toBeVisible();
      await expect(options.filter({ hasText: 'traceId' }).first()).toBeVisible();
      await expect(options.filter({ hasText: 'tags' }).first()).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Suggestions include $item and $index when inside forEach block', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.forEach').click();

      const forEachStepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(forEachStepId).click();

      const itemVarInput = page.locator(`#foreach-itemvar-${forEachStepId}`);
      await expect(itemVarInput).toBeVisible({ timeout: 5000 });
      await itemVarInput.fill('$item');
      await itemVarInput.press('Tab');

      await selectPipeOption(page, /for each.*body/i);
      const innerStepId = await addControlIfStep(page, workflowPage);
      expect(innerStepId).not.toBeNull();

      await workflowPage.stepSelectButton(innerStepId!).click();
      const exprField = getExpressionTextarea(page, innerStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });

      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('$item', { delay: 60 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });
      const options = dropdown.locator('[role="option"]');
      await expect(options.filter({ hasText: '$item' }).first()).toBeVisible();

      await exprField.fill('');
      await exprField.pressSequentially('$index', { delay: 60 });
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 1 });
      await expect(options.filter({ hasText: '$index' }).first()).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Expression Autocomplete - UI/Visual', () => {
  test('Type icons display correctly for string, number, boolean, object, array types', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const overrides = buildAutocompleteRegistryOverrides();
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!, overrides);

    try {
      await workflowPage.clickNewWorkflow();
      const actionStepId = await addNodeStep(page, workflowPage, 'action:autocomplete-test', { saveAs: 'testOutput' });
      expect(actionStepId).not.toBeNull();

      const controlStepId = await addControlIfStep(page, workflowPage);
      expect(controlStepId).not.toBeNull();

      const exprField = getExpressionTextarea(page, controlStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('vars.testOutput.', { delay: 60 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 5 });

      const options = dropdown.locator('[role="option"]');
      const nameOption = options.filter({ hasText: 'name' }).first();
      const totalOption = options.filter({ hasText: 'total' }).first();
      const activeOption = options.filter({ hasText: 'is_active' }).first();
      const detailsOption = options.filter({ hasText: 'details' }).first();
      const itemsOption = options.filter({ hasText: 'items' }).first();

      await nameOption.scrollIntoViewIfNeeded();
      await expect(nameOption.locator('svg.lucide-type')).toBeVisible();
      await totalOption.scrollIntoViewIfNeeded();
      await expect(totalOption.locator('svg.lucide-hash')).toBeVisible();
      await activeOption.scrollIntoViewIfNeeded();
      await expect(activeOption.locator('svg.lucide-toggle-left')).toBeVisible();
      await detailsOption.scrollIntoViewIfNeeded();
      await expect(detailsOption.locator('svg.lucide-braces')).toBeVisible();
      await itemsOption.scrollIntoViewIfNeeded();
      await expect(itemsOption.locator('svg.lucide-list')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Selected suggestion is visually highlighted', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

    try {
      const stepId = await createControlIfStep(page, workflowPage);
      const exprField = getExpressionTextarea(page, stepId);

      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('payload.', { delay: 60 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 2 });

      let selectedOption = dropdown.locator('[role="option"][aria-selected="true"]').first();
      await expect(selectedOption).toBeVisible();
      await expect(selectedOption).toHaveClass(/bg-primary-50/);

      await exprField.press('ArrowDown');
      selectedOption = dropdown.locator('[role="option"][aria-selected="true"]').first();
      await expect(selectedOption).toBeVisible();
      await expect(selectedOption).toHaveClass(/bg-primary-50/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('Dropdown scrolls to keep selected item visible', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const overrides = buildAutocompleteRegistryOverrides();
    const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!, overrides);

    try {
      await workflowPage.clickNewWorkflow();
      const actionStepId = await addNodeStep(page, workflowPage, 'action:autocomplete-test', { saveAs: 'testOutput' });
      expect(actionStepId).not.toBeNull();

      const controlStepId = await addControlIfStep(page, workflowPage);
      expect(controlStepId).not.toBeNull();

      const exprField = getExpressionTextarea(page, controlStepId!);
      await expect(exprField).toBeVisible({ timeout: 10000 });
      await exprField.click();
      await exprField.fill('');
      await exprField.pressSequentially('vars.testOutput.', { delay: 60 });

      const dropdown = getAutocompleteDropdown(page);
      await validateDropdownPosition(page, dropdown, exprField, { minOptions: 10 });

      const options = dropdown.locator('[role="option"]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThanOrEqual(20);

      for (let i = 0; i < optionCount - 1; i += 1) {
        await exprField.press('ArrowDown');
      }

      await expect(options.nth(optionCount - 1)).toHaveAttribute('aria-selected', 'true');

      const scrollTop = await dropdown.evaluate((element) => element.scrollTop);
      expect(scrollTop).toBeGreaterThan(0);

      const dropdownBox = await dropdown.boundingBox();
      const selectedBox = await options.nth(optionCount - 1).boundingBox();
      expect(dropdownBox).not.toBeNull();
      expect(selectedBox).not.toBeNull();
      expect(selectedBox!.y).toBeGreaterThanOrEqual(dropdownBox!.y - 2);
      expect(selectedBox!.y + selectedBox!.height).toBeLessThanOrEqual(dropdownBox!.y + dropdownBox!.height + 2);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
