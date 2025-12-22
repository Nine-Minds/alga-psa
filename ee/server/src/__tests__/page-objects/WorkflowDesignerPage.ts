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
  readonly payloadSchemaInput: Locator;
  readonly triggerInput: Locator;
  readonly paletteSearchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.header = page.getByRole('heading', { name: 'Workflow Designer' });
    this.newWorkflowButton = page.locator('#workflow-designer-create');
    this.saveDraftButton = page.locator('#workflow-designer-save');
    this.publishButton = page.locator('#workflow-designer-publish');
    this.nameInput = page.locator('#workflow-designer-name');
    this.versionInput = page.locator('#workflow-designer-version');
    this.descriptionInput = page.locator('#workflow-designer-description');
    this.payloadSchemaInput = page.locator('#workflow-designer-schema');
    this.triggerInput = page.locator('#workflow-designer-trigger');
    this.paletteSearchInput = page.locator('#workflow-designer-search');
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

  async searchPalette(value: string): Promise<void> {
    await this.paletteSearchInput.fill(value);
  }

  async selectWorkflowByName(name: string): Promise<void> {
    await this.page.getByRole('button', { name }).click();
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
}
