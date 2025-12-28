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
  }

  async goto(baseUrl?: string): Promise<void> {
    const targetBaseUrl = baseUrl ?? resolvePlaywrightBaseUrl();
    await this.page.goto(`${targetBaseUrl}/msp/workflows`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await this.waitForLoaded();
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.header).toBeVisible({ timeout: 30_000 });
  }

  addButtonFor(stepType: string): Locator {
    return this.page.locator(`[id="workflow-designer-add-${stepType}"]`);
  }

  async clickNewWorkflow(): Promise<void> {
    await expect(this.newWorkflowButton).toBeVisible({ timeout: 20_000 });
    await this.newWorkflowButton.click();
  }

  async saveDraft(): Promise<void> {
    await this.saveDraftButton.click();
    await expect(this.saveDraftButton).toBeEnabled({ timeout: 20_000 });
  }

  async clickSaveDraft(): Promise<void> {
    await this.saveDraft();
  }

  async setName(value: string): Promise<void> {
    await this.nameInput.fill(value);
  }

  async selectPayloadSchemaRef(schemaRef: string): Promise<void> {
    await this.payloadSchemaSelectButton.click();
    const searchInput = this.page.locator('#workflow-designer-schema-ref-select-search');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(schemaRef);
    await this.page.getByRole('option', { name: new RegExp(schemaRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
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
    return this.page.getByText('Drop steps here');
  }

  // Trigger event helpers
  async selectTriggerEvent(eventName: string): Promise<void> {
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
    const isInferred = await this.isContractModeInferred();
    if (isInferred) {
      await this.contractModeToggle.click();
    }
  }

  async setContractModeInferred(): Promise<void> {
    const isPinned = await this.isContractModePinned();
    if (isPinned) {
      await this.contractModeToggle.click();
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
