import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../page-objects/LoginPage';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

const DEPLOY_EMAIL = process.env.DEPLOY_EMAIL;
const DEPLOY_PASSWORD = process.env.DEPLOY_PASSWORD;
const DEPLOY_WORKFLOWS_PATH = process.env.DEPLOY_WORKFLOWS_PATH || '/msp/workflows?tab=designer';

const CE_WORKFLOWS_STUB_TEXT =
  'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.';

test.describe('HV dev2 deploy: workflows (EE)', () => {
  test.skip(!DEPLOY_EMAIL || !DEPLOY_PASSWORD, 'DEPLOY_EMAIL and DEPLOY_PASSWORD are required.');

  async function ensureLoggedInAndOnWorkflows(page: Page): Promise<void> {
    await page.goto(DEPLOY_WORKFLOWS_PATH, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/auth/')) {
      const loginPage = new LoginPage(page);
      await loginPage.verifyLoginPageLoaded();
      await loginPage.loginAndWaitForNavigation(DEPLOY_EMAIL!, DEPLOY_PASSWORD!);
      await page.goto(DEPLOY_WORKFLOWS_PATH, { waitUntil: 'domcontentloaded' });
    }

    await expect(page).toHaveURL(/\/msp\/workflows/);
  }

  test('does not show the CE workflows stub message', async ({ page }) => {
    await ensureLoggedInAndOnWorkflows(page);
    await expect(page.getByText(CE_WORKFLOWS_STUB_TEXT, { exact: true })).toHaveCount(0);
  });

  test('workflow designer surface renders', async ({ page }) => {
    await ensureLoggedInAndOnWorkflows(page);

    const workflowDesignerPage = new WorkflowDesignerPage(page);
    await workflowDesignerPage.waitForLoaded();
    await expect(workflowDesignerPage.designerTab).toBeVisible();
  });
});
