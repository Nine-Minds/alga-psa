import { expect, type Locator, type Page } from '@playwright/test';
import { resolvePlaywrightBaseUrl } from '../integration/helpers/playwrightAuthSessionHelper';

export class WorkflowDesignerPage {
  readonly page: Page;
  readonly header: Locator;
  readonly newWorkflowButton: Locator;
  readonly saveDraftButton: Locator;
  readonly publishButton: Locator;
  readonly nameInput: Locator;
  readonly versionInput: Locator;
  readonly descriptionInput: Locator;
  readonly payloadSchemaSelectButton: Locator;
  readonly payloadSchemaAdvancedToggle: Locator;
  readonly payloadSchemaInput: Locator;
  readonly triggerInput: Locator;
  readonly paletteSearchInput: Locator;

  // Contract section locators
  readonly contractSection: Locator;
  readonly contractModeToggle: Locator;
  readonly schemaPreviewToggle: Locator;
  readonly schemaViewButton: Locator;
  readonly pinToPublishedButton: Locator;
  readonly schemaClearButton: Locator;
  readonly triggerMappingJumpToContract: Locator;
  readonly emptyPipeline: Locator;

  constructor(page: Page) {
    this.page = page;
    this.header = page.getByRole('heading', { name: 'Workflow Designer' });
    this.newWorkflowButton = page.locator('#workflow-designer-create');
    this.saveDraftButton = page.locator('#workflow-designer-save');
    this.publishButton = page.locator('#workflow-designer-publish');
    this.nameInput = page.locator('#workflow-designer-name');
    this.versionInput = page.locator('#workflow-designer-version');
    this.descriptionInput = page.locator('#workflow-designer-description');
    // SearchableSelect renders both a div wrapper and a button with same ID - use the button
    this.payloadSchemaSelectButton = page.locator('#workflow-designer-schema-ref-select[role="combobox"]');
    this.payloadSchemaAdvancedToggle = page.locator('#workflow-designer-schema-advanced');
    this.payloadSchemaInput = page.locator('#workflow-designer-schema');
    // Trigger is now a SearchableSelect (combobox), use the button with role="combobox"
    this.triggerInput = page.locator('#workflow-designer-trigger-event[role="combobox"]');
    this.paletteSearchInput = page.locator('#workflow-designer-search');

    // Contract section locators
    this.contractSection = page.locator('#workflow-designer-contract-section');
    this.contractModeToggle = page.locator('#workflow-designer-contract-mode');
    this.schemaPreviewToggle = page.locator('#workflow-designer-schema-preview-toggle');
    this.schemaViewButton = page.locator('#workflow-designer-schema-view');
    this.pinToPublishedButton = page.locator('#workflow-designer-pin-to-published-contract');
    this.schemaClearButton = page.locator('#workflow-designer-schema-clear');
    this.triggerMappingJumpToContract = page.locator('#workflow-designer-trigger-mapping-jump-to-contract');

    this.emptyPipeline = page.locator('[data-testid="empty-pipeline"]');
  }

  async goto(baseUrl?: string): Promise<void> {
    const targetBaseUrl = baseUrl ?? resolvePlaywrightBaseUrl();
    const url = `${targetBaseUrl}/msp/workflows`;

    const startedAt = Date.now();
    let lastError: unknown = null;

    // The Playwright webServer helper sometimes reports "ready" a beat before the dev server
    // stabilizes (especially after a cold boot + heavy DB migrations). Retry on connection errors.
    while (Date.now() - startedAt < 90_000) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.waitForLoaded();
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const isConnectionRefused = message.includes('ERR_CONNECTION_REFUSED') || message.includes('ECONNREFUSED');
        if (!isConnectionRefused) throw error;
        await this.page.waitForTimeout(1000);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Failed to load workflow designer'));
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.header).toBeVisible({ timeout: 30_000 });
  }

  async waitForReady(): Promise<void> {
    await this.waitForLoaded();
    await expect(this.newWorkflowButton).toBeVisible({ timeout: 30_000 });
    await expect(this.newWorkflowButton).toBeEnabled({ timeout: 30_000 });
    await expect(this.nameInput).toBeVisible({ timeout: 30_000 });
  }

  async waitForPipelineReady(): Promise<void> {
    // The designer can render a skeleton while `activeDefinition` is null/loading. Steps can't be added until the pipeline is ready.
    const firstStepCard = this.page.locator('[data-testid^="step-card-"]').first();
    await expect(this.emptyPipeline.or(firstStepCard)).toBeVisible({ timeout: 60_000 });
  }

  addButtonFor(stepType: string): Locator {
    return this.page.locator(`[id="workflow-designer-add-${stepType}"]`);
  }

  async clickNewWorkflow(): Promise<void> {
    await expect(this.newWorkflowButton).toBeVisible({ timeout: 20_000 });
    await this.newWorkflowButton.click();
    await expect(this.nameInput).toBeVisible({ timeout: 30_000 });
    await this.waitForPipelineReady();
  }

  async saveDraft(): Promise<void> {
    const beforeUrl = this.page.url();
    const beforeParams = new URL(beforeUrl).searchParams;
    const hadWorkflowId = Boolean(beforeParams.get('workflowId'));

    await this.saveDraftButton.click();

    // Saving can be slow on a cold dev server; rely on button state/text (EE layout doesn't always render toasts).
    await expect(this.saveDraftButton).toHaveText(/Saving\.\.\./, { timeout: 30_000 });
    await expect(this.saveDraftButton).toHaveText(/Save Draft/, { timeout: 90_000 });
    await expect(this.saveDraftButton).toBeEnabled({ timeout: 90_000 });

    // New workflow creation should push workflowId into the URL.
    if (!hadWorkflowId) {
      await expect(this.page).toHaveURL(/workflowId=[0-9a-fA-F-]{36}/, { timeout: 90_000 });
    }
  }

  async clickSaveDraft(): Promise<void> {
    await this.saveDraft();
  }

  async setName(value: string): Promise<void> {
    await this.nameInput.fill(value);
  }

  async selectPayloadSchemaRef(schemaRef: string): Promise<void> {
    await expect(this.payloadSchemaSelectButton).toBeVisible({ timeout: 60_000 });
    await this.payloadSchemaSelectButton.click();
    const searchInput = this.page
      .locator('#workflow-designer-schema-ref-select-search')
      .or(this.page.getByPlaceholder(/search select schema/i));
    // SearchableSelect uses `id="<select-id>-search"`; in overlay mode, the input is portalled.
    await expect(searchInput.first()).toBeVisible({ timeout: 30_000 });
    await searchInput.fill(schemaRef);

    // Prefer keyboard selection to avoid occasional "option is outside viewport" issues with portalled overlays.
    const option = this.page.getByRole('option', {
      name: new RegExp(schemaRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    }).first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await searchInput.first().focus();
    await this.page.keyboard.press('Enter');
  }

  async setPayloadSchemaRefAdvanced(schemaRef: string): Promise<void> {
    if (!(await this.payloadSchemaInput.isVisible())) {
      await this.payloadSchemaAdvancedToggle.click();
    }
    await expect(this.payloadSchemaInput).toBeVisible({ timeout: 10_000 });
    await this.payloadSchemaInput.fill(schemaRef);
  }

  async searchPalette(value: string): Promise<void> {
    await this.paletteSearchInput.fill(value);
  }

  async selectWorkflowByName(name: string): Promise<void> {
    // Use id prefix to find workflow buttons, avoiding "New Workflow" create button
    const workflowButton = this.page.locator(`button[id^="workflow-designer-open-"]`).filter({ hasText: name });
    await expect(workflowButton.first()).toBeVisible({ timeout: 15_000 });
    await workflowButton.first().click();
  }

  async waitForWorkflowInList(name: string): Promise<void> {
    const workflowButton = this.page.locator(`button[id^="workflow-designer-open-"]`).filter({ hasText: name });
    await expect(workflowButton.first()).toBeVisible({ timeout: 15_000 });
  }

  async selectStepById(stepId: string): Promise<void> {
    await this.stepSelectButton(stepId).click();
  }

  async getFirstStepId(): Promise<string> {
    const stepSelect = this.page.locator('[id^="workflow-step-select-"]').first();
    await expect(stepSelect).toBeVisible({ timeout: 10_000 });
    const id = await stepSelect.getAttribute('id');
    if (!id) {
      throw new Error('Missing step select id');
    }
    return id.replace('workflow-step-select-', '');
  }

  stepSelectButton(stepId: string): Locator {
    return this.page.locator(`#workflow-step-select-${stepId}`);
  }

  stepDeleteButton(stepId: string): Locator {
    return this.page.locator(`#workflow-step-delete-${stepId}`);
  }

  dropStepsHereText(): Locator {
    // Kept for backward compatibility with older pipeline UI, but prefer `emptyPipeline`.
    return this.page.getByText('Drop steps here');
  }

  // Trigger event helpers
  async selectTriggerEvent(eventName: string): Promise<void> {
    await expect(this.triggerInput).toBeVisible({ timeout: 60_000 });
    await this.triggerInput.click();
    const searchInput = this.page.locator('#workflow-designer-trigger-event-search');
    if (await searchInput.isVisible()) {
      await searchInput.fill(eventName);
    }
    await this.page.getByRole('option', { name: new RegExp(eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
  }

  async clearTriggerEvent(): Promise<void> {
    // Select "Manual (no trigger)" option
    await this.triggerInput.click();
    await this.page.getByRole('option', { name: /Manual.*no trigger/i }).click();
  }

  // Contract mode helpers
  async isContractModeInferred(): Promise<boolean> {
    const checked = await this.contractModeToggle.getAttribute('aria-checked');
    return checked !== 'true';
  }

  async isContractModePinned(): Promise<boolean> {
    const checked = await this.contractModeToggle.getAttribute('aria-checked');
    return checked === 'true';
  }

  async setContractModePinned(): Promise<void> {
    await expect(this.contractModeToggle).toBeVisible({ timeout: 30_000 });
    const isInferred = await this.isContractModeInferred();
    if (isInferred) {
      await this.contractModeToggle.click();
      await expect(this.contractModeToggle).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
    }
  }

  async setContractModeInferred(): Promise<void> {
    const isPinned = await this.isContractModePinned();
    if (isPinned) {
      await this.contractModeToggle.click();
      await expect(this.contractModeToggle).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
    }
  }

  async getEffectiveSchemaRef(): Promise<string | null> {
    const inferredIndicator = this.page.locator('#workflow-designer-contract-section .font-mono');
    if (await inferredIndicator.count() > 0) {
      return await inferredIndicator.first().textContent();
    }
    return null;
  }

  contractSectionLabel(): Locator {
    return this.page.locator('label[for="workflow-designer-contract-mode"]');
  }

  inferredModeIndicator(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText('Inferred');
  }

  effectiveBadge(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText('Effective', { exact: true });
  }

  contractSchemaPreviewLabel(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText(/Contract schema preview|Effective schema preview/);
  }

  unknownSchemaWarning(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText(/Unknown schema ref/);
  }

  inferenceErrorMessage(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText(/No schema is available for/);
  }

  contractDiffersWarning(): Locator {
    return this.page.locator('#workflow-designer-contract-section').getByText('Draft contract differs from published');
  }

  contractSectionSkeleton(): Locator {
    return this.page.locator('#workflow-designer-contract-section .animate-pulse, #workflow-designer-contract-section [class*="skeleton"]');
  }
}
